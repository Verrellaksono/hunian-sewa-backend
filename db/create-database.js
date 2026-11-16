require('dotenv').config();
const { Pool } = require('pg');
const cfg = require('../config');

const admin = new Pool({
  host: cfg.db.host,
  port: cfg.db.port,
  user: cfg.db.user,
  password: cfg.db.password,
  database: 'postgres',
});

(async () => {
  const r = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', ['hunian_sewa']);
  if (r.rowCount > 0) {
    console.log('DB hunian_sewa sudah ada');
  } else {
    await admin.query('CREATE DATABASE hunian_sewa');
    console.log('DB hunian_sewa BERHASIL DIBUAT');
  }
  await admin.end();
})().catch((e) => { console.error('GAGAL:', e.message); admin.end(); process.exit(1); });
