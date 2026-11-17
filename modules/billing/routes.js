const express = require('express');

const auth = require('../../middlewares/auth');
const requireRole = require('../../middlewares/requireRole');
const pagination = require('../../middlewares/pagination');
const controller = require('./controller');

const router = express.Router();

// Daftar invoice — caretaker TIDAK BOLEH lihat invoice (matriks hak akses)
router.get('/', auth, requireRole('owner', 'tenant', 'guardian'), pagination, controller.list);
// Detail invoice + items + riwayat upaya bayar
router.get('/:id', auth, requireRole('owner', 'tenant', 'guardian'), controller.getById);

module.exports = router;
