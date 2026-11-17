const fs = require('fs/promises');
const path = require('path');

const { pool } = require('../../db');
const config = require('../../config');
const ApiError = require('../../utils/ApiError');
const { finalizePhotoUpload } = require('../../utils/photo');

// Daftar kategori tetap tiket Kerusakan
const CATEGORIES = ['Listrik', 'Air', 'Internet', 'AC', 'Furnitur', 'Kebersihan', 'Lainnya'];

// Buat tiket kerusakan
async function create(req, res, next) {
  try {
    const { category, description, contract_id } = req.body || {};

    // Validasi Kontrak Aktif
    if (!Array.isArray(req.contractIds) || req.contractIds.length === 0) {
      throw new ApiError(403, 'Anda tidak memiliki kontrak sewa aktif. Hubungi pengelola.');
    }
    // Validasi Tidak Boleh Ada 2 Kontrak Aktif
    if (req.contractIds.length > 1) {
      throw new ApiError(409, 'Anda memiliki lebih dari satu kontrak aktif. Hubungi pengelola.');
    }
    // Validasi Contract ID Otomatis
    if (contract_id !== undefined) {
      throw new ApiError(400, 'contract_id diisi otomatis dari kontrak aktif Anda.');
    }
    // Validasi Kategori
    if (!CATEGORIES.includes(category)) {
      throw new ApiError(400, `Kategori harus salah satu dari: ${CATEGORIES.join(', ')}.`);
    }
    // Validasi Deskripsi
    if (typeof description !== 'string' || !description.trim()) {
      throw new ApiError(400, 'Deskripsi kerusakan wajib diisi.');
    }
    // Finalisasi foto 
    const photoName = await finalizePhotoUpload(req.file);

    try {
      const { rows } = await pool.query(
        `INSERT INTO issue_tickets (contract_id, category, description, photo_path)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [req.contractIds[0], category, description.trim(), photoName]
      );
      // Nomor kamar via join tabel kontrak-kamar
      const ticket = (await pool.query(
        `SELECT t.id, t.contract_id, t.category, t.description, t.photo_path, t.status,
                t.technical_note, t.created_at, t.updated_at, r.room_number, u.name AS tenant_name
         FROM issue_tickets t
         JOIN tenancy_contracts c ON c.id = t.contract_id
         JOIN rooms r ON r.id = c.room_id
         JOIN users u ON u.id = c.tenant_id
         WHERE t.id = $1`,
        [rows[0].id]
      )).rows[0];
      res.status(201).json({ success: true, message: 'Tiket kerusakan berhasil dibuat.', data: ticket });
    } catch (err) {
      // Simpan tiket gagal, buang foto yang sudah terlanjur tersimpan
      if (photoName) await fs.unlink(path.join(config.upload.dir, photoName)).catch(() => { });
      throw err;
    }
  } catch (err) {
    next(err);
  }
}

// Validasi ID numerik positif dari parameter URL
function parseId(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError(400, `${label} tidak valid.`);
  }
  return n;
}

// Perbarui status tiket oleh caretaker
async function updateStatus(req, res, next) {
  try {
    const { status, technical_note } = req.body || {};
    const id = parseId(req.params.id, 'ID tiket');

    // Validasi Status Baru
    if (status !== 'in_progress' && status !== 'resolved') {
      throw new ApiError(400, "Status baru harus 'in_progress' atau 'resolved'.");
    }
    // Validasi Catatan Teknis (wajib pada setiap perubahan status)
    if (typeof technical_note !== 'string' || !technical_note.trim()) {
      throw new ApiError(400, 'technical_note wajib diisi pada setiap perubahan status.');
    }

    // Status asal yang sah untuk transisi ini (alur satu arah)
    const expectedFrom = status === 'in_progress' ? 'pending' : 'in_progress';
    const updated = await pool.query(
      `UPDATE issue_tickets
       SET status = $3::varchar,
           technical_note = $4,
           resolved_at = CASE WHEN $3::varchar = 'resolved' THEN now() ELSE NULL END,
           resolved_by = CASE WHEN $3::varchar = 'resolved' THEN $5::bigint ELSE NULL END,
           updated_at = now()
       WHERE id = $1 AND status = $2
       RETURNING id`,
      [id, expectedFrom, status, technical_note.trim(), req.user.id]
    );
    if (updated.rows.length === 0) {
      // Bedakan: tiket tidak ada (404) vs alur status melompat/mundur (409)
      const existing = (await pool.query(`SELECT status FROM issue_tickets WHERE id = $1`, [id])).rows[0];
      if (!existing) throw new ApiError(404, 'Tiket tidak ditemukan.');
      if (existing.status === 'resolved') {
        throw new ApiError(409, 'Tiket sudah resolved (final, tidak bisa dibuka lagi). Masalah baru silakan buat tiket baru.');
      }
      throw new ApiError(409, `Perubahan status tidak sesuai alur: pending → in_progress → resolved (status saat ini: ${existing.status}).`);
    }

    // Detail tiket terbaru + nomor kamar & penyewa via join
    const ticket = (await pool.query(
      `SELECT t.id, t.contract_id, t.category, t.description, t.photo_path, t.status,
              t.technical_note, t.resolved_at, t.created_at, t.updated_at, r.room_number, u.name AS tenant_name
       FROM issue_tickets t
       JOIN tenancy_contracts c ON c.id = t.contract_id
       JOIN rooms r ON r.id = c.room_id
       JOIN users u ON u.id = c.tenant_id
       WHERE t.id = $1`,
      [id]
    )).rows[0];
    res.status(200).json({ success: true, message: 'Status tiket berhasil diperbarui.', data: ticket });
  } catch (err) {
    next(err);
  }
}

module.exports = { create, updateStatus, CATEGORIES };
