const ApiError = require('../utils/ApiError');

// Batasi akses per peran
function requireRole(...roles) {
  return (req, res, next) => {
    // Validasi Wajib Login
    if (!req.user) {
      return next(new ApiError(401, 'Belum login. Silakan login terlebih dahulu.'));
    }
    // Validasi Peran
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, `Akses ditolak. Endpoint ini hanya untuk peran: ${roles.join(', ')}.`));
    }
    next();
  };
}

module.exports = requireRole;
