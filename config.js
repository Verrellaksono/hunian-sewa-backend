require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hunian_sewa',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-only-secret-ganti-di-produksi',
    expiresIn: '2h', // FR-01 / NFR-04: token berumur 2 jam
  },
  midtrans: {
    serverKey: process.env.MIDTRANS_SERVER_KEY || '',
    clientKey: process.env.MIDTRANS_CLIENT_KEY || '',
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    webhookUrl: process.env.WEBHOOK_URL || '',
  },
};
