const ApiError = require('../utils/ApiError');
const { accessibleContractIds } = require('../utils/ownership');

// Wajib punya kontrak sewa aktif
async function requireActiveContract(req, res, next) {
  try {
    const ids = await accessibleContractIds(req.user);
    // Owner/caretaker bebas
    if (ids === null) return next();
    // Validasi Kontrak Aktif
    if (ids.length === 0) {
      return next(new ApiError(403, 'Anda tidak memiliki kontrak sewa aktif. Hubungi pengelola.'));
    }
    // Tempel ID kontrak ke req.contractIds
    req.contractIds = ids;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = requireActiveContract;
