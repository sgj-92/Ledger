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

// ---------- Web Push ----------
// Payload from the Cloud Function (functions/push.js): { title, body, url, tag, renotify, kind }.
// Every push shows a notification (iOS requires it). A tag replaces the previous
// notification with the same tag where the platform allows — so a new Current Focus
// replaces the last one instead of stacking.
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
  if (data.tag){
    options.tag = data.tag;
    if (data.renotify) options.renotify = true;   // only meaningful with a tag
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

// A link always opens on this installation's own origin: the payload's query string on
// the service worker's scope (an installed iPhone app can only open its own origin).
function ownUrl(url){
  try {
    var u = new URL(url, self.registration.scope);
    return new URL(u.search, self.registration.scope).href;
  } catch(e){ return self.registration.scope; }
}

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var url = ownUrl((event.notification.data && event.notification.data.url) || './');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList){
      for (var i = 0; i < clientList.length; i++){
        var client = clientList[i];
        if (client.url.indexOf(self.registration.scope) === 0 && 'focus' in client){
          // Ledger is already open: it opens the link itself, with no reload
          client.postMessage({ type: 'ledger-open', url: url });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
