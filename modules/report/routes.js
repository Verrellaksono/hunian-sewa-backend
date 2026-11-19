const express = require('express');

const auth = require('../../middlewares/auth');
const requireRole = require('../../middlewares/requireRole');
const controller = require('./controller');

const router = express.Router();

// Ekspor CSV laporan keuangan owner
router.get('/financial/export', auth, requireRole('owner'), controller.exportFinancial);
// Laporan keuangan owner
router.get('/financial', auth, requireRole('owner'), controller.financial);

module.exports = router;
