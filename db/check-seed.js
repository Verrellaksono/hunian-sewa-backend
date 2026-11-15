// Verifikasi data seed: jumlah akun per peran + kamar + hash password bisa diverifikasi
require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool } = require('./index');

(async () => {
  const roles = await pool.query(
    `SELECT role, count(*) FROM users GROUP BY role ORDER BY role`
  );
  console.log('AKUN:', roles.rows.map((r) => `${r.role}=${r.count}`).join(', '));

  const tenant = await pool.query(
    `SELECT u.email, g.email AS wali FROM users u JOIN users g ON g.id = u.guardian_id WHERE u.role='tenant'`
  );
  console.log('PENAUTAN WALI:', tenant.rows.map((r) => `${r.email} → ${r.wali}`).join(' | '));

  const rooms = await pool.query(`SELECT room_number, price, status FROM rooms ORDER BY id`);
  console.log('KAMAR:', rooms.rows.map((r) => `${r.room_number}(Rp${r.price ?? 'null'}/${r.status})`).join(', '));

  const hash = (await pool.query(`SELECT password_hash FROM users WHERE email='owner@hunian.test'`)).rows[0].password_hash;
  console.log('VERIFIKASI PASSWORD Kos12345!:', await bcrypt.compare('Kos12345!', hash) ? 'OK' : 'GAGAL');

  const ann = await pool.query(`SELECT count(*) AS c FROM announcements`);
  console.log('PENGUMUMAN:', ann.rows[0].c);

  await pool.end();
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
