const express = require('express');

const auth = require('../../middlewares/auth');
const controller = require('./controller');

const router = express.Router();

// Baca foto tiket
router.get('/:filename', auth, controller.show);

module.exports = router;
