const bcrypt = require('bcrypt');

const { pool, withTransaction } = require('../../db');
const ApiError = require('../../utils/ApiError');

// Profil
async function getProfile(userId) {
  // Query ambil profil
  const { rows } = await withTransaction((client) =>
    client.query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.guardian_id, u.is_active, u.created_at,
              g.name AS guardian_name, g.email AS guardian_email, g.phone AS guardian_phone
       FROM users u LEFT JOIN users g ON g.id = u.guardian_id
       WHERE u.id = $1 LIMIT 1`,
      [userId]
    )
  );
  return rows[0];
}

// Ubah profil
async function updateProfile(userId, { name, phone }) {
  // Validasi Wajib Isi
  if (!name && !phone) {
    throw new ApiError(400, 'Isi minimal satu field yang ingin diubah (name dan/atau phone).');
  }
  // Validasi Nama
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      throw new ApiError(400, 'Nama wajib 2-100 karakter.');
    }
  }
  // Validasi Nomor Telepon
  if (phone !== undefined && phone !== null) {
    if (!/^[0-9+\-]{8,20}$/.test(String(phone).trim())) {
      throw new ApiError(400, 'Format nomor telepon tidak valid (8-20 digit, boleh diawali +).');
    }
  }

  // Query update profil
  const updated = await withTransaction((client) =>
    client.query(
      `UPDATE users SET
         name  = COALESCE($2::text, name),
         phone = CASE WHEN $3::text IS NULL THEN phone ELSE $3::text END
       WHERE id = $1
       RETURNING id, name, email, phone, role, guardian_id, is_active, created_at`,
      [userId, name ? name.trim() : null, phone !== undefined && phone !== null ? String(phone).trim() : null]
    )
  );
  return updated.rows[0];
}

// Ganti password
async function changePassword(userId, { old_password, new_password }) {
  // Validasi Wajib Isi
  if (!old_password || !new_password) {
    throw new ApiError(400, 'Password lama dan password baru wajib diisi.');
  }
  // Validasi Password Baru
  if (String(new_password).length < 8) {
    throw new ApiError(400, 'Password baru minimal 8 karakter.');
  }

  // Validasi User dengan Password Lama 
  const { rows } = await withTransaction((client) =>
    client.query(`SELECT password_hash FROM users WHERE id = $1`, [userId])
  );
  if (!rows[0]) throw new ApiError(404, 'Pengguna tidak ditemukan.');

  // Membandingkan password lama dengan password di database
  const match = await bcrypt.compare(String(old_password), rows[0].password_hash);
  if (!match) throw new ApiError(400, 'Password lama salah.');

  // Ubah password
  const hash = await bcrypt.hash(String(new_password), 10);
  await withTransaction((client) =>
    client.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, hash])
  );

  return { message: 'Password berhasil diubah. Silakan login ulang dengan password baru.' };
}

module.exports = { getProfile, updateProfile, changePassword };
