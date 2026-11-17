const path = require('path');
const fs = require('fs/promises');

const { pool } = require('../../db');
const config = require('../../config');
const ApiError = require('../../utils/ApiError');

// validasi format ini sekaligus mencegah path traversal dari parameter URL
const FILENAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/;
const CONTENT_TYPES = { jpg: 'image/jpeg', png: 'image/png' };

// Mengambil Foto
async function show(req, res, next) {
  try {
    const filename = String(req.params.filename || '').toLowerCase();

    // Validasi Nama File (uuid dan ekstensi)
    if (!FILENAME_PATTERN.test(filename)) {
      throw new ApiError(400, 'Nama file foto tidak valid.');
    }

    // Foto harus tercatat sebagai photo_path pada sebuah tiket
    const { rows } = await pool.query(
      `SELECT c.tenant_id
       FROM issue_tickets t
       JOIN tenancy_contracts c ON c.id = t.contract_id
       WHERE t.photo_path = $1
       LIMIT 1`,
      [filename]
    );
    const ticket = rows[0];
    // Validasi Foto Terdaftar
    if (!ticket) throw new ApiError(404, 'Foto tidak ditemukan.');

    // Otorisasi Akses
    const allowed =
      req.user.role === 'owner' ||
      req.user.role === 'caretaker' ||
      (req.user.role === 'tenant' && ticket.tenant_id === req.user.id);
    if (!allowed) throw new ApiError(403, 'Anda tidak berhak mengakses foto tiket ini.');

    // Kirim file dari folder uploads (di luar folder publik)
    const filePath = path.join(config.upload.dir, filename);
    // Validasi File Ada di Disk
    try {
      await fs.access(filePath);
    } catch {
      throw new ApiError(404, 'Foto tidak ditemukan di server.');
    }

    const contentType = CONTENT_TYPES[filename.slice(-3)];
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.type(contentType);
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
}

module.exports = { show };
