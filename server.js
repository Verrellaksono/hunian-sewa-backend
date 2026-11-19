require('dotenv').config();

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');

const config = require('./config');
const app = express();
const PORT = config.port;
const billingRoutes = require('./modules/billing/routes');

// Middleware global (cors izinkan request lintas origin frontend)
app.use(cors());
app.use(morgan('dev')); // logger HTTP, cetak setiap request
app.use(express.json());

// --- Halaman utama ---
app.get('/', (req, res) => {
  res.status(200).json({
    pesan: 'Selamat datang di API Sistem Informasi Pengelolaan Hunian Sewa!',
    version: '1.0.0',
    endpoints: {
      health: 'GET /api/health',
      auth: 'POST /api/auth/login (task 1.1)',
    },
  });
});

// --- Health check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Rute modul
app.use('/api/auth', require('./modules/auth/routes'));
app.use('/api', require('./modules/user/routes')); // /api/me, /api/me/password
app.use('/api/rooms', require('./modules/room/routes'));
app.use('/api/announcements', require('./modules/announcement/routes'));
app.use('/api/contracts', require('./modules/contract/routes'));
app.use('/api/files', require('./modules/file/routes')); // foto tiket (terotorisasi)
app.use('/api/tickets', require('./modules/ticket/routes'));
app.use('/api/dashboard', require('./modules/dashboard/routes'));
app.use('/api/reports', require('./modules/report/routes'));
app.use('/api/invoices', billingRoutes.invoiceRouter);
app.use('/api/payments', billingRoutes.paymentRouter);
app.use('/api/webhooks', billingRoutes.webhookRouter);

// Job berkala (scheduler sentral): 00:05 WIB invoice periodik & kontrak berakhir, dst.
require('./modules/scheduler').startSchedulers();

// --- 404 ---
app.use((req, res) => {
  res.status(404).json({
    success: false,
    pesan: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan.`,
  });
});

// --- Error handler terpusat ---
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(err.status || 500).json({
    success: false,
    pesan: err.message || 'Terjadi kesalahan internal pada server.',
  });
});

app.listen(PORT, () => {
  console.log(`Server berjalan di: http://localhost:${PORT}`);
});

module.exports = app;
