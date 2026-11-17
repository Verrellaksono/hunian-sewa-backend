const { pool, withTransaction } = require('../../db');
const config = require('../../config');
const ApiError = require('../../utils/ApiError');
const { paginated } = require('../../utils/pagination');
const { createSnapTransaction } = require('./gateway');

// Kolom invoice + kamar & penyewa (dipakai ulang list & detail)
const INVOICE_SELECT = `
  SELECT i.id, i.invoice_number, i.contract_id, i.period_start, i.period_end, i.due_date,
         i.amount, i.status, i.issued_at, i.paid_at,
         r.room_number, u.name AS tenant_name, c.tenant_id, u.guardian_id
  FROM invoices i
  JOIN tenancy_contracts c ON c.id = i.contract_id
  JOIN rooms r ON r.id = c.room_id
  JOIN users u ON u.id = c.tenant_id`;

// Validasi ID numerik
function parseId(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError(400, `${label} tidak valid.`);
  }
  return n;
}

// Ambil invoice dengan cek akses baca:
// owner semua; tenant miliknya; guardian penyewa tertaut; caretaker ditolak di route
async function getInvoiceForUser(req, id) {
  const invoice = (await pool.query(`${INVOICE_SELECT} WHERE i.id = $1`, [id])).rows[0];
  // Validasi Invoice Ditemukan
  if (!invoice) throw new ApiError(404, 'Invoice tidak ditemukan.');
  const allowed =
    req.user.role === 'owner' ||
    (req.user.role === 'tenant' && invoice.tenant_id === req.user.id) ||
    (req.user.role === 'guardian' && invoice.guardian_id === req.user.id);
  if (!allowed) throw new ApiError(403, 'Anda tidak berhak mengakses invoice ini.');
  return invoice;
}

// Daftar invoice sesuai scope role (owner semua; tenant/guardian miliknya)
async function list(req, res, next) {
  try {
    const params = [];
    let where = '';
    if (req.user.role !== 'owner') {
      params.push(req.user.id);
      where = `WHERE c.tenant_id = $1 OR u.guardian_id = $1`;
    }
    const { rows } = await pool.query(`${INVOICE_SELECT} ${where} ORDER BY i.due_date DESC, i.id DESC`, params);
    res.status(200).json({ success: true, ...paginated(rows, rows.length, req.pagination) });
  } catch (err) {
    next(err);
  }
}

// Detail invoice + items + riwayat upaya bayar (semua status payment, terbaru dulu)
async function getById(req, res, next) {
  try {
    const invoice = await getInvoiceForUser(req, parseId(req.params.id, 'ID invoice'));
    const items = (await pool.query(
      `SELECT id, item_type, description, quantity, unit_price, subtotal
       FROM invoice_items WHERE invoice_id = $1 ORDER BY id`,
      [invoice.id]
    )).rows;
    const payments = (await pool.query(
      `SELECT id, order_id, status, payment_method, gross_amount, expires_at, paid_at, created_at
       FROM payments WHERE invoice_id = $1 ORDER BY id DESC`,
      [invoice.id]
    )).rows;
    res.status(200).json({ success: true, data: { ...invoice, items, payments } });
  } catch (err) {
    next(err);
  }
}

// Mulai pembayaran invoice 
async function pay(req, res, next) {
  try {
    const id = parseId(req.params.id, 'ID invoice');
    const invoice = await getInvoiceForUser(req, id);

    // Validasi Role Pembayar
    if (req.user.role === 'owner') {
      throw new ApiError(403, 'Owner tidak dapat membayar invoice.');
    }
    // Validasi Status Invoice (hanya unpaid/pending)
    if (invoice.status === 'paid') throw new ApiError(409, 'Invoice sudah lunas.');
    if (invoice.status === 'cancelled') throw new ApiError(409, 'Invoice sudah dibatalkan.');

    // Jika Payment pending masih hidup, pakai ulang payment_url yang sama
    const existing = (await pool.query(
      `SELECT order_id, payment_url, expires_at FROM payments
       WHERE invoice_id = $1 AND status = 'pending' AND expires_at > now()
       LIMIT 1`,
      [invoice.id]
    )).rows[0];
    if (existing?.payment_url) {
      return res.status(200).json({
        success: true,
        message: 'Pembayaran masih menunggu dilunasi.',
        data: { order_id: existing.order_id, payment_url: existing.payment_url, status: 'pending', expires_at: existing.expires_at, reused: true },
      });
    }

    // order_id unik; kedaluwarsa 60 menit
    const orderId = `PAY-${invoice.id}-${Date.now()}`;
    const payment = await withTransaction(async (client) => {
      // Kunci invoice; status bisa berubah sejak cek pertama
      const locked = (await client.query(`SELECT status FROM invoices WHERE id = $1 FOR UPDATE`, [invoice.id])).rows[0];
      if (!locked || locked.status === 'paid' || locked.status === 'cancelled') {
        throw new ApiError(409, 'Invoice sudah tidak dapat dibayar.');
      }
      // Payment pending yang sudah kedaluwarsa, tandai expire
      await client.query(
        `UPDATE payments SET status = 'expire', updated_at = now()
         WHERE invoice_id = $1 AND status = 'pending' AND expires_at <= now()`,
        [invoice.id]
      );
      const row = (await client.query(
        `INSERT INTO payments (invoice_id, payer_id, order_id, gross_amount, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '60 minutes')
         RETURNING id, order_id, status, gross_amount, expires_at`,
        [invoice.id, req.user.id, orderId, invoice.amount]
      )).rows[0];
      // Invoice ikut menunggu pembayaran
      await client.query(`UPDATE invoices SET status = 'pending' WHERE id = $1 AND status = 'unpaid'`, [invoice.id]);
      return row;
    });

    // Panggil gateway DI LUAR transaksi
    let snap;
    try {
      snap = await createSnapTransaction({
        orderId,
        grossAmount: invoice.amount,
        customerName: req.user.name,
        itemDetails: [{ id: 'RENT', price: invoice.amount, quantity: 1, name: 'Sewa kamar' }],
      });
    } catch (err) {
      // Gateway gagal → TANPA record: payment dihapus + invoice kembali unpaid
      await pool.query(`DELETE FROM payments WHERE id = $1`, [payment.id]);
      await pool.query(`UPDATE invoices SET status = 'unpaid' WHERE id = $1 AND status = 'pending'`, [invoice.id]);
      throw err;
    }

    // Simpan payment_url + token gateway
    const updated = (await pool.query(
      `UPDATE payments
       SET payment_url = $2, gateway_transaction_id = $3, updated_at = now()
       WHERE id = $1
       RETURNING id, order_id, status, payment_url, gateway_transaction_id, gross_amount, expires_at`,
      [payment.id, snap.paymentUrl, snap.token]
    )).rows[0];

    res.status(201).json({ success: true, message: 'Transaksi pembayaran dibuat. Selesaikan pembayaran sebelum kedaluwarsa.', data: updated });
  } catch (err) {
    // Melanggar partial unique (payment pending ganda oleh request serentak)
    if (err.code === '23505') {
      return next(new ApiError(409, 'Sudah ada pembayaran yang sedang berjalan untuk invoice ini.'));
    }
    next(err);
  }
}

module.exports = { list, getById, pay };
