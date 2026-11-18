// The service worker: keeps the app on the device so it opens at once, even while the server is waking up
// (Cloud Run starts it on the first request after a quiet spell) or when there is no connection at all.
//
//  - The app's own files (the "shell": index.html, the scripts, styles and icons) are saved when this
//    worker installs and are always served from the device. Each deploy stamps a new build into this file
//    (see Dockerfile), so the browser installs the new worker and its files in the background; the new
//    build shows the next time the app is opened.
//  - What the app reads (GET /tasks, /notes, /projects, /config...) comes from the server whenever it can,
//    and each answer is kept on the device. With no connection, the last kept answer is used instead, so
//    every screen shows what it showed last time. Changes made offline wait in outbox.js;
//    a few things (photos, reports, Settings) still need a connection.
//  - Saves (POST, PUT, PATCH, DELETE), sign-in and full-size photos always go to the server.
// Signing out deletes the kept answers (app.js).

const BUILD = '__APP_BUILD__-__APP_COMMIT__';
const SHELL_CACHE = `kb-shell-${BUILD}`;
const DATA_CACHE = 'kb-data';

const SHELL = [
  '/', '/index.html', '/app.css', '/manifest.webmanifest', '/icon.svg', '/logo.svg', '/apple-touch-icon.png',
  '/app.js', '/outbox.js', '/tag-picker.js', '/person-picker.js', '/settings.js', '/projects.js', '/report.js', '/ideas.js',
  '/rich.js', '/notes.js', '/followup.js', '/photos.js', '/workouts.js',
];

// Never kept: sign-in, health checks, and the photo upload/download of full-size images.
const NEVER_KEPT = ['/session', '/health', '/info'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // "reload" skips the browser's own cache, so the files match this build.
    await cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys())
      if (name.startsWith('kb-shell-') && name !== SHELL_CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== location.origin || request.method !== 'GET') return; // saves and Google's sign-in: untouched
  if (NEVER_KEPT.some((p) => url.pathname === p)) return;

  // Opening the app (any #screen): the saved index.html.
  if (request.mode === 'navigate') {
    event.respondWith(fromShell('/index.html', request));
    return;
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith(fromShell(url.pathname, request));
    return;
  }
  // Photo thumbnails never change once added, so a kept one is used as is.
  if (url.pathname.includes('/photos/')) {
    if (url.searchParams.get('size') === 'thumb') event.respondWith(keptFirst(request));
    return;
  }
  event.respondWith(serverFirst(request));
});

async function fromShell(path, request) {
  const cached = await caches.match(path, { cacheName: SHELL_CACHE });
  return cached ?? fetch(request);
}

// The server's answer, kept for next time; the kept one when the server can't be reached.
async function serverFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const kept = await cache.match(request);
    if (kept) return kept;
    throw err;
  }
}

async function keptFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  const kept = await cache.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
