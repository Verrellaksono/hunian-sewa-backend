const { pool } = require('../../db');
const ApiError = require('../../utils/ApiError');
const { paginated } = require('../../utils/pagination');
const { formatRupiah } = require('../../utils/datetime');

// Tambah field terformat rupiah untuk tampilan
function formatRoomRow(row) {
  return { ...row, price_rupiah: row.price === null ? null : formatRupiah(row.price) };
}

const VALID_STATUS = ['available', 'occupied', 'maintenance'];

// Daftar kamar
async function list(req, res, next) {
  try {
    // Validasi Filter Status
    const status = req.query.status;
    if (status && !VALID_STATUS.includes(status)) {
      throw new ApiError(400, `Filter status harus salah satu dari: ${VALID_STATUS.join(', ')}.`);
    }

    // Query dasar, ditambah filter status bila diberikan
    const where = [];
    const params = [];
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // Query hitung total
    const total = Number(
      (await pool.query(`SELECT count(*) AS n FROM rooms ${whereSql}`, params)).rows[0].n
    );

    // Query data halaman
    params.push(req.pagination.limit, req.pagination.offset);
    const { rows } = await pool.query(
      `SELECT id, room_number, room_type, facilities, price, status, created_at, updated_at
       FROM rooms ${whereSql}
       ORDER BY room_number
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.status(200).json({ success: true, ...paginated(rows.map(formatRoomRow), total, req.pagination) });
  } catch (err) {
    next(err);
  }
}

// Tambah kamar
async function create(req, res, next) {
  try {
    const { room_number, room_type, facilities, price, status } = req.body || {};

    // Validasi Wajib Isi
    if (!room_number || !room_type) {
      throw new ApiError(400, 'Nomor kamar dan tipe kamar wajib diisi.');
    }
    // Validasi Harga Harus Angka Positif
    if (price !== undefined && price !== null && (!(Number(price) > 0) || !Number.isFinite(Number(price)))) {
      throw new ApiError(400, 'Harga sewa harus berupa angka lebih besar dari 0.');
    }
    // Validasi Status Tidak Boleh Diinput Manual (diatur otomatis oleh kontrak)
    if (status !== undefined) {
      throw new ApiError(400, 'Status kamar tidak dapat diinput manual. Kamar baru otomatis tersedia; status diatur sistem.');
    }

    // Validasi Nomor Kamar Sudah Dipakai
    const nomor = String(room_number).trim();
    const dup = await pool.query(`SELECT 1 FROM rooms WHERE room_number = $1 LIMIT 1`, [nomor]);
    if (dup.rowCount > 0) {
      throw new ApiError(409, `Nomor kamar ${nomor} sudah dipakai.`);
    }

    // Insert kamar baru
    const { rows } = await pool.query(
      `INSERT INTO rooms (room_number, room_type, facilities, price)
       VALUES ($1, $2, $3, $4)
       RETURNING id, room_number, room_type, facilities, price, status, created_at, updated_at`,
      [nomor, String(room_type).trim(), facilities ?? null, price === '' ? null : price]
    );

    res.status(201).json({ success: true, message: 'Kamar berhasil ditambahkan.', data: formatRoomRow(rows[0]) });
  } catch (err) {
    next(err);
  }
}

// Ubah kamar
async function update(req, res, next) {
  try {
    const { room_number, room_type, facilities, price, status } = req.body || {};
    const isOwner = req.user.role === 'owner';

    // Validasi Minimal Satu Field
    const allUndefined =
      room_number === undefined &&
      room_type === undefined &&
      facilities === undefined &&
      price === undefined &&
      status === undefined;
    if (allUndefined) {
      throw new ApiError(400, 'Isi minimal satu field yang ingin diubah.');
    }

    // Query cari kamar
    const room = (await pool.query(
      `SELECT id, room_number, room_type, facilities, price, status FROM rooms WHERE id = $1 LIMIT 1`,
      [req.params.id]
    )).rows[0];
    // Validasi Kamar Ditemukan
    if (!room) throw new ApiError(404, 'Kamar tidak ditemukan.');

    // Validasi Hak Caretaker (caretaker tidak boleh ubah harga & status)
    if (!isOwner && (price !== undefined || status !== undefined)) {
      throw new ApiError(403, 'Perubahan harga sewa dan status kamar hanya dapat dilakukan oleh owner.');
    }

    // Validasi Harga Harus Angka Positif
    if (price !== undefined && (!(Number(price) > 0) || !Number.isFinite(Number(price)))) {
      throw new ApiError(400, 'Harga sewa harus berupa angka lebih besar dari 0.');
    }

    // Validasi Aturan Status (available/occupied diatur otomatis oleh kontrak)
    if (status !== undefined) {
      if (status === 'occupied') {
        throw new ApiError(400, 'Status occupied diatur otomatis oleh sistem saat kamar terkontrak.');
      }
      if (status === 'available' && room.status !== 'maintenance') {
        throw new ApiError(400, 'Status available diatur otomatis oleh sistem. Kamar hanya dapat dikembalikan ke available dari kondisi maintenance.');
      }
    }

    // Susun field yang boleh diubah
    const fields = {};
    if (room_number !== undefined) fields.room_number = String(room_number).trim();
    if (room_type !== undefined) fields.room_type = String(room_type).trim();
    if (facilities !== undefined) fields.facilities = facilities;
    if (price !== undefined) fields.price = price;
    if (status !== undefined) fields.status = status;

    // Validasi Nomor Kamar Tidak Boleh Diubah Saat Terisi
    if (fields.room_number && room.status === 'occupied') {
      throw new ApiError(409, 'Nomor kamar tidak dapat diubah saat kamar sedang terisi.');
    }

    // Validasi Nomor Kamar Sudah Dipakai kamar lain
    if (fields.room_number && fields.room_number !== room.room_number) {
      const dup = await pool.query(`SELECT id FROM rooms WHERE room_number = $1 LIMIT 1`, [fields.room_number]);
      if (dup.rows[0] && dup.rows[0].id !== room.id) {
        throw new ApiError(409, `Nomor kamar ${fields.room_number} sudah dipakai.`);
      }
    }

    // Bangun SET dinamis dari field yang dikirim
    const keys = Object.keys(fields);
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const updated = await pool.query(
      `UPDATE rooms SET ${sets}, updated_at = now()
       WHERE id = $${keys.length + 1}
       RETURNING id, room_number, room_type, facilities, price, status, created_at, updated_at`,
      [...Object.values(fields), room.id]
    );

    res.status(200).json({ success: true, message: 'Kamar berhasil diperbarui.', data: formatRoomRow(updated.rows[0]) });
  } catch (err) {
    next(err);
  }
}

// Hapus kamar
async function remove(req, res, next) {
  try {
    // Query cari kamar
    const room = (await pool.query(
      `SELECT id, room_number FROM rooms WHERE id = $1 LIMIT 1`,
      [req.params.id]
    )).rows[0];
    // Validasi Kamar Ditemukan
    if (!room) throw new ApiError(404, 'Kamar tidak ditemukan.');

    // Cek kontrak berjalan (pending/active)
    const running = await pool.query(
      `SELECT 1 FROM tenancy_contracts WHERE room_id = $1 AND status IN ('pending', 'active') LIMIT 1`,
      [room.id]
    );
    if (running.rowCount > 0) {
      throw new ApiError(409, 'Kamar sedang terkontrak. Selesaikan dahulu kontraknya sebelum menghapus kamar.');
    }

    // Hapus kamar (tangkap FK bila punya riwayat kontrak lama)
    try {
      await pool.query(`DELETE FROM rooms WHERE id = $1`, [room.id]);
      res.status(200).json({ success: true, message: `Kamar ${room.room_number} berhasil dihapus.` });
    } catch (err) {
      // 23503 = foreign key violation (riwayat kontrak lama masih menunjuk kamar ini)
      if (err.code === '23503') {
        throw new ApiError(409, 'Kamar memiliki riwayat kontrak. Kamar yang pernah terisi tidak dapat dihapus.');
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
