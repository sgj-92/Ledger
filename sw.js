// Ledger's service worker: Web Push, the browser's "Install app", and (since 2026-11-14)
// opening with no connection.
//
// Offline, it serves the last copy of Ledger it has: the page, its fonts and icons, pdf.js,
// and the Firebase SDK. The page always comes from the network first, so a new build is
// never held back; the stored copy is used only when the network fails or takes more than
// a few seconds. Your data isn't stored here: Firestore keeps its own copy on the device
// (index.html, "a copy on this device"). Only plain GETs of Ledger's own files and the
// pinned Firebase SDK are touched; Firestore, sign-in, functions and everything else pass
// straight through, as before.
var SHELL = 'ledger-shell-v1';
var FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
var PRECACHE = [
  './', 'manifest.json', 'buildInfo.js', 'hero-mountain.webp',
  'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'fonts/inter-400.woff2', 'fonts/inter-500.woff2', 'fonts/inter-600.woff2',
  'fonts/playfair-400.woff2', 'fonts/playfair-400i.woff2', 'fonts/playfair-500.woff2', 'fonts/playfair-600.woff2',
  FIREBASE_SDK + 'firebase-app-compat.js', FIREBASE_SDK + 'firebase-firestore-compat.js', FIREBASE_SDK + 'firebase-auth-compat.js'
];
var NAV_WAIT_MS = 4000;
// shown only when there's no connection and nothing stored yet (the very first open)
var OFFLINE_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<title>Ledger · offline</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0e0b08;color:#f3eadc;' +
  'font-family:-apple-system,system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}h1{font-family:Georgia,serif;font-weight:400;font-size:28px;margin:0 0 10px}' +
  'p{margin:0 0 20px;color:#bfae94;line-height:1.5}button{font:inherit;color:#0e0b08;background:#c9a36b;border:0;border-radius:12px;padding:12px 22px}</style></head>' +
  '<body><main><h1>You’re offline</h1><p>Ledger needs a connection the first time it opens on this device. After that it opens without one.</p>' +
  '<button type="button" onclick="location.reload()">Try again</button></main></body></html>';

self.addEventListener('install', function(event){
  event.waitUntil(caches.open(SHELL).then(function(cache){
    // each on its own: one that fails (offline, a renamed file) never stops the rest
    return Promise.all(PRECACHE.map(function(u){
      var cross = u.indexOf('https://') === 0;
      return fetch(new Request(u, cross ? { mode: 'no-cors' } : { cache: 'reload' }))
        .then(function(res){ if (res && (res.ok || res.type === 'opaque')) return cache.put(u, res); })
        .catch(function(){});
    }));
  }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate', function(event){
  event.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf('ledger-shell-') === 0 && k !== SHELL; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

function keep(key, res){
  if (!res || !(res.ok || res.type === 'opaque')) return;
  var copy = res.clone();
  caches.open(SHELL).then(function(c){ return c.put(key, copy); }).catch(function(){});
}
// the page: the network, unless it fails or is slow; then the stored copy
function page(req){
  var scope = self.registration.scope;
  return new Promise(function(resolve){
    var done = false;
    function stored(){
      return caches.open(SHELL).then(function(c){ return c.match(scope).then(function(r){ return r || c.match(req, { ignoreSearch: true }); }); });
    }
    var timer = setTimeout(function(){
      stored().then(function(r){ if (r && !done){ done = true; resolve(r); } });
    }, NAV_WAIT_MS);
    fetch(req).then(function(res){
      clearTimeout(timer);
      if (res && res.ok) keep(scope, res);
      if (!done){ done = true; resolve(res); }
    }).catch(function(){
      clearTimeout(timer);
      stored().then(function(r){
        if (done) return;
        done = true;
        resolve(r || new Response(OFFLINE_HTML, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }));
      });
    });
  });
}

self.addEventListener('fetch', function(event){
  var req = event.request;
  if (req.method !== 'GET') return;                          // the browser handles it as usual
  var url = new URL(req.url), own = url.origin === self.location.origin;
  if (req.mode === 'navigate' && own){ event.respondWith(page(req)); return; }
  if (own){
    // Ledger's own files: the network, keeping a copy; the copy when offline
    if (/\/sw\.js$/.test(url.pathname)) return;
    event.respondWith(fetch(req).then(function(res){ keep(req, res); return res; }).catch(function(){
      return caches.match(req, { ignoreSearch: true }).then(function(r){ return r || Response.error(); });
    }));
    return;
  }
  if (req.url.indexOf(FIREBASE_SDK) === 0){
    // a pinned version never changes: the stored copy first
    event.respondWith(caches.match(req).then(function(r){
      return r || fetch(req).then(function(res){ keep(req, res); return res; });
    }));
  }
  // everything else (Firestore, sign-in, functions, GitHub): not touched
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
