const CACHE_PREFIX = 'asryo-';
const SHELL_CACHE = `${CACHE_PREFIX}offline-v6`;
const DATA_CACHE = `${CACHE_PREFIX}public-data-v3`;
const ASSET_CACHE = `${CACHE_PREFIX}assets-v6`;
const SHELL = [
  '/', '/offline.html', '/style.css', '/luxury.css?v=dream-future-20261018',
  '/speed.css?v=image-fit-20261019', '/product.css?v=image-fit-20261019',
  '/product-page.js?v=launch-readiness-1', '/app.js?v=products-hidden-2',
  '/manifest.webmanifest','/asryo-mark.svg', '/brand.css?v=metallic-20261024', '/assets/asryo-metallic-icon.png', '/assets/asryo-metallic-wordmark.webp', '/assets/asryo-metallic-logo.webp', '/track.html','/track.js',
  '/policies.html','/policies.js', '/admin.html',
  '/speed-division.html','/dream-future.html','/unsubscribe.html','/early-access-confirmed.html',
  '/assets/asryo-drop-001-lookbook.webp',
  '/assets/asryo-speed-division-front.webp','/assets/asryo-speed-division-back.webp',
  '/assets/asryo-dream-front.webp','/assets/asryo-dream-back.webp'
];

async function cacheOne(cache, request) {
  try {
    const response = await fetch(request, { cache: 'reload' });
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
    return response;
  } catch {
    return null;
  }
}

async function seedCatalog() {
  const dataCache = await caches.open(DATA_CACHE);
  const assetsCache = await caches.open(ASSET_CACHE);
  const response = await cacheOne(dataCache, '/api/products');
  await cacheOne(dataCache, '/api/status');
  // Do not precache catalog images while all public listings are hidden.
  if (!response?.ok) return;

  try {
    const { products = [] } = await response.clone().json();
    const images = [...new Set(products.map(product => product.image).filter(path => {
      if (typeof path !== 'string') return false;
      const url = new URL(path, self.location.origin);
      return url.origin === self.location.origin && url.pathname.startsWith('/assets/');
    }))];
    for (let index = 0; index < images.length; index += 4) {
      await Promise.allSettled(images.slice(index, index + 4).map(path => cacheOne(assetsCache, path)));
    }
  } catch {
    // Keep the shell usable if a catalog response is malformed.
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await Promise.allSettled(SHELL.map(path => cacheOne(shell, path)));
    await seedCatalog();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && ![SHELL_CACHE, DATA_CACHE, ASSET_CACHE].includes(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function networkFirstPublicData(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (!cached) throw new Error('No saved public preview data');
    const headers = new Headers(cached.headers);
    headers.set('X-ASRYO-Offline', '1');
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }
}

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return await caches.match(request) || await caches.match('/offline.html');
  }
}

async function cacheFirstAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(ASSET_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/api/products' || url.pathname === '/api/status') {
    event.respondWith(networkFirstPublicData(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }

  event.respondWith(cacheFirstAsset(request).catch(async () => {
    if (request.destination === 'image') return new Response('', { status: 404, statusText: 'Image unavailable offline' });
    return Response.error();
  }));
});
