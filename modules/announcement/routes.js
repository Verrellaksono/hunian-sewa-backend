const express = require('express');

const auth = require('../../middlewares/auth');
const pagination = require('../../middlewares/pagination');
const controller = require('./controller');

const router = express.Router();

// Daftar pengumuman
router.get('/', auth, pagination, controller.list);

module.exports = router;
