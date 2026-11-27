const { pool } = require('../../db');
const { todayWIB, formatRupiah } = require('../../utils/datetime');
const ApiError = require('../../utils/ApiError');

// Selisih hari antara tanggal due dan hari ini (WIB)
function daysFromToday(dueDate, today) {
  const due = new Date(`${dueDate}T00:00:00Z`).getTime();
  const now = new Date(`${today}T00:00:00Z`).getTime();
  return Math.round((due - now) / 86400000);
}

// Badge jatuh tempo dari due date dan status invoice
function buildBadge(dueDate, invoiceStatus, today) {
  if (!dueDate || (invoiceStatus && invoiceStatus !== 'unpaid' && invoiceStatus !== 'pending')) return null;
  const days = daysFromToday(dueDate, today);
  if (days < 0) return { label: `Terlambat ${Math.abs(days)} hari`, type: 'late', days };
  if (days <= 7) return { label: days === 0 ? 'Jatuh tempo hari ini' : `Jatuh tempo ${days} hari`, type: 'due', days };
  return null;
}

// Ringkasan kamar per status
async function occupancy() {
  const row = (await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'occupied')::int AS occupied,
            count(*) FILTER (WHERE status = 'available')::int AS available,
            count(*) FILTER (WHERE status = 'maintenance')::int AS maintenance
     FROM rooms`
  )).rows[0];
  return row;
}

// Ringkasan tenant: kontrak aktif, badge, pengumuman terkini, tiket aktif
async function tenantSummary(userId, today) {
  const contract = (await pool.query(
    `SELECT c.id AS contract_id, c.next_due_date, r.room_number,
            i.id AS invoice_id, i.amount, i.due_date, i.status AS invoice_status
     FROM tenancy_contracts c
     JOIN rooms r ON r.id = c.room_id
     LEFT JOIN LATERAL (
       SELECT id, amount, due_date, status FROM invoices
       WHERE contract_id = c.id AND status IN ('unpaid', 'pending')
       ORDER BY due_date ASC LIMIT 1
     ) i ON true
     WHERE c.tenant_id = $1 AND c.status = 'active'
     ORDER BY c.id DESC LIMIT 1`,
    [userId]
  )).rows[0];

  const announcements = (await pool.query(
    `SELECT id, title, category, published_at FROM announcements ORDER BY published_at DESC, id DESC LIMIT 5`
  )).rows;

  const tickets = (await pool.query(
    `SELECT t.id, t.category, t.status, t.created_at, r.room_number
     FROM issue_tickets t
     JOIN tenancy_contracts c ON c.id = t.contract_id
     JOIN rooms r ON r.id = c.room_id
     WHERE c.tenant_id = $1 AND t.status IN ('pending', 'in_progress')
     ORDER BY t.created_at DESC, t.id DESC LIMIT 5`,
    [userId]
  )).rows;

  return {
    contract: contract ? {
      contract_id: contract.contract_id,
      room_number: contract.room_number,
      next_due_date: contract.next_due_date,
      invoice: contract.invoice_id ? {
        id: contract.invoice_id, amount: contract.amount, amount_rupiah: formatRupiah(contract.amount),
        due_date: contract.due_date, status: contract.invoice_status,
      } : null,
    } : null,
    badge: contract ? buildBadge(contract.invoice_id ? contract.due_date : contract.next_due_date, contract.invoice_status, today) : null,
    announcements,
    active_tickets: { count: tickets.length, items: tickets },
  };
}

// Ringkasan guardian: penyewa tertaut dengan badge dan invoice terbuka
async function guardianSummary(userId, today) {
  const wards = (await pool.query(
    `SELECT u.id, u.name, r.room_number, c.id AS contract_id, c.status AS contract_status, c.next_due_date,
            i.id AS invoice_id, i.amount, i.due_date, i.status AS invoice_status
     FROM users u
     LEFT JOIN LATERAL (
       SELECT id, room_id, status, next_due_date FROM tenancy_contracts
       WHERE tenant_id = u.id AND status IN ('active', 'pending')
       ORDER BY id DESC LIMIT 1
     ) c ON true
     LEFT JOIN rooms r ON r.id = c.room_id
     LEFT JOIN LATERAL (
       SELECT id, amount, due_date, status FROM invoices
       WHERE contract_id = c.id AND status IN ('unpaid', 'pending')
       ORDER BY due_date ASC LIMIT 1
     ) i ON true
     WHERE u.guardian_id = $1
     ORDER BY u.name`,
    [userId]
  )).rows.map((row) => ({
    tenant_id: row.id,
    name: row.name,
    room_number: row.room_number,
    contract_id: row.contract_id,
    contract_status: row.contract_status,
    next_due_date: row.next_due_date,
    badge: row.due_date || row.next_due_date
      ? buildBadge(row.due_date || row.next_due_date, row.invoice_status, today)
      : null,
    open_invoice: row.invoice_id ? {
      id: row.invoice_id, amount: row.amount, amount_rupiah: formatRupiah(row.amount),
      due_date: row.due_date, status: row.invoice_status,
    } : null,
  }));
  return { wards };
}

// Jumlah tiket yang belum selesai
async function activeTicketCount() {
  const row = (await pool.query(
    `SELECT count(*)::int AS n FROM issue_tickets WHERE status IN ('pending', 'in_progress')`
  )).rows[0];
  return Number(row.n);
}

// Ringkasan caretaker: okupansi, antrian tiket terbaru, kontrak menunggu pembayaran
async function caretakerSummary() {
  const tickets = (await pool.query(
    `SELECT t.id, t.category, t.status, t.created_at, r.room_number, u.name AS tenant_name
     FROM issue_tickets t
     JOIN tenancy_contracts c ON c.id = t.contract_id
     JOIN rooms r ON r.id = c.room_id
     JOIN users u ON u.id = c.tenant_id
     WHERE t.status IN ('pending', 'in_progress')
     ORDER BY t.created_at ASC, t.id ASC LIMIT 10`
  )).rows;
  const pendingContracts = (await pool.query(
    `SELECT count(*)::int AS n FROM tenancy_contracts WHERE status = 'pending'`
  )).rows[0];
  return {
    occupancy: await occupancy(),
    active_tickets: { count: await activeTicketCount(), items: tickets },
    pending_contracts: Number(pendingContracts.n),
    ticket_queue: tickets,
  };
}

// Ringkasan owner: okupansi, rekap invoice dan pembayaran
async function ownerSummary() {
  const occ = await occupancy();
  const open = (await pool.query(
    `SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::bigint AS amount
     FROM invoices WHERE status IN ('unpaid', 'pending')`
  )).rows[0];
  const paidThisMonth = (await pool.query(
    `SELECT count(*)::int AS n, COALESCE(sum(gross_amount), 0)::bigint AS amount
     FROM payments WHERE status = 'settlement'
       AND paid_at >= date_trunc('month', now())`
  )).rows[0];
  const contracts = (await pool.query(
    `SELECT count(*) FILTER (WHERE status = 'active')::int AS active,
            count(*) FILTER (WHERE status = 'pending')::int AS pending
     FROM tenancy_contracts`
  )).rows[0];
  const currentPeriod = (await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'paid')::int AS paid,
            count(*) FILTER (WHERE status = 'unpaid')::int AS unpaid,
            count(*) FILTER (WHERE status = 'pending')::int AS pending
     FROM invoices
     WHERE date_trunc('month', period_start) = date_trunc('month', now())
       AND status IN ('paid', 'unpaid', 'pending')`
  )).rows[0];
  const totalCount = Number(currentPeriod.total);
  const paidCount = Number(currentPeriod.paid);
  return {
    occupancy: occ,
    contracts,
    active_tickets: { count: await activeTicketCount() },
    open_invoices: { count: Number(open.n), amount: Number(open.amount), amount_rupiah: formatRupiah(open.amount) },
    paid_this_month: { count: Number(paidThisMonth.n), amount: Number(paidThisMonth.amount), amount_rupiah: formatRupiah(paidThisMonth.amount) },
    invoices_current_period: {
      total: totalCount,
      paid: paidCount,
      unpaid: Number(currentPeriod.unpaid),
      pending: Number(currentPeriod.pending),
      paid_percentage: totalCount > 0 ? Math.round((paidCount / totalCount) * 100) : 0,
    },
  };
}

// Ringkasan dashboard sesuai role penelepon
async function summary(req, res, next) {
  try {
    const today = todayWIB();
    let data;
    switch (req.user.role) {
      case 'tenant': data = await tenantSummary(req.user.id, today); break;
      case 'guardian': data = await guardianSummary(req.user.id, today); break;
      case 'caretaker': data = await caretakerSummary(); break;
      case 'owner': data = await ownerSummary(); break;
      default: throw new ApiError(403, 'Role tidak dikenal.');
    }
    res.status(200).json({ success: true, data: { role: req.user.role, ...data } });
  } catch (err) {
    next(err);
  }
}

module.exports = { summary };
