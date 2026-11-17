const express = require('express');

const controller = require('./controller');

const router = express.Router();

// Notifikasi pembayaran Midtrans — TANPA JWT, dilindungi validasi signature
router.post('/payment', controller.handlePayment);

module.exports = router;
