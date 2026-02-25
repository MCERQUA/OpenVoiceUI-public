/**
 * Service Worker — minimal implementation required for PWA installability
 * Handles install/activate lifecycle. No offline caching (the app needs live network).
 */

const VERSION = 'v1';

self.addEventListener('install', (event) => {
    console.log('[SW] Installing', VERSION);
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[SW] Activated', VERSION);
    event.waitUntil(self.clients.claim());
});

// Pass all fetch requests through — no caching, app requires live network
self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
