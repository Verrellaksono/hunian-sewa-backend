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

module.exports = { create, CATEGORIES };
