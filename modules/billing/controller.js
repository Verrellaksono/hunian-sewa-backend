const { pool } = require('../../db');
const ApiError = require('../../utils/ApiError');
const { paginated } = require('../../utils/pagination');

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

module.exports = { list, getById };
