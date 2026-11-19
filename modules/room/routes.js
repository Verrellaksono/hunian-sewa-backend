const express = require('express');

const auth = require('../../middlewares/auth');
const requireRole = require('../../middlewares/requireRole');
const pagination = require('../../middlewares/pagination');
const controller = require('./controller');

const router = express.Router();

// Daftar kamar
router.get('/', auth, pagination, controller.list);
// Tambah kamar
router.post('/', auth, requireRole('owner', 'caretaker'), controller.create);
// Ubah kamar
router.patch('/:id', auth, requireRole('owner', 'caretaker'), controller.update);
// Hapus kamar
router.delete('/:id', auth, requireRole('owner'), controller.remove);

module.exports = router;
