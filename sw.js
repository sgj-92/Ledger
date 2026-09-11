// Minimal service worker — required by Chrome/Android for full "Install app"
// support, and required by every browser for Web Push. It doesn't cache
// anything; it just passes requests straight through.
self.addEventListener('install', function(event){
  self.skipWaiting();
});
self.addEventListener('activate', function(event){
  self.clients.claim();
});
self.addEventListener('fetch', function(event){
  event.respondWith(fetch(event.request));
});

// ---------- Pin now (instant push reminders) ----------
// Payload shape sent by the Cloud Function: { title, body, url, tag }
self.addEventListener('push', function(event){
  var data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch(e){ data = { title: 'Ledger', body: event.data ? event.data.text() : '' }; }

  var title = data.title || 'Ledger';
  var options = {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: data.url || './' }
  };
  if (data.tag) options.tag = data.tag;

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList){
      for (var i = 0; i < clientList.length; i++){
        var client = clientList[i];
        if ('focus' in client){
          if ('navigate' in client) client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
