const fs = require('fs/promises');
const path = require('path');

const { pool } = require('../../db');
const config = require('../../config');
const ApiError = require('../../utils/ApiError');
const { finalizePhotoUpload } = require('../../utils/photo');
const { paginated } = require('../../utils/pagination');

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
        `SELECT t.id, ('T-' || lpad(t.id::text, 4, '0')) AS ticket_number,
                t.contract_id, t.category, t.description, t.photo_path, t.status,
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

    // Detail tiket terbaru, lengkap nomor kamar & penyewa via join
    const ticket = (await pool.query(
      `SELECT t.id, ('T-' || lpad(t.id::text, 4, '0')) AS ticket_number,
              t.contract_id, t.category, t.description, t.photo_path, t.status,
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

// Kolom tiket, kamar, penyewa & wali
const TICKET_SELECT = `
  SELECT t.id, ('T-' || lpad(t.id::text, 4, '0')) AS ticket_number,
         t.contract_id, t.category, t.description, t.photo_path, t.status,
         t.technical_note, t.resolved_at, t.created_at, t.updated_at,
         r.room_number, u.name AS tenant_name, c.tenant_id
  FROM issue_tickets t
  JOIN tenancy_contracts c ON c.id = t.contract_id
  JOIN rooms r ON r.id = c.room_id
  JOIN users u ON u.id = c.tenant_id`;

// Validasi ID 
function parseId(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError(400, `${label} tidak valid.`);
  }
  return n;
}

// Ambil tiket — owner/caretaker bebas; hanya tenant pelapor; guardian TIDAK boleh melihat tiket
async function getTicketForUser(req, id) {
  const ticket = (await pool.query(`${TICKET_SELECT} WHERE t.id = $1`, [id])).rows[0];
  // Validasi Tiket Ditemukan
  if (!ticket) throw new ApiError(404, 'Tiket tidak ditemukan.');
  const allowed =
    req.user.role === 'owner' ||
    req.user.role === 'caretaker' ||
    (req.user.role === 'tenant' && ticket.tenant_id === req.user.id);
  if (!allowed) throw new ApiError(403, 'Anda tidak berhak mengakses tiket ini.');
  return ticket;
}

// Daftar tiket — owner/caretaker semua; tenant miliknya; guardian ditolak
async function list(req, res, next) {
  try {
    // Validasi Role Guardian (tidak berhak melihat tiket kerusakan)
    if (req.user.role === 'guardian') {
      throw new ApiError(403, 'Guardian tidak berhak mengakses tiket kerusakan.');
    }
    const params = [];
    let where = '';
    if (req.user.role !== 'owner' && req.user.role !== 'caretaker') {
      params.push(req.user.id);
      where = `WHERE c.tenant_id = $1`;
    }
    // Filter status opsional
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (status) {
      if (!['pending', 'in_progress', 'resolved'].includes(status)) {
        throw new ApiError(400, 'Status tidak valid.');
      }
      params.push(status);
      where += `${where ? ' AND ' : ' WHERE '}t.status = $${params.length}`;
    }
    // Filter kategori opsional
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    if (category) {
      if (!CATEGORIES.includes(category)) {
        throw new ApiError(400, `Kategori harus salah satu dari: ${CATEGORIES.join(', ')}.`);
      }
      params.push(category);
      where += `${where ? ' AND ' : ' WHERE '}t.category = $${params.length}`;
    }
    const clause = where;
    const total = Number(
      (await pool.query(
        `SELECT count(*) AS n
         FROM issue_tickets t
         JOIN tenancy_contracts c ON c.id = t.contract_id
         ${clause}`,
        params
      )).rows[0].n
    );

    // Ambil satu halaman data
    params.push(req.pagination.limit, req.pagination.offset);
    const { rows } = await pool.query(
      `${TICKET_SELECT} ${where} ORDER BY t.created_at DESC, t.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.status(200).json({ success: true, ...paginated(rows, total, req.pagination) });
  } catch (err) {
    next(err);
  }
}

// Detail satu tiket
async function getById(req, res, next) {
  try {
    const ticket = await getTicketForUser(req, parseId(req.params.id, 'ID tiket'));
    res.status(200).json({ success: true, data: ticket });
  } catch (err) {
    next(err);
  }
}

// Daftar komentar diskusi tiket 
async function listComments(req, res, next) {
  try {
    const id = parseId(req.params.id, 'ID tiket');
    await getTicketForUser(req, id);
    const total = Number(
      (await pool.query(`SELECT count(*) AS n FROM ticket_comments WHERE ticket_id = $1`, [id])).rows[0].n
    );
    const params = [id, req.pagination.limit, req.pagination.offset];
    const { rows } = await pool.query(
      `SELECT k.id, k.ticket_id, k.user_id, k.message, k.created_at,
              u.name AS user_name, u.role AS user_role
       FROM ticket_comments k
       JOIN users u ON u.id = k.user_id
       WHERE k.ticket_id = $1
       ORDER BY k.id
       LIMIT $2 OFFSET $3`,
      params
    );
    res.status(200).json({ success: true, ...paginated(rows, total, req.pagination) });
  } catch (err) {
    next(err);
  }
}

// Tambah komentar diskusi 
async function addComment(req, res, next) {
  try {
    const id = parseId(req.params.id, 'ID tiket');
    const { message } = req.body || {};

    // Validasi Pesan
    if (typeof message !== 'string' || !message.trim()) {
      throw new ApiError(400, 'Pesan komentar wajib diisi.');
    }
    const ticket = await getTicketForUser(req, id);
    // Validasi Hak Menulis Diskusi
    const bolehTulis =
      req.user.role === 'caretaker' ||
      (req.user.role === 'tenant' && ticket.tenant_id === req.user.id);
    if (!bolehTulis) {
      throw new ApiError(403, 'Anda hanya dapat membaca diskusi tiket ini.');
    }

    const { rows } = await pool.query(
      `INSERT INTO ticket_comments (ticket_id, user_id, message)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [id, req.user.id, message.trim()]
    );
    const comment = (await pool.query(
      `SELECT k.id, k.ticket_id, k.user_id, k.message, k.created_at,
              u.name AS user_name, u.role AS user_role
       FROM ticket_comments k
       JOIN users u ON u.id = k.user_id
       WHERE k.id = $1`,
      [rows[0].id]
    )).rows[0];
    res.status(201).json({ success: true, message: 'Komentar berhasil ditambahkan.', data: comment });
  } catch (err) {
    next(err);
  }
}

module.exports = { create, updateStatus, list, getById, listComments, addComment, CATEGORIES };
