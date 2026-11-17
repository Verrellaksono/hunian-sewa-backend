const { Pool, types } = require('pg');
const config = require('../config');

// Kolom DATE dikembalikan apa adanya sebagai 'YYYY-MM-DD' (bukan objek Date dengan zona waktu server)
types.setTypeParser(1082, (value) => value);

// Pool koneksi PostgreSQL — query selalu parameterized (NFR, anti SQL injection)
const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});

// Transaksi helper: denganTransaction(async (client) => { ... }) — auto commit/rollback
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
