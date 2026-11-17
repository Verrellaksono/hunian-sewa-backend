const { pool, withTransaction } = require('../../db');
const ApiError = require('../../utils/ApiError');
const { addMonths } = require('../../utils/datetime');
const { releaseRoom } = require('../../utils/room-status');
const { paginated } = require('../../utils/pagination');
const { issueInvoice } = require('../billing/service');

// Geser tanggal 'YYYY-MM-DD' n hari (boleh negatif)
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

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

// Buat kontrak sewa baru
async function create(req, res, next) {
  try {
    const { tenant_id, room_id, start_date, duration_months } = req.body || {};

    // Validasi Wajib Isi
    if (tenant_id === undefined || room_id === undefined || start_date === undefined) {
      throw new ApiError(400, 'Penyewa, kamar, dan tanggal mulai wajib diisi.');
    }
    // Validasi ID
    const tenantId = parseId(tenant_id, 'ID penyewa');
    const roomId = parseId(room_id, 'ID kamar');

    // Validasi Tanggal
    const startDate = parseDate(start_date, 'Tanggal mulai');
    // Durasi sewa (bulan); kosong/null = rolling tanpa batas waktu
    let endDate = null;
    if (duration_months !== undefined && duration_months !== null && duration_months !== '') {
      const months = Number(duration_months);
      if (!Number.isInteger(months) || months < 1) {
        throw new ApiError(400, 'Durasi sewa harus bilangan bulat minimal 1 bulan. Kosongkan untuk sewa rolling tanpa batas waktu.');
      }
      // end_date: jumlahkan durasi dari start_date, kurangi 1 hari
      endDate = addMonths(startDate, months);
      endDate = addDays(endDate, -1);
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

        // Invoice pertama terbit
        const firstInvoice = await issueInvoice(
          { id: inserted.id, monthly_rate: inserted.monthly_rate, next_due_date: inserted.next_due_date, end_date: inserted.end_date },
          client
        );

        return { ...inserted, tenant_name: tenant.name, room_number: room.room_number, first_invoice: firstInvoice };
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

// Perpanjang kontrak: set/kosongkan end_date (FR-12)
async function extend(req, res, next) {
  try {
    const body = req.body || {};
    const { end_date } = body;

    // Validasi Hanya Menerima end_date
    if (Object.keys(body).some((k) => k !== 'end_date')) {
      throw new ApiError(400, 'Endpoint ini hanya menerima field end_date (isi tanggal untuk memperpanjang, atau null untuk mengosongkan).');
    }
    // Validasi Wajib Ada end_date
    if (end_date === undefined) {
      throw new ApiError(400, 'Isi end_date (tanggal YYYY-MM-DD) untuk memperpanjang, atau null untuk mengosongkan.');
    }

    // Validasi Tanggal (null = kosongkan / tanpa batas waktu)
    let endDate = null;
    if (end_date !== null && end_date !== '') {
      endDate = parseDate(end_date, 'Tanggal akhir');
    }

    const { contract, updated } = await withTransaction(async (client) => {
      // Kunci baris kontrak
      const locked = (await client.query(
        `SELECT c.id, c.status, c.start_date, c.end_date, r.room_number, u.name AS tenant_name
          FROM tenancy_contracts c
          JOIN rooms r ON r.id = c.room_id
          JOIN users u ON u.id = c.tenant_id
          WHERE c.id = $1
          FOR UPDATE OF c LIMIT 1`,
        [parseId(req.params.id, 'ID kontrak')]
      )).rows[0];
      // Validasi Kontrak Ditemukan
      if (!locked) throw new ApiError(404, 'Kontrak tidak ditemukan.');
      // Validasi Status (perpanjang hanya untuk kontrak active — FR-12)
      if (locked.status !== 'active') {
        throw new ApiError(409, `Kontrak berstatus ${locked.status} tidak dapat diperpanjang. Perpanjangan hanya untuk kontrak aktif.`);
      }
      // Validasi Tanggal Akhir Setelah Tanggal Mulai
      if (endDate && endDate <= locked.start_date) {
        throw new ApiError(400, 'Tanggal akhir harus setelah tanggal mulai kontrak.');
      }

      const row = (await client.query(
        `UPDATE tenancy_contracts SET end_date = $2, updated_at = now()
          WHERE id = $1
          RETURNING id, tenant_id, room_id, start_date, end_date, monthly_rate, next_due_date, status, updated_at`,
        [locked.id, endDate]
      )).rows[0];

      return { contract: locked, updated: { ...row, tenant_name: locked.tenant_name, room_number: locked.room_number } };
    });

    res.status(200).json({
      success: true,
      message: endDate
        ? `Kontrak kamar ${updated.room_number} berhasil diperpanjang hingga ${endDate}.`
        : `Tanggal akhir kontrak kamar ${updated.room_number} dikosongkan (kontrak tanpa batas waktu).`,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

// Akhiri kontrak (FR-12): terminated, kamar kembali available, invoice belum lunas dibatalkan
async function terminate(req, res, next) {
  try {
    const result = await withTransaction(async (client) => {
      // Kunci baris kontrak
      const locked = (await client.query(
        `SELECT c.id, c.status, c.room_id, r.room_number, u.name AS tenant_name
          FROM tenancy_contracts c
          JOIN rooms r ON r.id = c.room_id
          JOIN users u ON u.id = c.tenant_id
          WHERE c.id = $1
          FOR UPDATE OF c LIMIT 1`,
        [parseId(req.params.id, 'ID kontrak')]
      )).rows[0];
      // Validasi Kontrak Ditemukan
      if (!locked) throw new ApiError(404, 'Kontrak tidak ditemukan.');
      // Validasi Status (hanya pending/active yang masih bisa diakhiri)
      if (!['pending', 'active'].includes(locked.status)) {
        throw new ApiError(409, `Kontrak berstatus ${locked.status} tidak dapat diakhiri.`);
      }

      // Batalkan semua invoice belum lunas 
      const cancelledInvoices = (await client.query(
        `UPDATE invoices SET status = 'cancelled', paid_at = NULL
          WHERE contract_id = $1 AND status IN ('unpaid', 'pending')
          RETURNING id`,
        [locked.id]
      )).rowCount;

      // Kontrak menjadi terminated, tercatat terminated_at
      const updated = (await client.query(
        `UPDATE tenancy_contracts SET status = 'terminated', terminated_at = now(), updated_at = now()
          WHERE id = $1
          RETURNING id, tenant_id, room_id, start_date, end_date, monthly_rate, next_due_date, status, terminated_at, updated_at`,
        [locked.id]
      )).rows[0];

      // Kamar kembali available (diatur sistem, tidak pernah manual)
      await releaseRoom(client, locked.room_id);

      return { ...updated, tenant_name: locked.tenant_name, room_number: locked.room_number, cancelled_invoices: cancelledInvoices };
    });

    res.status(200).json({
      success: true,
      message: `Kontrak kamar ${result.room_number} atas nama ${result.tenant_name} berhasil diakhiri. Kamar kembali tersedia.`
        + (result.cancelled_invoices > 0 ? ` ${result.cancelled_invoices} invoice belum lunas dibatalkan.` : ''),
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

// Kolom kontrak, ditambah kamar & penyewa (dipakai ulang beberapa endpoint)
const CONTRACT_SELECT = `
  SELECT c.id, c.tenant_id, c.room_id, c.start_date, c.end_date, c.monthly_rate,
         c.next_due_date, c.status, c.terminated_at, c.created_at, c.updated_at,
         r.room_number, u.name AS tenant_name
  FROM tenancy_contracts c
  JOIN rooms r ON r.id = c.room_id
  JOIN users u ON u.id = c.tenant_id`;

// Daftar kontrak milik tenant
async function listMine(req, res, next) {
  try {
    const { rows } = await pool.query(
      `${CONTRACT_SELECT}
       WHERE c.tenant_id = $1 OR u.guardian_id = $1
       ORDER BY c.id DESC`,
      [req.user.id]
    );
    res.status(200).json({ success: true, ...paginated(rows, rows.length, req.pagination) });
  } catch (err) {
    next(err);
  }
}

// Detail satu kontrak 
async function getById(req, res, next) {
  try {
    const contract = (await pool.query(
      `${CONTRACT_SELECT} WHERE c.id = $1`,
      [parseId(req.params.id, 'ID kontrak')]
    )).rows[0];
    // Validasi Kontrak Ditemukan
    if (!contract) throw new ApiError(404, 'Kontrak tidak ditemukan.');

    // Validasi Kepemilikan (tenant/guardian hanya boleh kontrak miliknya)
    if (!['owner', 'caretaker'].includes(req.user.role)) {
      const ward = (await pool.query(`SELECT guardian_id FROM users WHERE id = $1`, [contract.tenant_id])).rows[0];
      if (contract.tenant_id !== req.user.id && ward.guardian_id !== req.user.id) {
        throw new ApiError(403, 'Anda tidak memiliki akses ke kontrak ini.');
      }
    }

    res.status(200).json({ success: true, data: contract });
  } catch (err) {
    next(err);
  }
}

module.exports = { create, extend, terminate, listMine, getById };
