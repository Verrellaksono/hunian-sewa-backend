const express = require('express');

const auth = require('../../middlewares/auth');
const requireRole = require('../../middlewares/requireRole');
const requireActiveContract = require('../../middlewares/requireActiveContract');
const pagination = require('../../middlewares/pagination');
const { uploadTicketPhoto } = require('../../middlewares/upload');
const controller = require('./controller');

const router = express.Router();

// Buat tiket kerusakan
router.post('/', auth, requireRole('tenant'), requireActiveContract, uploadTicketPhoto, controller.create);
// Daftar tiket
router.get('/', auth, pagination, controller.list);
// Perbarui status tiket
router.patch('/:id/status', auth, requireRole('caretaker'), controller.updateStatus);
// Detail tiket
router.get('/:id', auth, controller.getById);
// Daftar komentar diskusi
router.get('/:id/comments', auth, pagination, controller.listComments);
// Tulis komentar diskusi
router.post('/:id/comments', auth, controller.addComment);

module.exports = router;
