const express = require('express');

const auth = require('../../middlewares/auth');
const requireRole = require('../../middlewares/requireRole');
const pagination = require('../../middlewares/pagination');
const controller = require('./controller');

const router = express.Router();

// Buat kontrak sewa (caretaker & owner)
router.post('/', auth, requireRole('owner', 'caretaker'), controller.create);
// Perpanjang kontrak (caretaker & owner)
router.patch('/:id', auth, requireRole('owner', 'caretaker'), controller.extend);
// Daftar kontrak milik tenant/guardian
router.get('/me', auth, requireRole('tenant', 'guardian'), pagination, controller.listMine);
// Detail kontrak (owner/caretaker bebas; tenant/guardian hanya miliknya)
router.get('/:id', auth, requireRole('owner', 'caretaker', 'tenant', 'guardian'), controller.getById);
// Akhiri kontrak (caretaker & owner)
router.post('/:id/terminate', auth, requireRole('owner', 'caretaker'), controller.terminate);

module.exports = router;
