const { pool } = require('../db');

// Kontrak aktif milik tenant atau penyewa
async function activeContracts(userId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.tenant_id, c.room_id, c.monthly_rate, c.next_due_date, r.room_number
     FROM tenancy_contracts c
     JOIN rooms r ON r.id = c.room_id
     JOIN users t ON t.id = c.tenant_id
     WHERE c.status = 'active' AND (c.tenant_id = $1 OR t.guardian_id = $1)
     ORDER BY c.id`,
    [userId]
  );
  return rows;
}

// ID kontrak yang boleh diakses user (null = bebas: owner/caretaker)
async function accessibleContractIds(user) {
  if (user.role === 'owner' || user.role === 'caretaker') return null;
  const contracts = await activeContracts(user.id);
  return contracts.map((c) => c.id);
}

module.exports = { activeContracts, accessibleContractIds };
