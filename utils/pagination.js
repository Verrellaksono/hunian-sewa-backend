// Baca query paginasi
function getPagination(query = {}) {
  const page = Math.max(parseInt(query.page || '1', 10) || 1, 1);
  let limit = parseInt(query.limit || '10', 10) || 10;
  if (limit < 1) limit = 10;
  if (limit > 100) limit = 100;
  return { page, limit, offset: (page - 1) * limit };
}

// Bungkus hasil query jadi respons berpaginasi
function paginated(data, total, { page, limit }) {
  return {
    data,
    meta: {
      page,
      limit,
      total: Number(total),
      total_pages: Math.max(Math.ceil(total / limit), 1),
    },
  };
}

module.exports = { getPagination, paginated };
