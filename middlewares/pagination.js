const { getPagination } = require('../utils/pagination');

// Isi req.pagination dari query
function pagination(req, res, next) {
  req.pagination = getPagination(req.query);
  next();
}

module.exports = pagination;
