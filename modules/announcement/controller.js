const { pool } = require('../../db');
const ApiError = require('../../utils/ApiError');
const { paginated } = require('../../utils/pagination');

const VALID_CATEGORIES = ['urgent', 'routine', 'maintenance'];

// Daftar pengumuman (urut kronologis terbaru)
async function list(req, res, next) {
  try {
    // Validasi Filter Kategori
    const params = [];
    let where = '';
    if (req.query.category !== undefined) {
      if (!VALID_CATEGORIES.includes(req.query.category)) {
        throw new ApiError(400, `Filter kategori harus salah satu dari: ${VALID_CATEGORIES.join(', ')}.`);
      }
      params.push(req.query.category);
      where = `WHERE a.category = $1`;
    }

    // Query hitung total
    const total = Number((await pool.query(`SELECT count(*) AS n FROM announcements a ${where}`, params)).rows[0].n);

    // Query data halaman dan nama penulis
    params.push(req.pagination.limit, req.pagination.offset);
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.content, a.category, a.published_at, a.updated_at,
              u.name AS author_name
       FROM announcements a JOIN users u ON u.id = a.author_id
       ${where}
       ORDER BY a.published_at DESC, a.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.status(200).json({ success: true, ...paginated(rows, total, req.pagination) });
  } catch (err) {
    next(err);
  }
}

// Tambah pengumuman
async function create(req, res, next) {
  try {
    const { title, content, category } = req.body || {};

    // Validasi Wajib Isi
    if (title === undefined || content === undefined || category === undefined) {
      throw new ApiError(400, 'Judul, isi, dan kategori wajib diisi.');
    }
    // Validasi Judul
    if (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 150) {
      throw new ApiError(400, 'Judul wajib 3-150 karakter.');
    }
    // Validasi Isi Tidak Boleh Kosong
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new ApiError(400, 'Isi pengumuman tidak boleh kosong.');
    }
    // Validasi Kategori
    if (!VALID_CATEGORIES.includes(category)) {
      throw new ApiError(400, `Kategori harus salah satu dari: ${VALID_CATEGORIES.join(', ')}.`);
    }

    // Insert pengumuman (penulis dari token, published_at otomatis now())
    const { rows } = await pool.query(
      `INSERT INTO announcements (author_id, title, content, category)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, content, category, published_at, updated_at`,
      [req.user.id, title.trim(), String(content).trim(), category]
    );

    res.status(201).json({ success: true, message: 'Pengumuman berhasil ditambahkan.', data: rows[0] });
  } catch (err) {
    next(err);
  }
}

// Ubah pengumuman
async function update(req, res, next) {
  try {
    const { title, content, category } = req.body || {};

    // Validasi Minimal Satu Field
    if (title === undefined && content === undefined && category === undefined) {
      throw new ApiError(400, 'Isi minimal satu field yang ingin diubah.');
    }
    // Validasi Judul
    if (title !== undefined && (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 150)) {
      throw new ApiError(400, 'Judul wajib 3-150 karakter.');
    }
    // Validasi Isi Tidak Boleh Kosong
    if (content !== undefined && (typeof content !== 'string' || content.trim().length === 0)) {
      throw new ApiError(400, 'Isi pengumuman tidak boleh kosong.');
    }
    // Validasi Kategori
    if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
      throw new ApiError(400, `Kategori harus salah satu dari: ${VALID_CATEGORIES.join(', ')}.`);
    }

    // Query cari pengumuman
    const existing = (await pool.query(`SELECT id FROM announcements WHERE id = $1 LIMIT 1`, [req.params.id])).rows[0];
    // Validasi Pengumuman Ditemukan
    if (!existing) throw new ApiError(404, 'Pengumuman tidak ditemukan.');

    // Query update pengumuman
    const updated = await pool.query(
      `UPDATE announcements SET
         title    = COALESCE($2::text, title),
         content  = COALESCE($3::text, content),
         category = COALESCE($4::text, category),
         updated_at = now()
       WHERE id = $1
       RETURNING id, title, content, category, published_at, updated_at`,
      [existing.id, title !== undefined ? title.trim() : null, content !== undefined ? String(content).trim() : null, category ?? null]
    );

    res.status(200).json({ success: true, message: 'Pengumuman berhasil diperbarui.', data: updated.rows[0] });
  } catch (err) {
    next(err);
  }
}

// Hapus pengumuman
async function remove(req, res, next) {
  try {
    // Query hapus pengumuman
    const { rows } = await pool.query(
      `DELETE FROM announcements WHERE id = $1 RETURNING id, title`,
      [req.params.id]
    );
    // Validasi Pengumuman Ditemukan
    if (!rows[0]) throw new ApiError(404, 'Pengumuman tidak ditemukan.');

    res.status(200).json({ success: true, message: `Pengumuman "${rows[0].title}" berhasil dihapus.` });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
