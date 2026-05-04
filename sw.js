/**
 * sw.js — Service Worker God Mode v2.2
 * ----------------------------------------------------------------------------
 * Estratégia:
 *  - HTML/CSS/JS principais: stale-while-revalidate
 *  - APIs (script.google.com): network-only (NUNCA cacheia API)
 *  - Versão bumped → cache antigo é deletado automaticamente
 */

const CACHE_VERSION = 'v9.9';
const CACHE_NAME = 'godmode-' + CACHE_VERSION;

const STATIC_ASSETS = [
  './',
  './index.html',
  './client.html',
  './login.html',
  './style.css',
  './manifest.json',
  './js/config.js',
  './js/api.js',
  './js/auth.js',
  './js/utils.js',
  './js/kb.js',
  './js/ui-shared.js',
  './js/admin.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Adiciona um por um para não falhar tudo se um arquivo não existir ainda
      // (ex: client.html só será criado na Onda 3)
      return Promise.allSettled(
        STATIC_ASSETS.map(asset =>
          cache.add(asset).catch(err => console.warn('SW: falhou cachear', asset, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nunca cacheia API
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) {
    return; // deixa o browser tratar normalmente
  }

  // Apenas GETs entram no cache
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request)
        .then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached); // offline fallback

      return cached || networkFetch;
    })
  );
});
