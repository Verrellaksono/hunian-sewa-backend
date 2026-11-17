const express = require('express');

const auth = require('../../middlewares/auth');
const requireRole = require('../../middlewares/requireRole');
const pagination = require('../../middlewares/pagination');
const controller = require('./controller');

const router = express.Router();

// Daftar pengumuman
router.get('/', auth, pagination, controller.list);
// Tambah pengumuman
router.post('/', auth, requireRole('owner', 'caretaker'), controller.create);
// Ubah pengumuman
router.patch('/:id', auth, requireRole('owner', 'caretaker'), controller.update);
// Hapus pengumuman
router.delete('/:id', auth, requireRole('owner', 'caretaker'), controller.remove);

module.exports = router;
