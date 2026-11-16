const { pool } = require('../../db');
const { paginated } = require('../../utils/pagination');

// Daftar pengumuman (Descending)
async function list(req, res, next) {
  try {
    // Query hitung total
    const total = Number((await pool.query(`SELECT count(*) AS n FROM announcements`)).rows[0].n);

    // Query data halaman + nama penulis
    const params = [req.pagination.limit, req.pagination.offset];
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.content, a.category, a.published_at, a.updated_at,
              u.name AS author_name
       FROM announcements a JOIN users u ON u.id = a.author_id
       ORDER BY a.published_at DESC, a.id DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    res.status(200).json({ success: true, ...paginated(rows, total, req.pagination) });
  } catch (err) {
    next(err);
  }
}

module.exports = { list };
