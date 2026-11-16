// Controller MOD-01 Auth: lapisan HTTP (validasi input → service → respons)
const ApiError = require('../../utils/ApiError');
const service = require('./service');

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      throw new ApiError(400, 'Email dan password wajib diisi.');
    }

    const result = await service.login({ email, password });
    res.status(200).json({ success: true, message: 'Login berhasil.', ...result });
  } catch (err) {
    next(err);
  }
}

module.exports = { login };
