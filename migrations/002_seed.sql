CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --- Akun pengguna ---
INSERT INTO users (name, email, password_hash, phone, role, guardian_id, is_active) VALUES
  ('Pemilik Kos Demo',      'owner@hunian.test',     crypt('Kos12345!', gen_salt('bf', 10)), '081200000001', 'owner',     NULL, TRUE),
  ('Pengelola Kos Demo',    'caretaker@hunian.test', crypt('Kos12345!', gen_salt('bf', 10)), '081200000002', 'caretaker', NULL, TRUE),
  ('Wali Demo',             'guardian@hunian.test',  crypt('Kos12345!', gen_salt('bf', 10)), '081200000003', 'guardian',  NULL, TRUE),
  ('Penyewa Demo',          'tenant@hunian.test',    crypt('Kos12345!', gen_salt('bf', 10)), '081200000004', 'tenant',
    (SELECT id FROM users WHERE email = 'guardian@hunian.test'), TRUE),
  ('Penyewa Tanpa Wali',    'tenant2@hunian.test',   crypt('Kos12345!', gen_salt('bf', 10)), '081200000005', 'tenant', NULL, TRUE)
ON CONFLICT DO NOTHING;

-- --- Penautan wali ---
UPDATE users
SET guardian_id = (SELECT id FROM users WHERE email = 'guardian@hunian.test')
WHERE email = 'tenant@hunian.test' AND guardian_id IS NULL;

-- --- Kamar ---
INSERT INTO rooms (room_number, room_type, facilities, price, status) VALUES
  ('A01', 'Standard', 'Kasur, lemari, kipas, WiFi', 1500000, 'available'),
  ('A02', 'Standard', 'Kasur, lemari, kipas, WiFi', 1500000, 'available'),
  ('A03', 'Deluxe',   'AC, kasur, lemari, WiFi, kamar mandi dalam', 2500000, 'available'),
  ('A04', 'Deluxe',   'AC, kasur, lemari, WiFi, kamar mandi dalam', NULL,    'available'),  -- tanpa harga: tidak boleh dikontrakkan
  ('B01', 'Standard', 'Kasur, lemari, kipas, WiFi', 1500000, 'maintenance') -- maintenance: tidak boleh dikontrakkan
ON CONFLICT (room_number) DO NOTHING;

-- --- Pengumuman ---
INSERT INTO announcements (author_id, title, content, category, published_at)
SELECT u.id, 'Selamat datang di sistem', 'Gunakan sistem ini untuk pengumuman resmi, laporan kerusakan, dan pembayaran sewa.', 'routine', now()
FROM users u WHERE u.email = 'caretaker@hunian.test'
AND NOT EXISTS (SELECT 1 FROM announcements);
