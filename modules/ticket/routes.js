const express = require('express');

const auth = require('../../middlewares/auth');
const requireRole = require('../../middlewares/requireRole');
const requireActiveContract = require('../../middlewares/requireActiveContract');
const { uploadTicketPhoto } = require('../../middlewares/upload');
const controller = require('./controller');

const router = express.Router();

// Buat tiket kerusakan
router.post('/', auth, requireRole('tenant'), requireActiveContract, uploadTicketPhoto, controller.create);
// Perbarui status tiket
router.patch('/:id/status', auth, requireRole('caretaker'), controller.updateStatus);

module.exports = router;
