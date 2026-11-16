require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, withTransaction } = require('./index');

(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const applied = new Set(
    (await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name)
  );

  const files = fs
    .readdirSync(path.join(__dirname, '..', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`LEWATI (sudah diterapkan): ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8');
    await withTransaction((client) => client.query(sql));
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    console.log(`DITERAPKAN: ${file}`);
    count += 1;
  }

  if (count === 0) console.log('Tidak ada migrasi baru.');
  await pool.end();
})().catch((e) => { console.error('MIGRASI GAGAL:', e.message); process.exit(1); });
