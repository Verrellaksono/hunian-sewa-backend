// Middleware auth: verifikasi JWT + cek is_active ke DB di TIAP request.
// User yang dinonaktifkan saat token masih valid → langsung ditolak (403).
const jwt = require('jsonwebtoken');

const config = require('../config');
const { pool } = require('../db');
const ApiError = require('../utils/ApiError');

// Kolom profil yang ditempel ke req.user
const PROFILE_COLUMNS = `id, name, email, phone, role, guardian_id, is_active, created_at`;

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      throw new ApiError(401, 'Token tidak ditemukan. Silakan login terlebih dahulu.');
    }

    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret);
    } catch {
      throw new ApiError(401, 'Token tidak valid atau sudah kedaluwarsa. Silakan login kembali.');
    }

    const { rows } = await pool.query(
      `SELECT ${PROFILE_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
      [payload.sub]
    );
    const user = rows[0];

    // Token valid tapi akun sudah dinonaktifkan / dihapus → tetap tolak
    if (!user || !user.is_active) {
      throw new ApiError(403, 'Akun Anda tidak ditemukan atau telah dinonaktifkan. Hubungi pengelola.');
    }

    req.user = user; // profil dipakai middleware/rute berikutnya
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = auth;
