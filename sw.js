// sw.js - Motor do PWA (Focado em Performance e Atualização em Tempo Real)

const CACHE_NAME = 'god-mode-v2.9';

// Força o Service Worker a instalar imediatamente
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Assume o controle da tela na mesma hora, sem precisar recarregar
self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// Interceptador de rede: Sempre busca a internet primeiro (Network First).
// Isso garante que você nunca veja uma tela velha com bugs antigos.
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});
