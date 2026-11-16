const { pool } = require('../../db');
const ApiError = require('../../utils/ApiError');

// Daftar kamar (paginasi + filter status)
async function list({ status, pagination }) {
  // Query dasar + filter status bila diberikan
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
  params.push(pagination.limit, pagination.offset);
  const { rows } = await pool.query(
    `SELECT id, room_number, room_type, facilities, price, status, created_at, updated_at
     FROM rooms ${whereSql}
     ORDER BY room_number
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { rows, total };
}

// Cari satu kamar
async function findById(id) {
  const { rows } = await pool.query(
    `SELECT id, room_number, room_type, facilities, price, status, created_at, updated_at
     FROM rooms WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

// Cari kamar berdasar nomor
async function findByNumber(roomNumber) {
  const { rows } = await pool.query(`SELECT id, room_number FROM rooms WHERE room_number = $1 LIMIT 1`, [roomNumber]);
  return rows[0] || null;
}

// Tambah kamar
async function create({ room_number, room_type, facilities, price }) {
  // Validasi Nomor Kamar Sudah Dipakai
  const dup = await pool.query(`SELECT 1 FROM rooms WHERE room_number = $1 LIMIT 1`, [room_number]);
  if (dup.rowCount > 0) {
    throw new ApiError(409, `Nomor kamar ${room_number} sudah dipakai.`);
  }

  // Insert kamar baru
  const { rows } = await pool.query(
    `INSERT INTO rooms (room_number, room_type, facilities, price)
     VALUES ($1, $2, $3, $4)
     RETURNING id, room_number, room_type, facilities, price, status, created_at, updated_at`,
    [room_number, room_type, facilities ?? null, price ?? null]
  );
  return rows[0];
}

// Ubah kamar
async function update(id, fields) {
  // Bangun SET dinamis dari field yang dikirim
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');

  const { rows } = await pool.query(
    `UPDATE rooms SET ${sets}, updated_at = now()
     WHERE id = $${keys.length + 1}
     RETURNING id, room_number, room_type, facilities, price, status, created_at, updated_at`,
    [...Object.values(fields), id]
  );
  return rows[0];
}

// Hapus kamar
async function remove(id) {
  // Cari kamar
  const room = await findById(id);
  if (!room) throw new ApiError(404, 'Kamar tidak ditemukan.');

  // Cek kontrak berjalan (pending/active)
  const running = await pool.query(
    `SELECT 1 FROM tenancy_contracts WHERE room_id = $1 AND status IN ('pending', 'active') LIMIT 1`,
    [id]
  );
  if (running.rowCount > 0) {
    throw new ApiError(409, 'Kamar sedang terkontrak. Selesaikan dahulu kontraknya sebelum menghapus kamar.');
  }

  // Hapus kamar (tangkap FK bila punya riwayat kontrak lama)
  try {
    const { rows, rowCount } = await pool.query(`DELETE FROM rooms WHERE id = $1 RETURNING room_number`, [id]);
    return { deleted: rowCount > 0, room_number: rows[0]?.room_number };
  } catch (err) {
    // 23503 = foreign key violation (riwayat kontrak lama masih menunjuk kamar ini)
    if (err.code === '23503') {
      throw new ApiError(409, 'Kamar memiliki riwayat kontrak. Kamar yang pernah terisi tidak dapat dihapus.');
    }
    throw err;
  }
}

module.exports = { list, findById, findByNumber, create, update, remove };
