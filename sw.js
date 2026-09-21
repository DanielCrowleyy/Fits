/* Fit service worker. The app shell is network-first so a deploy is never masked by a stale
   cache; photographs and fonts are cache-first because they never change once made. */
const SHELL = 'fit-shell-v1';
const MEDIA = 'fit-media-v1';
const SHELL_URLS = ['/', '/index.html', '/style.css', '/app.js', '/engine.js', '/render.js', '/review.js', '/pipeline.js', '/avatar.js', '/avatar3d.js', '/head.webp', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![SHELL, MEDIA].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const isMedia = url => /\/storage\/v1\/object\/sign\//.test(url.pathname) || /fonts\.(googleapis|gstatic)\.com/.test(url.hostname);
// signed URLs carry a token that changes hourly; cache by path so the same photo hits regardless
const mediaKey = url => url.hostname.includes('supabase') ? url.origin + url.pathname : url.href;

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isMedia(url)) {
    e.respondWith(caches.open(MEDIA).then(async c => {
      const hit = await c.match(mediaKey(url)); if (hit) return hit;
      const res = await fetch(req); if (res.ok) c.put(mediaKey(url), res.clone()); return res;
    }));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => { if (res.ok) caches.open(SHELL).then(c => c.put(req, res.clone())); return res; })
      .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/index.html') : undefined))));
  }
});
