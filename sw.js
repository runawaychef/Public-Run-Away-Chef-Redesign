const CACHE_NAME = 'runwaychef-public-cache-v58';
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
  './company.js',
  './orders.js',
  './invoice.js',
  './payments.js',
  './customers.js',
  './products.js',
  './semifinished.js',
  './ingredients.js',
  './inventory.js',
  './stats.js',
  './history.js',
  './demoData.js'
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

  // Для JS/HTML/CSS/изображений — сначала сеть (по-настоящему, минуя HTTP-кэш браузера), при ошибке — офлайн-кэш
  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
