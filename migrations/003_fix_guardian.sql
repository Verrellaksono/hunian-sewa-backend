-- 003_fix_guardian.sql — perbaikan penautan wali untuk DB yang sudah menerapkan 002 lama
UPDATE users
SET guardian_id = (SELECT id FROM users WHERE email = 'guardian@hunian.test')
WHERE email = 'tenant@hunian.test' AND guardian_id IS NULL;
