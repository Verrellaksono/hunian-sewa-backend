const express = require('express');

const auth = require('../../middlewares/auth');
const requireRole = require('../../middlewares/requireRole');
const pagination = require('../../middlewares/pagination');
const controller = require('./controller');

const router = express.Router();

// Rekap upaya pembayaran (owner semua; tenant miliknya; guardian penyewa tertaut)
router.get('/rekap', auth, requireRole('owner', 'tenant', 'guardian'), pagination, controller.rekap);

module.exports = router;
