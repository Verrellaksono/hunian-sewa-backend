const ApiError = require('../../utils/ApiError');
const { addMonths, addDays } = require('../../utils/datetime');

// Terbitkan SATU invoice bulanan untuk kontrak (FR-07).
// WAJIB dipanggil di dalam transaksi (param client) supaya nomor urut & guard
// invoice-terbuka konsisten dengan penerbit lain (scheduler, hook kontrak).
//
// contract: { id, monthly_rate, next_due_date, end_date }
// Semantik (context.md §10.9):
// - period_start = next_due_date kontrak; period_end = awal bulan berikutnya − 1 hari
//   (sejajar semantik durasi FR-12, tanpa prorata)
// - due_date = period_start (keterlambatan selalu dihitung dari due_date invoice)
// - amount = monthly_rate (salinan kontrak, bukan harga kamar berjalan)
// - nomor unik: INV-YYYYMM-<contractId>-<seq> — YYYYMM dari period_start,
//   seq = jumlah invoice kontrak + 1
// - jangan melewati end_date: bila period_start > end_date → tidak terbit (null)
// - idempotent: kontrak masih punya invoice terbuka (unpaid/pending) ATAU
//   (contract_id, period_start) sudah terdaftar → null (tanpa error)
//
// Return: baris invoice + items, atau null bila tidak jadi terbit.
async function issueInvoice(contract, client) {
  if (!client) throw new Error('issueInvoice wajib dipanggil dalam transaksi (param client).');
  const periodStart = contract.next_due_date;
  if (!periodStart || !contract.monthly_rate) {
    throw new ApiError(500, 'Data kontrak tidak lengkap untuk penerbitan invoice.');
  }

  // Jangan melewati end_date (kontrak rolling tanpa end_date = boleh terus)
  if (contract.end_date && periodStart > contract.end_date) return null;

  // Guard: kontrak masih punya invoice terbuka → tidak terbitkan ganda
  const open = await client.query(
    `SELECT id FROM invoices WHERE contract_id = $1 AND status IN ('unpaid', 'pending') LIMIT 1`,
    [contract.id]
  );
  if (open.rows.length > 0) return null;

  // Nomor urut invoice kontrak ini (dihitung dalam transaksi)
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
    // (contract_id, period_start) atau invoice_number sudah ada → anggap sudah terbit
    if (err.code === '23505') return null;
    throw err;
  }
}

module.exports = { issueInvoice };
