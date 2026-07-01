const CACHE_NAME = 'runwaychef-public-cache-v2';
const ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './supabaseClient.js',
  './auth.js',
  './dates.js',
  './money.js',
  './helpers.js',
  './modals.js',
  './employees.js',
  './orders.js',
  './payments.js',
  './customers.js',
  './products.js',
  './semifinished.js',
  './ingredients.js',
  './inventory.js',
  './stats.js',
  './history.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  // Больше не переключаемся на новую версию автоматически —
  // ждём явной команды от пользователя (кнопка "Обновить" в приложении)
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Supabase — никогда не кэшируем, всегда сеть
  if (req.url.includes('supabase.co')) {
    return;
  }

  // Для JS/HTML/CSS/изображений — сначала сеть, при ошибке кэш
  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
