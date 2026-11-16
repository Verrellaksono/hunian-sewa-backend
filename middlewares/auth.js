const jwt = require('jsonwebtoken');

const config = require('../config');
const { pool } = require('../db');
const ApiError = require('../utils/ApiError');

// Verifikasi token
async function auth(req, res, next) {
  try {
    // Ambil token dari header Authorization
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    // Validasi Token Wajib Ada
    if (!token) {
      throw new ApiError(401, 'Token tidak ditemukan. Silakan login terlebih dahulu.');
    }

    // Verifikasi JWT
    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret);
    } catch {
      throw new ApiError(401, 'Token tidak valid atau sudah kedaluwarsa. Silakan login kembali.');
    }

    // Query cek user
    const { rows } = await pool.query(
      `SELECT id, name, email, phone, role, guardian_id, is_active, created_at FROM users WHERE id = $1 LIMIT 1`,
      [payload.sub]
    );
    const user = rows[0];
    // Validasi Akun Aktif (cek ke DB tiap request)
    if (!user || !user.is_active) {
      throw new ApiError(403, 'Akun Anda tidak ditemukan atau telah dinonaktifkan. Hubungi pengelola.');
    }

    // Tempel profil ke req.user
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = auth;
