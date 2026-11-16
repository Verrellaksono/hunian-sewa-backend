require('dotenv').config();
const { pool } = require('./index');

(async () => {
  // Query daftar tabel
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`
  );
  console.log('TABEL:', tables.rows.map((r) => r.table_name).join(', '));

  const idx = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname LIKE '%unique%' ORDER BY 1`
  );
  console.log('INDEX UNIK:', idx.rows.map((r) => r.indexname).join(', '));

  await pool.end();
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
