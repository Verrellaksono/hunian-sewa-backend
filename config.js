require('dotenv').config();

const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  // Origin frontend untuk redirect balik setelah pembayaran Midtrans
  frontendUrl: (process.env.FRONTEND_URL || '').replace(/\/+$/, ''),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hunian_sewa',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-only-secret-ganti-di-produksi',
    expiresIn: '2h', // token berumur 2 jam
  },
  midtrans: {
    serverKey: process.env.MIDTRANS_SERVER_KEY || '',
    clientKey: process.env.MIDTRANS_CLIENT_KEY || '',
    signatureKey:
      process.env.MIDTRANS_SIGNATURE_KEY || process.env.MIDTRANS_SERVER_KEY || '',
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    webhookUrl: process.env.WEBHOOK_URL || '',
  },
  upload: {
    dir: path.join(__dirname, 'uploads'),
    maxFileSize: 2 * 1024 * 1024, // JPEG/PNG maks 2 MB
  },
};
