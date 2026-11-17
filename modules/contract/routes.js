const express = require('express');

const auth = require('../../middlewares/auth');
const requireRole = require('../../middlewares/requireRole');
const controller = require('./controller');

const router = express.Router();

// Buat kontrak sewa (caretaker & owner)
router.post('/', auth, requireRole('owner', 'caretaker'), controller.create);

module.exports = router;
