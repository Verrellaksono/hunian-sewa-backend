const express = require('express');

const auth = require('../../middlewares/auth');
const controller = require('./controller');

const router = express.Router();

// Lihat profil sendiri
router.get('/me', auth, controller.getMe);
// Ubah profil sendiri
router.patch('/me', auth, controller.updateMe);
// Ganti password sendiri
router.patch('/me/password', auth, controller.changeMyPassword);

module.exports = router;
