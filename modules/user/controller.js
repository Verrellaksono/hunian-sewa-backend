const bcrypt = require('bcrypt');
const crypto = require('crypto');

const { pool, withTransaction } = require('../../db');
const ApiError = require('../../utils/ApiError');

const VALID_ROLES = ['owner', 'caretaker', 'tenant', 'guardian'];

// Lihat profil sendiri
async function getMe(req, res, next) {
  try {
    // Query ambil profil + info wali
    const { rows } = await withTransaction((client) =>
      client.query(
        `SELECT u.id, u.name, u.email, u.phone, u.role, u.guardian_id, u.is_active, u.created_at,
                g.name AS guardian_name, g.email AS guardian_email, g.phone AS guardian_phone
         FROM users u LEFT JOIN users g ON g.id = u.guardian_id
         WHERE u.id = $1 LIMIT 1`,
        [req.user.id]
      )
    );
    res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

// Ubah profil sendiri
async function updateMe(req, res, next) {
  try {
    const { name, phone } = req.body || {};

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
        [req.user.id, name ? name.trim() : null, phone !== undefined && phone !== null ? String(phone).trim() : null]
      )
    );
    res.status(200).json({ success: true, message: 'Profil berhasil diperbarui.', data: updated.rows[0] });
  } catch (err) {
    next(err);
  }
}

// Ganti password sendiri
async function changeMyPassword(req, res, next) {
  try {
    const { old_password, new_password } = req.body || {};

    // Validasi Wajib Isi
    if (!old_password || !new_password) {
      throw new ApiError(400, 'Password lama dan password baru wajib diisi.');
    }
    // Validasi Password Baru
    if (String(new_password).length < 8) {
      throw new ApiError(400, 'Password baru minimal 8 karakter.');
    }

    // Query ambil hash password lama
    const { rows } = await withTransaction((client) =>
      client.query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id])
    );
    if (!rows[0]) throw new ApiError(404, 'Pengguna tidak ditemukan.');

    // Membandingkan password lama dengan password di database
    const match = await bcrypt.compare(String(old_password), rows[0].password_hash);
    if (!match) throw new ApiError(400, 'Password lama salah.');

    // Ubah password
    const hash = await bcrypt.hash(String(new_password), 10);
    await withTransaction((client) =>
      client.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [req.user.id, hash])
    );

    res.status(200).json({ success: true, message: 'Password berhasil diubah. Silakan login ulang dengan password baru.' });
  } catch (err) {
    next(err);
  }
}

// Daftarkan akun baru
async function registerAccount(req, res, next) {
  try {
    const { name, email, phone, role, guardian_id } = req.body || {};
    const guardianId = guardian_id ? Number(guardian_id) : null;

    // Validasi Wajib Isi
    if (!name || !email || !phone || !role) {
      throw new ApiError(400, 'Nama, email, nomor telepon, dan peran wajib diisi.');
    }
    // Validasi Peran
    if (!VALID_ROLES.includes(role)) {
      throw new ApiError(400, `Peran harus salah satu dari: ${VALID_ROLES.join(', ')}.`);
    }
    // Validasi Hak Caretaker (caretaker hanya boleh daftarkan tenant & guardian)
    if (req.user.role !== 'owner' && !['tenant', 'guardian'].includes(role)) {
      throw new ApiError(403, 'Caretaker hanya dapat mendaftarkan akun tenant dan guardian.');
    }
    // Validasi Format Email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      throw new ApiError(400, 'Format email tidak valid.');
    }
    // Validasi Format Nomor Telepon
    if (!/^[0-9+\-]{8,20}$/.test(String(phone).trim())) {
      throw new ApiError(400, 'Format nomor telepon tidak valid (8-20 digit, boleh diawali +).');
    }
    // Validasi Penautan Wali (hanya akun tenant yang boleh punya wali)
    if (guardianId && role !== 'tenant') {
      throw new ApiError(400, 'Penautan wali hanya berlaku untuk akun tenant.');
    }

    // Normalisasi email ke lowercase
    const normalized = String(email).trim().toLowerCase();

    // Validasi Email Sudah Terdaftar
    const dup = await pool.query(`SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`, [normalized]);
    if (dup.rowCount > 0) {
      throw new ApiError(409, `Email ${normalized} sudah terdaftar.`);
    }

    // Validasi Wali Harus Akun Guardian
    if (guardianId) {
      const g = (await pool.query(`SELECT id, role FROM users WHERE id = $1 LIMIT 1`, [guardianId])).rows[0];
      if (!g) throw new ApiError(400, 'Wali tidak ditemukan.');
      if (g.role !== 'guardian') throw new ApiError(400, 'Penautan wali hanya boleh merujuk akun dengan peran guardian.');
    }

    // Generate password sementara acak (12 karakter URL-safe)
    const temporaryPassword = crypto.randomBytes(9).toString('base64url');
    const hash = await bcrypt.hash(temporaryPassword, 10);

    // Insert akun baru
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, phone, role, guardian_id, password_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id, name, email, phone, role, guardian_id, is_active, created_at`,
      [name.trim(), normalized, phone.trim(), role, guardianId || null, hash]
    );

    // Password sementara dikembalikan SEKALI di respons ini
    res.status(201).json({
      success: true,
      message: 'Akun berhasil didaftarkan. Simpan password sementara ini — hanya ditampilkan sekali.',
      data: rows[0],
      temporary_password: temporaryPassword,
    });
  } catch (err) {
    next(err);
  }
}

// Cari akun untuk dikelola + validasi hak actor
async function findManageableAccount(req, id) {
  // Query cari akun target
  const target = (await pool.query(
    `SELECT id, name, email, phone, role, guardian_id, is_active, created_at FROM users WHERE id = $1 LIMIT 1`,
    [id]
  )).rows[0];
  // Validasi Akun Ditemukan
  if (!target) throw new ApiError(404, 'Akun tidak ditemukan.');

  // Validasi Hak Caretaker (aturan bisnis #7: caretaker tidak boleh menyentuh caretaker lain & owner)
  if (req.user.role !== 'owner' && !['tenant', 'guardian'].includes(target.role)) {
    throw new ApiError(403, 'Caretaker hanya dapat mengelola akun tenant dan guardian.');
  }
  return target;
}

// Aktifkan akun
async function activateUser(req, res, next) {
  try {
    const target = await findManageableAccount(req, req.params.id);

    // Query aktifkan akun
    const updated = await pool.query(
      `UPDATE users SET is_active = true, updated_at = now() WHERE id = $1
       RETURNING id, name, email, phone, role, guardian_id, is_active, created_at`,
      [target.id]
    );
    res.status(200).json({ success: true, message: `Akun ${target.name} berhasil diaktifkan.`, data: updated.rows[0] });
  } catch (err) {
    next(err);
  }
}

// Deaktivasi akun
async function deactivateUser(req, res, next) {
  try {
    const target = await findManageableAccount(req, req.params.id);
    // Validasi Tidak Boleh Akun Sendiri
    if (target.id === req.user.id) {
      throw new ApiError(403, 'Tidak dapat menonaktifkan akun Anda sendiri.');
    }

    // Query nonaktifkan akun (akses terputus otomatis via middleware auth)
    const updated = await pool.query(
      `UPDATE users SET is_active = false, updated_at = now() WHERE id = $1
       RETURNING id, name, email, phone, role, guardian_id, is_active, created_at`,
      [target.id]
    );
    res.status(200).json({ success: true, message: `Akun ${target.name} berhasil dinonaktifkan.`, data: updated.rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { getMe, updateMe, changeMyPassword, registerAccount, activateUser, deactivateUser };
