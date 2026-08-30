/* Ocean Pulse service worker.
   Cache-first for the app shell; API responses are NEVER cached here
   (cross-origin requests pass straight through — localStorage in app.js
   handles data persistence). Bump CACHE_VERSION on every deploy. */

var CACHE_VERSION = "ocean-pulse-v2";

var SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_VERSION) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  // Never intercept the API (or anything else cross-origin): the Apps Script
  // call redirects to script.googleusercontent.com and must hit the network.
  if (url.origin !== self.location.origin) return;

  // Cache-first with silent background revalidate, so a shell update lands
  // on the *next* open even before a CACHE_VERSION bump. The revalidate is
  // created (and registered via waitUntil) synchronously so the browser
  // cannot terminate the SW before the cache write completes.
  var refresh = fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      return caches.open(CACHE_VERSION).then(function (cache) {
        return cache.put(req, copy);
      }).then(function () { return res; });
    }
    return res;
  }).catch(function () { return null; }); // offline: explicit null, never undefined

  event.waitUntil(refresh.catch(function () {}));

  // Navigations ignore the query string so QR/WhatsApp links carrying
  // ?utm=... still hit the cached "./" shell when offline.
  var isNavigate = req.mode === "navigate";
  event.respondWith(
    caches.match(req, { ignoreSearch: isNavigate }).then(function (hit) {
      return hit || refresh.then(function (res) {
        if (res) return res;
        if (!isNavigate) return Response.error();
        return caches.match("./").then(function (shell) {
          return shell || Response.error();
        });
      });
    })
  );
});
