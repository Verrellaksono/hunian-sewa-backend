// Middleware requireRole: batasi endpoint per peran (RBAC).
// Pemakaian: router.get('/', auth, requireRole('owner', 'caretaker'), handler)
const ApiError = require('../utils/ApiError');

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'Belum login. Silakan login terlebih dahulu.'));
    }
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, `Akses ditolak. Endpoint ini hanya untuk peran: ${roles.join(', ')}.`));
    }
    next();
  };
}

module.exports = requireRole;
