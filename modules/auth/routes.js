const express = require('express');

const controller = require('./controller');

const router = express.Router();

// Login
router.post('/login', controller.login);

// Logout — tanpa state server, token kedaluwarsa alami
router.post('/logout', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Logout berhasil. Hapus token dari sisi klien; token otomatis tidak berlaku setelah 2 jam.',
  });
});

module.exports = router;
