// Kelas error aplikasi — bawa status HTTP + pesan Indonesia
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = ApiError;
