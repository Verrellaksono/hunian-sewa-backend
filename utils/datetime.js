const WIB = 'Asia/Jakarta';

// Tanggal hari ini (WIB) format 'YYYY-MM-DD'
function todayWIB() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: WIB,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// Tambah n bulan (penjepitan akhir bulan: 31 Jan + 1 bln → 28/29 Feb)
function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Selisih hari (boleh negatif) antara dua tanggal 'YYYY-MM-DD'
function daysBetween(fromDate, toDate) {
  const a = Date.UTC(...fromDate.split('-').map(Number));
  const b = Date.UTC(...toDate.split('-').map(Number));
  return Math.round((b - a) / 86400000);
}

// Format rupiah
function formatRupiah(value) {
  return 'Rp' + Number(value).toLocaleString('id-ID');
}

// Jam sekarang zona WIB
function nowWIB() {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: WIB,
    dateStyle: 'medium', timeStyle: 'medium',
  }).format(new Date());
}

module.exports = { WIB, todayWIB, addMonths, daysBetween, formatRupiah, nowWIB };
