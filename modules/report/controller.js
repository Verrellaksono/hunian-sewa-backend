const { pool } = require('../../db');
const ApiError = require('../../utils/ApiError');
const { addMonths, formatRupiah, todayWIB } = require('../../utils/datetime');

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
async function periodTotals(periode) {
  return (await pool.query(
    `SELECT count(*)::int AS invoice_count,
            count(*) FILTER (WHERE status = 'paid')::int AS paid_count,
            COALESCE(sum(amount), 0)::bigint AS billed,
            COALESCE(sum(amount) FILTER (WHERE status = 'paid'), 0)::bigint AS paid,
            COALESCE(sum(amount) FILTER (WHERE status IN ('unpaid', 'pending')), 0)::bigint AS unpaid
     FROM invoices
     WHERE to_char(period_start, 'YYYY-MM') = $1 AND status <> 'cancelled'`,
    [periode]
  )).rows[0];
}

// Rincian tagihan per kamar pada satu periode
async function roomBreakdown(periode) {
  return (await pool.query(
    `SELECT r.room_number, u.name AS tenant_name,
            count(i.id)::int AS invoice_count,
            COALESCE(sum(i.amount), 0)::bigint AS billed,
            COALESCE(sum(i.amount) FILTER (WHERE i.status = 'paid'), 0)::bigint AS paid,
            COALESCE(sum(i.amount) FILTER (WHERE i.status IN ('unpaid', 'pending')), 0)::bigint AS unpaid
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
    const totals = await periodTotals(periode);
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
            status: roomStatus(paid, unpaid),
          };
        }),
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { financial };
