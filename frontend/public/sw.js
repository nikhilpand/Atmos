const CACHE_NAME = 'atmos-v8-cache-v1';
const OFFLINE_URL = '/';

const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Video streaming (HLS/MP4) -> Network only (never cache)
  if (url.pathname.includes('.m3u8') || url.pathname.includes('.mp4') || url.pathname.includes('.ts')) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. TMDB Images (Posters, Backdrops) -> Cache first, fallback to network
  if (url.hostname === 'image.tmdb.org') {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        
        return fetch(request).then((networkResponse) => {
          // Clone the response so we can cache it and return it
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
          return networkResponse;
        });
      })
    );
    return;
  }

  // 3. API Requests -> Network first, fallback to cache
  if (url.pathname.startsWith('/api/') || url.hostname.includes('workers.dev')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // 4. App Shell / HTML -> Network first, fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // 5. Default -> Cache first, fallback to network
  event.respondWith(
    caches.match(request).then((response) => {
      return response || fetch(request).then((networkResponse) => {
        if (request.method === 'GET') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
        }
        return networkResponse;
      });
    })
  );
});
