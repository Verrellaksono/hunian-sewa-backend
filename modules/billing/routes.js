const express = require('express');

const auth = require('../../middlewares/auth');
const requireRole = require('../../middlewares/requireRole');
const pagination = require('../../middlewares/pagination');
const controller = require('./controller');

// Router invoice
const router = express.Router();
// Router rekap payment (base path beda dari invoice)
const paymentRouter = express.Router();
// Router webhook Midtrans (TANPA JWT, dilindungi validasi signature)
const webhookRouter = express.Router();

// Daftar invoice
router.get('/', auth, requireRole('owner', 'tenant', 'guardian'), pagination, controller.list);
// Detail invoice, items, dan riwayat upaya bayar
router.get('/:id', auth, requireRole('owner', 'tenant', 'guardian'), controller.getById);
// Mulai pembayaran (tenant, guardian)
router.post('/:id/pay', auth, requireRole('tenant', 'guardian'), controller.pay);

// Rekap upaya pembayaran 
paymentRouter.get('/rekap', auth, requireRole('owner', 'tenant', 'guardian'), pagination, controller.rekap);

// Notifikasi pembayaran Midtrans
webhookRouter.post('/payment', controller.handlePayment);

module.exports = { invoiceRouter: router, paymentRouter, webhookRouter };
