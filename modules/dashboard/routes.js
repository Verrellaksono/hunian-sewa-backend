const express = require('express');

const auth = require('../../middlewares/auth');
const controller = require('./controller');

const router = express.Router();

// Ringkasan dashboard sesuai role 
router.get('/summary', auth, controller.summary);

module.exports = router;
