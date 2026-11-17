const express = require('express');

const auth = require('../../middlewares/auth');
const requireRole = require('../../middlewares/requireRole');
const pagination = require('../../middlewares/pagination');
const controller = require('./controller');

const router = express.Router();

// Daftar invoice
router.get('/', auth, requireRole('owner', 'tenant', 'guardian'), pagination, controller.list);
// Detail invoice + items + riwayat upaya bayar
router.get('/:id', auth, requireRole('owner', 'tenant', 'guardian'), controller.getById);
// Mulai pembayaran (tenant, guardian)
router.post('/:id/pay', auth, requireRole('tenant', 'guardian'), controller.pay);

module.exports = router;
