const config = require('../config');
const ApiError = require('./ApiError');

// Basis URL Snap API sesuai mode (sandbox/production)
function snapBaseUrl() {
  return config.midtrans.isProduction
    ? 'https://app.midtrans.com/snap'
    : 'https://app.sandbox.midtrans.com/snap';
}

// Buat transaksi Snap; return { token, paymentUrl }
async function createSnapTransaction({ orderId, grossAmount, customerName, itemDetails, finishUrl }) {
  // Validasi Konfigurasi (server key belum diisi .env)
  if (!config.midtrans.serverKey) {
    throw new ApiError(503, 'Payment gateway belum dikonfigurasi. Hubungi pengelola.');
  }

  let resp;
  try {
    resp = await fetch(`${snapBaseUrl()}/v1/transactions`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${config.midtrans.serverKey}:`).toString('base64')}`,
      },
      body: JSON.stringify({
        transaction_details: { order_id: orderId, gross_amount: grossAmount },
        item_details: itemDetails,
        customer_details: { first_name: customerName },
        expiry: { duration: 60, unit: 'minutes' },
        // Semua hasil pembayaran balik ke halaman tagihan, bukan contoh dashboard
        ...(finishUrl ? { callbacks: { finish: finishUrl, unfinish: finishUrl, error: finishUrl } } : {}),
      }),
    });
  } catch (err) {
    console.error('[midtrans] Snap API tidak dapat dihubungi:', err.message);
    throw new ApiError(502, 'Payment gateway tidak dapat dihubungi. Coba beberapa saat lagi.');
  }

  const body = await resp.json().catch(() => null);
  if (!resp.ok || !body?.token) {
    console.error(`[midtrans] Snap API gagal (HTTP ${resp.status}):`, JSON.stringify(body));
    throw new ApiError(502, 'Payment gateway gagal membuat transaksi. Coba beberapa saat lagi.');
  }

  return { token: body.token, paymentUrl: body.redirect_url };
}

module.exports = { createSnapTransaction, snapBaseUrl };
