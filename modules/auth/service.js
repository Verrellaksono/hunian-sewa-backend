const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const config = require('../../config');
const { withTransaction } = require('../../db');
const ApiError = require('../../utils/ApiError');

// Kolom profil dasar yang dikembalikan setelah login
const PROFILE_COLUMNS = `id, name, email, phone, role, guardian_id, is_active, created_at`;

async function login({ email, password }) {
  // Normalisasi email: lowercase + trim (email di DB selalu lowercase)
  const normalized = String(email || '').trim().toLowerCase();

  const { rows } = await withTransaction((client) =>
    client.query(
      `SELECT ${PROFILE_COLUMNS}, password_hash FROM users WHERE lower(email) = $1 LIMIT 1`,
      [normalized]
    )
  );

  const user = rows[0];
  if (!user) throw new ApiError(401, 'Email atau password salah.');

  // Bandingkan password dengan hash bcrypt (kolom password_hash tidak ikut respons)
  const match = await bcrypt.compare(String(password || ''), user.password_hash);
  if (!match) throw new ApiError(401, 'Email atau password salah.');

  // Aturan bisnis: akun nonaktif tidak boleh login
  if (!user.is_active) throw new ApiError(403, 'Akun Anda dinonaktifkan. Hubungi pengelola.');

  const payload = {
    sub: user.id,
    role: user.role,
    email: user.email,
  };

  const token = jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

  // Buang hash sebelum respons
  const { password_hash, ...profile } = user;

  return { token, user: profile };
}

module.exports = { login };
