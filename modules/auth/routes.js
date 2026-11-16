// Rute MOD-01 Auth
const express = require('express');

const controller = require('./controller');

const router = express.Router();

// POST /api/auth/login — login semua peran
router.post('/login', controller.login);

module.exports = router;
