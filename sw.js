const CACHE_NAME = 'runwaychef-public-cache-v131';
const ASSETS = [
  './index.html',
  './manifest.json',
  './splash.jpg',
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
  './demoData.js',
  './Roboto-Regular.ttf'
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

  // Внешние CDN (шрифты, библиотеки) — тоже не трогаем вообще, отдаём браузеру
  // как есть. Раньше кросс-доменные запросы шли через ту же кэширующую логику,
  // что и собственные файлы приложения, и на некоторых из них (в частности —
  // на новой загрузке шрифта для PDF) это стабильно ломало запрос, хотя сам
  // внешний сервер отвечал нормально. Кэшировать чужие домены в свой офлайн-кэш
  // нам и не нужно — только собственные файлы приложения (см. ниже).
  if (self.location.origin && !req.url.startsWith(self.location.origin)) {
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
