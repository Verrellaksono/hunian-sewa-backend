const crypto = require('crypto');

const { pool, withTransaction } = require('../../db');
const config = require('../../config');
const ApiError = require('../../utils/ApiError');
const { paginated } = require('../../utils/pagination');
const { createSnapTransaction } = require('../../utils/midtrans');

const { addMonths, addDays, todayWIB, formatRupiah, formatWIB } = require('../../utils/datetime');
const { occupyRoom, releaseRoom } = require('../../utils/room-status');

// Kolom invoice, ditambah kamar & penyewa (dipakai ulang list & detail)
const INVOICE_SELECT = `
  SELECT i.id, i.invoice_number, i.contract_id, i.period_start, i.period_end, i.due_date,
         i.amount, i.status, i.issued_at, i.paid_at,
         c.status AS contract_status,
         r.room_number, u.name AS tenant_name, c.tenant_id, u.guardian_id
  FROM invoices i
  JOIN tenancy_contracts c ON c.id = i.contract_id
  JOIN rooms r ON r.id = c.room_id
  JOIN users u ON u.id = c.tenant_id`;

// Kolom payment rekap, ditambah invoice, kontrak, kamar, penyewa & pembayar
const PAYMENT_SELECT = `
  SELECT p.id, p.order_id, p.status, p.gross_amount, p.payment_method,
         p.gateway_transaction_id, p.paid_at, p.expires_at, p.created_at,
         i.id AS invoice_id, i.invoice_number, i.period_start, i.period_end, i.due_date,
         i.amount AS invoice_amount, i.status AS invoice_status,
         c.id AS contract_id, r.room_number,
         t.id AS tenant_id, t.name AS tenant_name,
         py.id AS payer_id, py.name AS payer_name
  FROM payments p
  JOIN invoices i ON i.id = p.invoice_id
  JOIN tenancy_contracts c ON c.id = i.contract_id
  JOIN rooms r ON r.id = c.room_id
  JOIN users t ON t.id = c.tenant_id
  JOIN users py ON py.id = p.payer_id`;

// Status payment yang diperbolehkan sebagai filter
const PAYMENT_STATUSES = ['pending', 'settlement', 'expire', 'deny', 'failure', 'cancel'];

// Validasi ID numerik
function parseId(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError(400, `${label} tidak valid.`);
  }
  return n;
}

// Tambah field terformat rupiah dan waktu WIB untuk tampilan
function formatInvoiceRow(row) {
  return {
    ...row,
    amount_rupiah: formatRupiah(row.amount),
    issued_at_wib: formatWIB(row.issued_at),
    paid_at_wib: formatWIB(row.paid_at),
  };
}

function formatPaymentRow(row) {
  return {
    ...row,
    gross_amount_rupiah: formatRupiah(row.gross_amount),
    expires_at_wib: formatWIB(row.expires_at),
    paid_at_wib: formatWIB(row.paid_at),
    created_at_wib: formatWIB(row.created_at),
  };
}

// Ambil invoice dengan cek akses: owner semua, tenant miliknya, guardian anak asuh, caretaker ditolak
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
      where = `WHERE (c.tenant_id = $1 OR u.guardian_id = $1) AND c.status IN ('pending', 'active')`;
    }
    // Filter periode tagihan, format YYYY-MM
    if (req.query.periode !== undefined) {
      if (!/^\d{4}-\d{2}$/.test(req.query.periode)) {
        throw new ApiError(400, 'Filter periode harus format YYYY-MM.');
      }
      params.push(req.query.periode);
      where += `${where ? ' AND ' : 'WHERE '}to_char(i.period_start, 'YYYY-MM') = $${params.length}`;
    }

    // Hitung total sesuai filter
    const total = Number(
      (await pool.query(`SELECT count(*) AS n FROM invoices i JOIN tenancy_contracts c ON c.id = i.contract_id JOIN users u ON u.id = c.tenant_id ${where}`, params)).rows[0].n
    );

    // Ambil satu halaman data
    params.push(req.pagination.limit, req.pagination.offset);
    const { rows } = await pool.query(
      `${INVOICE_SELECT} ${where} ORDER BY i.due_date DESC, i.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.status(200).json({ success: true, ...paginated(rows.map(formatInvoiceRow), total, req.pagination) });
  } catch (err) {
    next(err);
  }
}

// Detail invoice, items, dan riwayat upaya bayar (semua status payment, terbaru dulu)
async function getById(req, res, next) {
  try {
    const invoice = await getInvoiceForUser(req, parseId(req.params.id, 'ID invoice'));
    const items = (await pool.query(
      `SELECT id, item_type, description, quantity, unit_price, subtotal
       FROM invoice_items WHERE invoice_id = $1 ORDER BY id`,
      [invoice.id]
    )).rows.map((item) => ({
      ...item,
      unit_price_rupiah: formatRupiah(item.unit_price),
      subtotal_rupiah: formatRupiah(item.subtotal),
    }));
    const payments = (await pool.query(
      `SELECT id, order_id, status, payment_method, gross_amount, expires_at, paid_at, created_at
       FROM payments WHERE invoice_id = $1 ORDER BY id DESC`,
      [invoice.id]
    )).rows.map(formatPaymentRow);
    res.status(200).json({ success: true, data: { ...formatInvoiceRow(invoice), items, payments } });
  } catch (err) {
    next(err);
  }
}

// Halaman tagihan per peran; hash dipakai karena router frontend berbasis hash
const BILLS_PATH = {
  tenant: '#/tenant/bills-payments',
  guardian: '#/guardian/bills-payments',
};

// URL balik ke aplikasi setelah pembayaran Snap selesai
function billsFinishUrl(req) {
  const origin = req.get('origin');
  const base = (config.frontendUrl || origin || 'http://localhost:5173').replace(/\/+$/, '');
  return `${base}/${BILLS_PATH[req.user.role] || BILLS_PATH.tenant}`;
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
        data: { order_id: existing.order_id, payment_url: existing.payment_url, status: 'pending', expires_at: existing.expires_at, expires_at_wib: formatWIB(existing.expires_at), reused: true },
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
        finishUrl: billsFinishUrl(req),
      });
    } catch (err) {
      // Gateway gagal: TANPA record, payment dihapus dan invoice kembali unpaid
      await pool.query(`DELETE FROM payments WHERE id = $1`, [payment.id]);
      await pool.query(`UPDATE invoices SET status = 'unpaid' WHERE id = $1 AND status = 'pending'`, [invoice.id]);
      throw err;
    }

    // Simpan payment_url dan token gateway
    const updated = (await pool.query(
      `UPDATE payments
       SET payment_url = $2, gateway_transaction_id = $3, updated_at = now()
       WHERE id = $1
       RETURNING id, order_id, status, payment_url, gateway_transaction_id, gross_amount, expires_at`,
      [payment.id, snap.paymentUrl, snap.token]
    )).rows[0];

    res.status(201).json({ success: true, message: 'Transaksi pembayaran dibuat. Selesaikan pembayaran sebelum kedaluwarsa.', data: formatPaymentRow(updated) });
  } catch (err) {
    // Melanggar partial unique (payment pending ganda oleh request serentak)
    if (err.code === '23505') {
      return next(new ApiError(409, 'Sudah ada pembayaran yang sedang berjalan untuk invoice ini.'));
    }
    next(err);
  }
}

// Pemetaan transaction_status dan fraud_status Midtrans ke kolom payments.status
function mapTransactionStatus(transactionStatus, fraudStatus) {
  if (transactionStatus === 'capture') {
    if (fraudStatus === 'accept') return 'settlement';
    if (fraudStatus === 'deny') return 'deny';
    if (fraudStatus === 'challenge') return 'pending';
    return null;
  }
  const map = {
    settlement: 'settlement',
    pending: 'pending',
    deny: 'deny',
    cancel: 'cancel',
    expire: 'expire',
    failure: 'failure',
  };
  return map[transactionStatus] || null;
}

// Bandingkan signature dengan waktu konstan
function signatureMatches(received, expected) {
  if (typeof received !== 'string' || received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received.toLowerCase()), Buffer.from(expected));
}

// Notifikasi pembayaran Midtrans (tanpa JWT — dilindungi signature)
async function handlePayment(req, res, next) {
  try {
    const {
      order_id,
      status_code,
      gross_amount,
      signature_key,
      transaction_status,
      fraud_status,
      payment_type,
      transaction_id,
    } = req.body || {};

    // Validasi Konfigurasi (key kosong = webhook tidak boleh dipercaya sama sekali)
    if (!config.midtrans.signatureKey) {
      throw new ApiError(503, 'Payment gateway belum dikonfigurasi.');
    }

    // Validasi Field Wajib
    if (
      order_id === undefined ||
      status_code === undefined ||
      gross_amount === undefined ||
      signature_key === undefined ||
      transaction_status === undefined
    ) {
      throw new ApiError(400, 'Notifikasi pembayaran tidak lengkap.');
    }

    // Validasi Signature: SHA512 dari order_id, status_code, gross_amount, dan Signature Secret Key
    const expected = crypto
      .createHash('sha512')
      .update(`${order_id}${status_code}${gross_amount}${config.midtrans.signatureKey}`)
      .digest('hex');
    if (!signatureMatches(signature_key, expected)) {
      throw new ApiError(401, 'Signature tidak valid.');
    }

    // Notifikasi uji dari dashboard Midtrans memakai order_id dummy
    if (String(order_id).startsWith('payment_notif_test_')) {
      return res.status(200).json({ success: true, message: 'Notifikasi uji diterima.' });
    }

    // Cari payment
    const payment = (await pool.query(
      `SELECT id, invoice_id, status, gross_amount FROM payments WHERE order_id = $1`,
      [String(order_id)]
    )).rows[0];
    if (!payment) throw new ApiError(404, 'Pembayaran tidak ditemukan.');

    // Cocokkan Nominal
    if (Number(gross_amount) !== Number(payment.gross_amount)) {
      throw new ApiError(400, 'Nominal pembayaran tidak cocok.');
    }

    // Pemetaan Status Gateway
    const newStatus = mapTransactionStatus(transaction_status, fraud_status);
    if (!newStatus) {
      throw new ApiError(400, `Status transaksi tidak dikenal: ${transaction_status}`);
    }

    // Idempotent: sudah settlement, OK tanpa proses ulang
    if (payment.status === 'settlement') {
      return res.status(200).json({ success: true, message: 'Pembayaran sudah diproses sebelumnya.' });
    }
    // Status tidak berubah (mis. pending ke pending), OK tanpa menulis ulang
    if (payment.status === newStatus) {
      return res.status(200).json({ success: true, message: 'Status pembayaran tidak berubah.' });
    }

    // Settlement: transaksi atomik, payment, invoice lunas, next_due_date, kontrak active, kamar occupied
    let settleResult = null;
    if (newStatus === 'settlement') {
      settleResult = await withTransaction((client) =>
        settlePayment(
          { paymentId: payment.id, paymentType: payment_type || null, transactionId: transaction_id || null, payload: req.body },
          client
        )
      );
      if (!settleResult.applied) {
        return res.status(200).json({ success: true, message: 'Pembayaran sudah diproses sebelumnya.' });
      }
    } else {
      await pool.query(
        `UPDATE payments
         SET status = $2::varchar,
             payment_method = COALESCE($3, payment_method),
             gateway_transaction_id = COALESCE($4, gateway_transaction_id),
             gateway_payload = $5,
             updated_at = now()
         WHERE id = $1`,
        [payment.id, newStatus, payment_type || null, transaction_id || null, req.body]
      );
    }

    res.status(200).json({
      success: true,
      message: 'Notifikasi pembayaran diproses.',
      data: { order_id, status: newStatus },
    });
  } catch (err) {
    next(err);
  }
}

// Rekap upaya pembayaran sesuai scope role (owner semua; tenant/guardian miliknya).
async function rekap(req, res, next) {
  try {
    const params = [];
    const where = [];
    if (req.user.role === 'tenant') {
      params.push(req.user.id);
      where.push(`c.tenant_id = $1`);
    } else if (req.user.role === 'guardian') {
      params.push(req.user.id);
      where.push(`t.guardian_id = $1`);
    }

    // Filter periode sewa, format YYYY-MM
    if (req.query.periode !== undefined) {
      if (!/^\d{4}-\d{2}$/.test(req.query.periode)) {
        throw new ApiError(400, 'Filter periode harus format YYYY-MM.');
      }
      params.push(req.query.periode);
      where.push(`to_char(i.period_start, 'YYYY-MM') = $${params.length}`);
    }

    // Filter status payment
    if (req.query.status !== undefined) {
      if (!PAYMENT_STATUSES.includes(req.query.status)) {
        throw new ApiError(400, 'Status tidak valid.');
      }
      params.push(req.query.status);
      where.push(`p.status = $${params.length}`);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // Query hitung total
    const total = Number(
      (await pool.query(`SELECT count(*) AS n FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN tenancy_contracts c ON c.id = i.contract_id JOIN users t ON t.id = c.tenant_id ${clause}`, params)).rows[0].n
    );

    // Query data halaman
    params.push(req.pagination.limit, req.pagination.offset);
    const { rows } = await pool.query(
      `${PAYMENT_SELECT} ${clause} ORDER BY p.created_at DESC, p.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.status(200).json({ success: true, ...paginated(rows.map(formatPaymentRow), total, req.pagination) });
  } catch (err) {
    next(err);
  }
}

// Terbitkan SATU invoice bulanan untuk kontrak
async function issueInvoice(contract, client) {
  if (!client) throw new Error('issueInvoice wajib dipanggil dalam transaksi (param client).');
  const periodStart = contract.next_due_date;
  if (!periodStart || !contract.monthly_rate) {
    throw new ApiError(500, 'Data kontrak tidak lengkap untuk penerbitan invoice.');
  }

  // Jangan melewati end_date (kontrak rolling tanpa end_date = boleh terus)
  if (contract.end_date && periodStart > contract.end_date) return null;

  // Validasi Tidak ada invoice belum lunas
  const open = await client.query(
    `SELECT id FROM invoices WHERE contract_id = $1 AND status IN ('unpaid', 'pending') LIMIT 1`,
    [contract.id]
  );
  if (open.rows.length > 0) return null;

  // Nomor urut invoice kontrak ini 
  const { rows: seqRows } = await client.query(
    `SELECT count(*)::int AS n FROM invoices WHERE contract_id = $1`,
    [contract.id]
  );
  const seq = seqRows[0].n + 1;
  const periodEnd = addDays(addMonths(periodStart, 1), -1);
  const ym = periodStart.slice(0, 7).replace('-', '');
  const invoiceNumber = `INV-${ym}-${contract.id}-${seq}`;

  try {
    const inv = (await client.query(
      `INSERT INTO invoices (invoice_number, contract_id, period_start, period_end, due_date, amount)
       VALUES ($1, $2, $3, $4, $3, $5)
       RETURNING id, invoice_number, contract_id, period_start, period_end, due_date,
                 amount, status, issued_at`,
      [invoiceNumber, contract.id, periodStart, periodEnd, Number(contract.monthly_rate)]
    )).rows[0];

    // Item invoice: sewa bulanan
    await client.query(
      `INSERT INTO invoice_items (invoice_id, item_type, description, quantity, unit_price, subtotal)
       VALUES ($1, 'rent', $2, 1, $3, $3)`,
      [inv.id, `Sewa kamar periode ${periodStart} s/d ${periodEnd}`, inv.amount]
    );

    return inv;
  } catch (err) {
    // (contract_id, period_start) atau invoice_number sudah ada, anggap sudah terbit
    if (err.code === '23505') return null;
    throw err;
  }
}

// Settlement atomik dalam SATU transaksi (wajib param client): payment settlement, invoice lunas, next_due_date maju 1 bulan, kontrak pending ke active, kamar occupied
async function settlePayment({ paymentId, paymentType, transactionId, payload }, client) {
  if (!client) throw new Error('settlePayment wajib dipanggil dalam transaksi (param client).');

  // Kunci payment: notifikasi serentak tidak boleh memproses ulang
  const pay = (await client.query(
    `SELECT id, invoice_id, status FROM payments WHERE id = $1 FOR UPDATE`,
    [paymentId]
  )).rows[0];
  if (!pay) return { applied: false };
  if (pay.status === 'settlement') return { applied: false };

  await client.query(
    `UPDATE payments
     SET status = 'settlement',
         paid_at = COALESCE(paid_at, now()),
         payment_method = COALESCE($2, payment_method),
         gateway_transaction_id = COALESCE($3, gateway_transaction_id),
         gateway_payload = $4,
         updated_at = now()
     WHERE id = $1`,
    [paymentId, paymentType, transactionId, payload]
  );

  // Invoice lunas hanya bila masih unpaid atau pending; invoice sudah paid tidak mengulang siklus kontrak
  const inv = (await client.query(
    `UPDATE invoices
     SET status = 'paid', paid_at = COALESCE(paid_at, now())
     WHERE id = $1 AND status IN ('unpaid', 'pending')
     RETURNING contract_id`,
    [pay.invoice_id]
  )).rows[0];

  if (inv) {
    const c = (await client.query(
      `SELECT id, room_id, status, next_due_date FROM tenancy_contracts WHERE id = $1 FOR UPDATE`,
      [inv.contract_id]
    )).rows[0];
    // Kontrak completed/terminated tidak dilanjutkan siklus sewanya
    if (c && (c.status === 'pending' || c.status === 'active') && c.next_due_date) {
      const newDue = addMonths(c.next_due_date, 1);
      if (c.status === 'pending') {
        await client.query(
          `UPDATE tenancy_contracts SET status = 'active', next_due_date = $2, updated_at = now() WHERE id = $1`,
          [c.id, newDue]
        );
        await occupyRoom(client, c.room_id);
      } else {
        await client.query(
          `UPDATE tenancy_contracts SET next_due_date = $2, updated_at = now() WHERE id = $1`,
          [c.id, newDue]
        );
      }
    }
  }

  return { applied: true };
}

// Job harian: tutup kontrak berakhir dan terbitkan invoice periodik; gagal satu kontrak hanya dicatat log
async function runDailyBilling() {
  const today = todayWIB();
  const batasTerbit = addDays(today, 7);
  let issued = 0;
  let completedCount = 0;

  // Kontrak active dengan end_date sudah lewat dan tanpa invoice terbuka: completed, kamar dibebaskan
  const finished = (await pool.query(
    `SELECT c.id, c.room_id
     FROM tenancy_contracts c
     WHERE c.status = 'active' AND c.end_date IS NOT NULL AND c.end_date < $1
       AND NOT EXISTS (
         SELECT 1 FROM invoices i WHERE i.contract_id = c.id AND i.status IN ('unpaid', 'pending')
       )
     ORDER BY c.id`,
    [today]
  )).rows;
  for (const row of finished) {
    try {
      await withTransaction(async (client) => {
        // Kunci kontrak: status bisa berubah sejak pengecekan awal
        const c = (await client.query(
          `SELECT id, room_id, status FROM tenancy_contracts WHERE id = $1 FOR UPDATE`,
          [row.id]
        )).rows[0];
        if (!c || c.status !== 'active') return;
        const open = await client.query(
          `SELECT 1 FROM invoices WHERE contract_id = $1 AND status IN ('unpaid', 'pending') LIMIT 1`,
          [c.id]
        );
        if (open.rows.length > 0) return;
        await client.query(
          `UPDATE tenancy_contracts SET status = 'completed', updated_at = now() WHERE id = $1`,
          [c.id]
        );
        await releaseRoom(client, c.room_id);
        completedCount += 1;
      });
    } catch (err) {
      console.error(`[job-harian] gagal menutup kontrak #${row.id}:`, err.message);
    }
  }

  // Kontrak active tanpa invoice terbuka: terbitkan invoice bila next_due_date sampai tujuh hari, tidak melewati end_date
  const due = (await pool.query(
    `SELECT id, monthly_rate, next_due_date, end_date
     FROM tenancy_contracts
     WHERE status = 'active' AND next_due_date IS NOT NULL AND next_due_date <= $1
       AND (end_date IS NULL OR next_due_date <= end_date)
       AND NOT EXISTS (
         SELECT 1 FROM invoices i WHERE i.contract_id = tenancy_contracts.id AND i.status IN ('unpaid', 'pending')
       )
     ORDER BY id`,
    [batasTerbit]
  )).rows;
  for (const row of due) {
    try {
      await withTransaction(async (client) => {
        // Kunci kontrak: status bisa berubah sejak pengecekan awal
        const c = (await client.query(
          `SELECT id, monthly_rate, next_due_date, end_date, status FROM tenancy_contracts WHERE id = $1 FOR UPDATE`,
          [row.id]
        )).rows[0];
        if (!c || c.status !== 'active' || !c.next_due_date) return;
        if (c.end_date && c.next_due_date > c.end_date) return;
        const inv = await issueInvoice(c, client);
        if (inv) issued += 1;
      });
    } catch (err) {
      console.error(`[job-harian] gagal menerbitkan invoice kontrak #${row.id}:`, err.message);
    }
  }

  return { issued, completed: completedCount };
}

// Job 15 menit: payment pending yang kedaluwarsa jadi expire, invoice kembali unpaid
async function expirePayments() {
  let expired = 0;

  const stale = (await pool.query(
    `SELECT id FROM payments WHERE status = 'pending' AND expires_at <= now() ORDER BY id`
  )).rows;
  for (const row of stale) {
    try {
      await withTransaction(async (client) => {
        // Kunci payment: status bisa berubah sejak pengecekan awal
        const p = (await client.query(
          `SELECT id, invoice_id, status FROM payments WHERE id = $1 FOR UPDATE`,
          [row.id]
        )).rows[0];
        if (!p || p.status !== 'pending') return;
        await client.query(
          `UPDATE payments SET status = 'expire', updated_at = now() WHERE id = $1`,
          [p.id]
        );
        // Invoice kembali unpaid hanya bila statusnya masih pending dan tidak ada payment hidup lain
        await client.query(
          `UPDATE invoices SET status = 'unpaid'
           WHERE id = $1 AND status = 'pending'
             AND NOT EXISTS (
               SELECT 1 FROM payments
               WHERE invoice_id = $1 AND status = 'pending' AND expires_at > now()
             )`,
          [p.invoice_id]
        );
        expired += 1;
      });
    } catch (err) {
      console.error(`[job-kedaluwarsa] gagal mengexpirkan payment #${row.id}:`, err.message);
    }
  }

  return { expired };
}

module.exports = { list, getById, pay, handlePayment, mapTransactionStatus, rekap, issueInvoice, runDailyBilling, expirePayments };