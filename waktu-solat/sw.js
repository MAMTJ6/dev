// Nama dan versi cache.
// PENTING: Tukar nombor versi ini (cth: v1.4.6) setiap kali anda membuat perubahan pada mana-mana fail di bawah.
const CACHE_NAME = 'mamtj6-jadual-waktu-ramadan-v1.6.7';

// Senarai fail "app shell" yang penting untuk dicache semasa pemasangan PWA.
const urlsToCache = [
  './',
  'index.html',
  'info.html',
  // Fail-fail Favicon
  'favicon/favicon.ico',
  'favicon/favicon.svg',
  'favicon/apple-touch-icon.png',
  'favicon/favicon-96x96.png',
  'favicon/web-app-manifest-192x192.png',
  'favicon/web-app-manifest-512x512.png',
  'favicon/site.webmanifest',
  // Aset luaran
  'https://i.postimg.cc/JnM7F2FC/mamtj6-white-text.webp',
  '/media/img/plain-blue-bg.png',
  'https://dev.mamtj6.com/media/logo-mamtj6/SVG/mamtj6_single.svg'
];

// 1. Proses Pemasangan (Install)
self.addEventListener('install', (event) => {
  // Tunggu sehingga semua fail penting selesai dicache
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache dibuka. Menyimpan fail app shell...');
        return cache.addAll(urlsToCache);
      })
  );
});

// 2. Proses Pengaktifan (Activate)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('mamtj6-jadual-waktu-ramadan-') && cacheName !== CACHE_NAME)
          .map((cacheName) => {
            console.log('Service Worker: Memadamkan cache lama:', cacheName);
            return caches.delete(cacheName);
          })
      );
    })
  );
});

// 3. Proses 'Fetch' (Apabila aplikasi meminta fail)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    // Cuba cari fail yang diminta di dalam cache terlebih dahulu
    caches.match(event.request)
      .then((response) => {
        // Jika fail ditemui dalam cache, pulangkan ia.
        if (response) {
          return response;
        }
        // Jika tidak ditemui, buat permintaan ke rangkaian (network).
        return fetch(event.request).catch(() => new Response('', { status: 503, statusText: 'Offline' }));
      }
    )
  );
});

// 4. Listen for the "SKIP_WAITING" message from the client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});