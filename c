[33mcommit e19e7246a89155415f8dd5db2567c7320560b9c4[m[33m ([m[1;36mHEAD[m[33m -> [m[1;32mmain[m[33m, [m[1;31morigin/main[m[33m, [m[1;31morigin/HEAD[m[33m)[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Tue Nov 17 16:29:55 2026 +0700

    feat(billing): service penerbitan invoice bulanan dengan nomor unik dan guard idempotent

[33mcommit 61e4d8bc6ad9632c3e3a198bad343647258ddb48[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Tue Nov 17 16:12:29 2026 +0700

    feat(ticket): daftar detail dan diskusi tiket dengan scope per role

[33mcommit 6b1037e281262cb6efa7f834d2c0a37d8db7100e[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Tue Nov 17 15:45:00 2026 +0700

    feat(ticket): perbarui status tiket dengan alur satu arah dan catatan teknis

[33mcommit 697f34c6ec011b9a065b0a22e3044301a4e8fde9[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Tue Nov 17 15:37:21 2026 +0700

    feat(ticket): buat tiket kerusakan dengan kontrak aktif dan foto opsional

[33mcommit 2c05feb7d8edb22624f42848c5198a2cfe7d095f[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Tue Nov 17 15:29:37 2026 +0700

    feat(file): upload foto tiket aman dengan magic bytes dan endpoint baca terotorisasi

[33mcommit 2f326953238f9a810b416e5f0acce6899594482a[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Tue Nov 17 15:02:45 2026 +0700

    feat(contract): daftar dan detail kontrak milik tenant dengan cek kepemilikan

[33mcommit 6c797f5b3118c670df3aaf49a6e49d6e4b27a230[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Tue Nov 17 14:46:04 2026 +0700

    refactor(room): helper sinkronisasi status kamar occupy/release

[33mcommit 0d19c17c1c0e2a319ba8c388e13d9e8ab456aa89[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Tue Nov 17 14:31:59 2026 +0700

    feat(contract): akhiri kontrak dengan pembatalan invoice dan pembebasan kamar

[33mcommit db98e243b2a222156aed263f7ab979b2baaaf7b0[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Tue Nov 17 13:19:18 2026 +0700

    refactor(contract): input durasi bulan dan perpanjang hanya untuk kontrak aktif

[33mcommit 820a181debab9620bf1f1b9346f5ee9541ad8990[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Tue Nov 17 12:50:58 2026 +0700

    feat(contract): buat kontrak sewa dengan validasi penyewa, kamar, dan salinan tarif

[33mcommit 677600f6aa1fe1193e58cfd953ed627d169979b4[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Tue Nov 17 12:34:27 2026 +0700

    feat(announcement): CRUD pengumuman untuk caretaker dan owner
    
    - POST/PATCH/DELETE /api/announcements(/:id) dibatasi requireRole owner+caretaker
    - Validasi judul 3-150 karakter, isi tidak boleh kosong, kategori urgent/routine/maintenance
    - Penulis diambil dari token, published_at otomatis; PATCH parsial dengan COALESCE
    - Hapus mengembalikan 404 bila pengumuman tidak ada

[33mcommit 0cb132cc589ed705e596b574683b725cd42489a0[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Mon Nov 16 18:08:16 2026 +0700

    feat(announcement): daftar pengumuman kronologis dengan paginasi

[33mcommit 9e74311ec5fa3e55dd65a666bb666db8ec462ce4[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Mon Nov 16 17:49:54 2026 +0700

    feat(user): daftar pengguna dengan paginasi dan filter peran

[33mcommit 2cc5c7a0152984f1c259f6941a3714bb9b5deddb[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Mon Nov 16 17:42:14 2026 +0700

    feat(user): reset password akun oleh caretaker dan owner

[33mcommit a50eaee5737757369efb79f8025627e5664b42c7[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Mon Nov 16 17:37:13 2026 +0700

    feat(user): aktivasi dan deaktivasi akun dengan pembatasan caretaker

[33mcommit f4121cc3aa123b9223589e13d3e6abc24178bcd8[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Mon Nov 16 17:02:35 2026 +0700

    feat(user): pendaftaran akun dengan password sementara dan penautan wali

[33mcommit 7aa7002198969907bcf1d898be32524c985c7bdd[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Mon Nov 16 15:37:22 2026 +0700

    feat(pagination): middleware paginasi untuk endpoint daftar

[33mcommit 7e802fead5142991181a740a13d57452d4a41bdf[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Mon Nov 16 15:36:51 2026 +0700

    feat(room): kelola data kamar dengan aturan harga dan status FR-05

[33mcommit c4d639f0e8a3e80721ae2bd58297e8430936631b[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Mon Nov 16 15:20:33 2026 +0700

    feat(otorisasi): pembatasan akses data berdasarkan kontrak sewa aktif

[33mcommit 43a2c95a2aec72add9b78d0a56d5bfdb89551e6a[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Mon Nov 16 14:44:50 2026 +0700

    feat(user): pengelolaan profil sendiri dan ganti password

[33mcommit 3007b2ee4729b971f272ac557dd0af45f4352684[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Mon Nov 16 14:02:36 2026 +0700

    feat(cors): aktifkan cors untuk frontend terpisah + hapus public/

[33mcommit d60647179c6bcc179fdc98280a07f53f786b671f[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Mon Nov 16 14:02:16 2026 +0700

    feat(middleware): auth JWT + cek is_active per request, requireRole

[33mcommit ca16fe9cd5cf7908d039306846e350cdf7f23513[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Mon Nov 16 14:02:16 2026 +0700

    feat(auth): login endpoint FR-01 (bcrypt, tolak akun nonaktif, JWT 2 jam)

[33mcommit 820c6ef403e37c8ce9adeb796d06708fd52ee3e1[m
Author: Verrellaksono <Verrellaksono8@gmail.com>
Date:   Mon Nov 16 00:18:50 2026 +0700

    chore: scaffold backend (server.js, config, db, migrations, modules) + skema DB + seeder
