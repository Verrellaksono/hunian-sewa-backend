const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const config = require('../../config');
const { withTransaction } = require('../../db');
const ApiError = require('../../utils/ApiError');

// Login
async function login({ email, password }) {
  // Normalisasi email ke lowercase
  const normalized = String(email || '').trim().toLowerCase();

  // Query cari user
  const { rows } = await withTransaction((client) =>
    client.query(
      `SELECT id, name, email, phone, role, guardian_id, is_active, created_at, password_hash FROM users WHERE lower(email) = $1 LIMIT 1`,
      [normalized]
    )
  );

  const user = rows[0];
  // Validasi User Terdaftar
  if (!user) throw new ApiError(401, 'Email atau password salah.');

  // Membandingkan password dengan hash di database
  const match = await bcrypt.compare(String(password || ''), user.password_hash);
  // Validasi Password
  if (!match) throw new ApiError(401, 'Email atau password salah.');

  // Validasi Akun Aktif
  if (!user.is_active) throw new ApiError(403, 'Akun Anda dinonaktifkan. Hubungi pengelola.');

  // Buat token JWT
  const payload = {
    sub: user.id,
    role: user.role,
    email: user.email,
  };
  const token = jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

  // Buang hash dari respons
  const { password_hash, ...profile } = user;

  return { token, user: profile };
}

module.exports = { login };
