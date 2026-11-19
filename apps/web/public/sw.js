/* App-shell cache: the app opens and records without a network after the first visit.
   API calls (cross-origin) are never cached here. */
const CACHE = 'ffs-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const base = self.registration.scope;
      const res = await fetch(base, { cache: 'reload' });
      const html = await res.clone().text();
      await cache.put(base, res);
      const assets = [...html.matchAll(/(?:src|href)="(\.?\/?[^"#?]+\.(?:js|css|svg|webmanifest))"/g)].map((m) => new URL(m[1], base).href);
      await Promise.all(assets.map((u) => cache.add(u).catch(() => undefined)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Deployment settings must never be served stale.
  if (url.pathname.endsWith('/config.json')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const fresh = await fetch(req, { cache: 'no-store' });
          if (fresh.ok) cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return (await cache.match(req)) ?? Response.error();
        }
      })()
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const fresh = await fetch(req);
          if (fresh.ok) cache.put(self.registration.scope, fresh.clone());
          return fresh;
        } catch {
          return (await cache.match(self.registration.scope)) ?? Response.error();
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })()
  );
});
