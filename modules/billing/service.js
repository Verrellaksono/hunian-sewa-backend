const ApiError = require('../../utils/ApiError');
const { addMonths, addDays } = require('../../utils/datetime');
const { occupyRoom } = require('../../utils/room-status');

// Terbitkan SATU invoice bulanan untuk kontrak.
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

// Settlement atomik: payment settlement, invoice lunas, next_due_date maju 1 bulan,
// kontrak pending ke active, kamar occupied. WAJIB dipanggil dalam transaksi (param client).
// return { applied: true } bila perubahan diterapkan; { applied: false } bila payment sudah settlement.
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

  // Invoice lunas — hanya bila masih unpaid/pending (invoice cancelled tidak ikut lunas).
  // Bila invoice sudah paid (payment lain lebih dulu), siklus kontrak TIDAK diulang.
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

module.exports = { issueInvoice, settlePayment };
