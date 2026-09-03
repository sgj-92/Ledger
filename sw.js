// Minimal service worker — required by Chrome/Android for full "Install app"
// support. It doesn't cache anything; it just passes requests straight through.
self.addEventListener('install', function(event){
  self.skipWaiting();
});
self.addEventListener('activate', function(event){
  self.clients.claim();
});
self.addEventListener('fetch', function(event){
  event.respondWith(fetch(event.request));
});
