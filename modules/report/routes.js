const express = require('express');

const auth = require('../../middlewares/auth');
const requireRole = require('../../middlewares/requireRole');
const controller = require('./controller');

const router = express.Router();

// Laporan keuangan owner
router.get('/financial', auth, requireRole('owner'), controller.financial);

module.exports = router;
