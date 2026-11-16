const express = require('express');

const auth = require('../../middlewares/auth');
const requireRole = require('../../middlewares/requireRole');
const controller = require('./controller');

const router = express.Router();

// Lihat profil sendiri
router.get('/me', auth, controller.getMe);
// Ubah profil sendiri
router.patch('/me', auth, controller.updateMe);
// Ganti password sendiri
router.patch('/me/password', auth, controller.changeMyPassword);
// Daftarkan akun baru
router.post('/users', auth, requireRole('owner', 'caretaker'), controller.registerAccount);
// Aktivasi akun
router.patch('/users/:id/activate', auth, requireRole('owner', 'caretaker'), controller.activateUser);
// Deaktivasi akun
router.patch('/users/:id/deactivate', auth, requireRole('owner', 'caretaker'), controller.deactivateUser);
// Reset password akun
router.patch('/users/:id/reset-password', auth, requireRole('owner', 'caretaker'), controller.resetUserPassword);

module.exports = router;
