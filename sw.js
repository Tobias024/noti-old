// Service Worker para noti-old.
// Estrategia:
//  - App-shell precacheado (cache-first) en SHELL_CACHE.
//  - GETs a /api/gh/repos/.../contents/* en NOTES_CACHE (network-first con fallback a cache).
//  - PUT/DELETE a /api/gh/* nunca se cachean; tras 2xx invalidamos la entrada GET correspondiente.
//  - El resto de /api/gh/* (tree, repo check) va siempre a red.
//
// Para forzar update del shell, bumpear SHELL_VERSION. Las notas usan otra cache
// con su propia version (NOTES_VERSION) por si alguna vez cambia el formato.

const SHELL_VERSION = 'v1';
const NOTES_VERSION = 'v1';
const SHELL_CACHE = 'noti-shell-' + SHELL_VERSION;
const NOTES_CACHE = 'noti-notes-' + NOTES_VERSION;

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './vendor/snarkdown.js',
  './vendor/excaliold.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.addAll(SHELL_ASSETS);
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        if (name === SHELL_CACHE || name === NOTES_CACHE) return null;
        if (name.indexOf('noti-') === 0) return caches.delete(name);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'CLEAR_NOTES') {
    event.waitUntil(caches.delete(NOTES_CACHE).then(function () {
      return caches.open(NOTES_CACHE);
    }));
  }
});

function isContentsGet(url, method) {
  if (method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  // /api/gh/repos/{user}/{repo}/contents/...
  return /^\/api\/gh\/repos\/[^/]+\/[^/]+\/contents\//.test(url.pathname);
}

function isContentsWrite(url, method) {
  if (method !== 'PUT' && method !== 'DELETE') return false;
  if (url.origin !== self.location.origin) return false;
  return /^\/api\/gh\/repos\/[^/]+\/[^/]+\/contents\//.test(url.pathname);
}

function isShellAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.indexOf('/api/') === 0) return false;
  // todo lo demas mismo-origen lo tratamos como shell
  return true;
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (isContentsWrite(url, req.method)) {
    event.respondWith(handleWrite(req, url));
    return;
  }
  if (isContentsGet(url, req.method)) {
    event.respondWith(handleNoteGet(req));
    return;
  }
  if (req.method === 'GET' && isShellAsset(url)) {
    event.respondWith(handleShell(req));
    return;
  }
  // Resto: que pase de largo (incluye /api/gh/git/trees, repo check, OPTIONS, etc.)
});

async function handleShell(request) {
  var cache = await caches.open(SHELL_CACHE);
  var cached = await cache.match(request, { ignoreSearch: false });
  if (cached) {
    // refresh en background, sin bloquear
    fetch(request).then(function (resp) {
      if (resp && resp.ok && resp.type === 'basic') {
        cache.put(request, resp.clone()).catch(function () {});
      }
    }).catch(function () {});
    return cached;
  }
  try {
    var fresh = await fetch(request);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      cache.put(request, fresh.clone()).catch(function () {});
    }
    return fresh;
  } catch (e) {
    // Para navegaciones, fallback a index cacheado.
    if (request.mode === 'navigate') {
      var idx = await cache.match('./index.html');
      if (idx) return idx;
    }
    throw e;
  }
}

async function handleNoteGet(request) {
  var cache = await caches.open(NOTES_CACHE);
  try {
    var fresh = await fetch(request);
    if (fresh && fresh.ok) {
      // Cloneamos antes de devolver para que la cache no consuma el body.
      cache.put(request, fresh.clone()).catch(function () {});
    }
    return fresh;
  } catch (e) {
    var cached = await cache.match(request);
    if (cached) return cached;
    throw e;
  }
}

async function handleWrite(request, url) {
  // Las escrituras NUNCA se cachean. Si la respuesta es 2xx, invalidamos el GET
  // de ese mismo path para que el proximo open no traiga la version vieja.
  var response = await fetch(request);
  if (response && response.ok) {
    invalidateNoteUrl(url).catch(function () {});
  }
  return response;
}

async function invalidateNoteUrl(writeUrl) {
  // writeUrl.pathname incluye /api/gh/repos/X/Y/contents/{path}, sin query.
  // Los GET usan el mismo pathname + ?ref=branch. Borramos toda entrada que
  // matchee el pathname exacto, sin importar el query.
  var cache = await caches.open(NOTES_CACHE);
  var keys = await cache.keys();
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    try {
      var ku = new URL(k.url);
      if (ku.origin === writeUrl.origin && ku.pathname === writeUrl.pathname) {
        await cache.delete(k);
      }
    } catch (e) {}
  }
}
