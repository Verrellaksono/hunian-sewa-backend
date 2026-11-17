const { withTransaction } = require('../../db');
const ApiError = require('../../utils/ApiError');

// Validasi ID numerik positif dari body
function parseId(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError(400, `${label} tidak valid.`);
  }
  return n;
}

// Validasi tanggal 'YYYY-MM-DD'
function parseDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, `${label} harus berformat YYYY-MM-DD.`);
  }
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new ApiError(400, `${label} bukan tanggal yang valid.`);
  }
  return value;
}

// Buat kontrak sewa baru (FR-12)
async function create(req, res, next) {
  try {
    const { tenant_id, room_id, start_date, end_date } = req.body || {};

    // Validasi Wajib Isi
    if (tenant_id === undefined || room_id === undefined || start_date === undefined) {
      throw new ApiError(400, 'Penyewa, kamar, dan tanggal mulai wajib diisi.');
    }
    // Validasi ID
    const tenantId = parseId(tenant_id, 'ID penyewa');
    const roomId = parseId(room_id, 'ID kamar');

    // Validasi Tanggal
    const startDate = parseDate(start_date, 'Tanggal mulai');
    let endDate = null;
    if (end_date !== undefined && end_date !== null && end_date !== '') {
      endDate = parseDate(end_date, 'Tanggal akhir');
      if (endDate <= startDate) {
        throw new ApiError(400, 'Tanggal akhir harus setelah tanggal mulai.');
      }
    }

    let contract;
    try {
      contract = await withTransaction(async (client) => {
        // Kunci Query penyewa
        const tenant = (await client.query(
          `SELECT id, name, role, is_active FROM users WHERE id = $1 FOR UPDATE`,
          [tenantId]
        )).rows[0];

        // Validasi Penyewa Tidak Ditemukan
        if (!tenant) throw new ApiError(404, 'Penyewa tidak ditemukan.');
        if (tenant.role !== 'tenant') {
          throw new ApiError(400, 'Kontrak sewa hanya dapat dibuat untuk akun berperan tenant.');
        }
        if (!tenant.is_active) {
          throw new ApiError(400, 'Akun penyewa nonaktif. Aktifkan terlebih dahulu sebelum membuat kontrak.');
        }

        // Query 
        const room = (await client.query(
          `SELECT id, room_number, price, status FROM rooms WHERE id = $1 FOR UPDATE`,
          [roomId]
        )).rows[0];

        // Validasi Kamar Tidak Ditemukan
        if (!room) throw new ApiError(404, 'Kamar tidak ditemukan.');
        // Validasi Kamar  Maintenance
        if (room.status === 'maintenance') {
          throw new ApiError(409, `Kamar ${room.room_number} sedang dalam perawatan dan tidak dapat dikontrakkan.`);
        }
        // Validasi Kamar  Sedang Terisi
        if (room.status === 'occupied') {
          throw new ApiError(409, `Kamar ${room.room_number} sedang terisi.`);
        }
        // Validasi Kamar belum Berharga
        if (room.price === null) {
          throw new ApiError(400, `Kamar ${room.room_number} belum memiliki harga sewa. Tetapkan harga oleh owner terlebih dahulu.`);
        }

        // Validasi Satu Penyewa Maksimal Satu Kontrak Pending/Active
        const tenantBusy = (await client.query(
          `SELECT c.id, c.status, r.room_number
           FROM tenancy_contracts c JOIN rooms r ON r.id = c.room_id
           WHERE c.tenant_id = $1 AND c.status IN ('pending', 'active') LIMIT 1`,
          [tenantId]
        )).rows[0];
        if (tenantBusy) {
          throw new ApiError(409, `Penyewa masih memiliki kontrak ${tenantBusy.status} di kamar ${tenantBusy.room_number}.`);
        }

        // Validasi Satu Kamar Maksimal Satu Kontrak Pending/Active
        const roomBusy = (await client.query(
          `SELECT c.id, c.status, u.name AS tenant_name
           FROM tenancy_contracts c JOIN users u ON u.id = c.tenant_id
           WHERE c.room_id = $1 AND c.status IN ('pending', 'active') LIMIT 1`,
          [roomId]
        )).rows[0];
        if (roomBusy) {
          throw new ApiError(409, `Kamar ${room.room_number} sudah memiliki kontrak ${roomBusy.status} atas nama ${roomBusy.tenant_name}.`);
        }

        // Insert kontrak
        const inserted = (await client.query(
          `INSERT INTO tenancy_contracts (tenant_id, room_id, start_date, end_date, monthly_rate, next_due_date, status, created_by)
           VALUES ($1, $2, $3, $4, $5, $3, 'pending', $6)
           RETURNING id, tenant_id, room_id, start_date, end_date, monthly_rate, next_due_date, status, created_at`,
          [tenantId, roomId, startDate, endDate, room.price, req.user.id]
        )).rows[0];

        return { ...inserted, tenant_name: tenant.name, room_number: room.room_number };
      });
    } catch (err) {
      // 23505 = partial unique index (kontrak pending/active ganda)
      if (err.code === '23505') {
        throw new ApiError(409, 'Penyewa atau kamar sudah memiliki kontrak pending/aktif.');
      }
      throw err;
    }

    res.status(201).json({
      success: true,
      message: `Kontrak sewa kamar ${contract.room_number} berhasil dibuat dengan status pending. Kontrak aktif setelah invoice pertama lunas.`,
      data: contract,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { create };
