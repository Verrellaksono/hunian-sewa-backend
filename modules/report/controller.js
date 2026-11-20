const { pool } = require('../../db');
const ApiError = require('../../utils/ApiError');
const { addMonths, daysBetween, formatRupiah, formatWIB, todayWIB } = require('../../utils/datetime');

// Validasi periode YYYY-MM, kosong berarti bulan berjalan
function parsePeriode(value) {
  const periode = value === undefined || value === '' ? todayWIB().slice(0, 7) : value;
  if (typeof periode !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periode)) {
    throw new ApiError(400, 'Filter periode harus format YYYY-MM.');
  }
  return periode;
}

// Enam periode berurutan yang berakhir pada periode terpilih
function lastSixPeriodes(periode) {
  const list = [];
  for (let i = 5; i >= 0; i -= 1) {
    list.push(addMonths(`${periode}-01`, -i).slice(0, 7));
  }
  return list;
}

// Ringkasan tagihan satu periode, invoice cancelled tidak dihitung
async function periodTotals(periode, today) {
  return (await pool.query(
    `SELECT count(*)::int AS invoice_count,
            count(*) FILTER (WHERE status = 'paid')::int AS paid_count,
            count(*) FILTER (WHERE status IN ('unpaid', 'pending') AND due_date < $2::date)::int AS overdue_count,
            COALESCE(sum(amount), 0)::bigint AS billed,
            COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0)::bigint AS paid,
            COALESCE(sum(amount) FILTER (WHERE status IN ('unpaid', 'pending')), 0)::bigint AS unpaid
     FROM invoices
     WHERE to_char(period_start, 'YYYY-MM') = $1 AND status <> 'cancelled'`,
    [periode, today]
  )).rows[0];
}

// Rincian tagihan per kamar pada satu periode
async function roomBreakdown(periode) {
  return (await pool.query(
    `SELECT r.room_number, u.name AS tenant_name,
            count(i.id)::int AS invoice_count,
            COALESCE(sum(i.amount), 0)::bigint AS billed,
            COALESCE(sum(i.amount) FILTER (WHERE i.status = 'paid'), 0)::bigint AS paid,
            COALESCE(sum(i.amount) FILTER (WHERE i.status IN ('unpaid', 'pending')), 0)::bigint AS unpaid,
            to_char(COALESCE(
              min(i.due_date) FILTER (WHERE i.status IN ('unpaid', 'pending')),
              max(i.due_date)
            ), 'YYYY-MM-DD') AS due_date,
            max(i.paid_at) AS paid_at
     FROM invoices i
     JOIN tenancy_contracts c ON c.id = i.contract_id
     JOIN rooms r ON r.id = c.room_id
     JOIN users u ON u.id = c.tenant_id
     WHERE to_char(i.period_start, 'YYYY-MM') = $1 AND i.status <> 'cancelled'
     GROUP BY r.room_number, u.name
     ORDER BY r.room_number`,
    [periode]
  )).rows;
}

// Seri enam bulan untuk grafik
async function monthlySeries(periodes) {
  const rows = (await pool.query(
    `SELECT to_char(period_start, 'YYYY-MM') AS periode,
            count(*)::int AS invoice_count,
            count(*) FILTER (WHERE status = 'paid')::int AS paid_count,
            COALESCE(sum(amount), 0)::bigint AS billed,
            COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0)::bigint AS paid,
            COALESCE(sum(amount) FILTER (WHERE status IN ('unpaid', 'pending')), 0)::bigint AS unpaid
     FROM invoices
     WHERE to_char(period_start, 'YYYY-MM') = ANY($1::text[]) AND status <> 'cancelled'
     GROUP BY 1`,
    [periodes]
  )).rows;
  const byPeriode = new Map(rows.map((row) => [row.periode, row]));
  return periodes.map((periode) => {
    const row = byPeriode.get(periode);
    return {
      periode,
      invoice_count: row ? Number(row.invoice_count) : 0,
      paid_count: row ? Number(row.paid_count) : 0,
      billed: row ? Number(row.billed) : 0,
      billed_rupiah: formatRupiah(row ? row.billed : 0),
      paid: row ? Number(row.paid) : 0,
      paid_rupiah: formatRupiah(row ? row.paid : 0),
      unpaid: row ? Number(row.unpaid) : 0,
      unpaid_rupiah: formatRupiah(row ? row.unpaid : 0),
    };
  });
}

// Status pelunasan satu kamar
function roomStatus(paid, unpaid) {
  if (unpaid === 0 && paid > 0) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

// Laporan keuangan owner: agregat, seri enam bulan, dan rincian per kamar
async function financial(req, res, next) {
  try {
    const periode = parsePeriode(req.query.periode);
    const today = todayWIB();
    const totals = await periodTotals(periode, today);
    const rooms = await roomBreakdown(periode);
    const monthly = await monthlySeries(lastSixPeriodes(periode));

    const invoiceCount = Number(totals.invoice_count);
    const paidCount = Number(totals.paid_count);

    res.status(200).json({
      success: true,
      data: {
        periode,
        totals: {
          invoice_count: invoiceCount,
          paid_count: paidCount,
          overdue_count: Number(totals.overdue_count),
          billed: Number(totals.billed),
          billed_rupiah: formatRupiah(totals.billed),
          paid: Number(totals.paid),
          paid_rupiah: formatRupiah(totals.paid),
          unpaid: Number(totals.unpaid),
          unpaid_rupiah: formatRupiah(totals.unpaid),
          percentage: invoiceCount > 0 ? Math.round((paidCount / invoiceCount) * 100) : 0,
        },
        monthly,
        rooms: rooms.map((room) => {
          const paid = Number(room.paid);
          const unpaid = Number(room.unpaid);
          const overdueDays = unpaid > 0 && room.due_date
            ? Math.max(0, daysBetween(room.due_date, today))
            : 0;
          return {
            room_number: room.room_number,
            tenant_name: room.tenant_name,
            invoice_count: Number(room.invoice_count),
            billed: Number(room.billed),
            billed_rupiah: formatRupiah(room.billed),
            paid,
            paid_rupiah: formatRupiah(room.paid),
            unpaid,
            unpaid_rupiah: formatRupiah(room.unpaid),
            due_date: room.due_date,
            paid_at: room.paid_at,
            paid_at_wib: formatWIB(room.paid_at),
            overdue_days: overdueDays,
            status: roomStatus(paid, unpaid),
          };
        }),
      },
    });
  } catch (err) {
    next(err);
  }
}

// Label status kamar untuk laporan CSV
function statusLabel(status) {
  if (status === 'paid') return 'Lunas';
  if (status === 'partial') return 'Sebagian';
  return 'Belum Dibayar';
}

// Escape satu sel CSV (kutip bila memuat koma, kutip, atau baris baru)
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Ekspor laporan keuangan periode terpilih sebagai CSV (owner)
async function exportFinancial(req, res, next) {
  try {
    const periode = parsePeriode(req.query.periode);
    const totals = await periodTotals(periode, todayWIB());
    const rooms = await roomBreakdown(periode);

    const lines = [['Nomor Kamar', 'Penyewa', 'Jumlah Tagihan', 'Jumlah Dibayar', 'Sisa', 'Status']];
    for (const room of rooms) {
      const paid = Number(room.paid);
      const unpaid = Number(room.unpaid);
      lines.push([
        room.room_number,
        room.tenant_name,
        Number(room.billed),
        paid,
        unpaid,
        statusLabel(roomStatus(paid, unpaid)),
      ]);
    }
    lines.push(['TOTAL', '', Number(totals.billed), Number(totals.paid), Number(totals.unpaid), '']);

    // BOM UTF-8 agar Excel membaca karakter non-ASCII dengan benar
    const csv = '\uFEFF' + lines.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';

    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="laporan-keuangan-${periode}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
}

module.exports = { financial, exportFinancial };
