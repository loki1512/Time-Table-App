/* ─── IIM Sambalpur Timetable – Service Worker ───────────────────────────── */

const CACHE_NAME = 'iim-timetable-v3';
const STATIC_ASSETS = [
  '/',
  '/static/css/style.css',
  '/static/css/admin.css',
  '/static/js/app.js',
  '/static/js/admin.js',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
];

// ─── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { credentials: 'include' })));
    }).catch(err => {
      console.warn('[SW] Install cache error (non-fatal):', err);
    })
  );
});

// ─── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// ─── FETCH ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Always fetch API calls from network directly
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/login') || url.pathname.startsWith('/logout')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response(JSON.stringify({ error: 'Offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // Network-First for everything (HTML, JS, CSS) so updates appear instantly without hard-refresh
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache when offline
        return caches.match(event.request).then(cached => cached || caches.match('/'));
      })
  );
});

// ─── PUSH NOTIFICATIONS ───────────────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = { title: 'IIM Timetable', body: 'You have a notification.' };
  try {
    data = event.data.json();
  } catch (e) {
    try { data.body = event.data.text(); } catch (e2) {}
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'IIM Timetable', {
      body: data.body || '',
      icon: '/static/icons/icon-192.png',
      badge: '/static/icons/icon-72.png',
      tag: data.tag || 'general',
      data: data,
      actions: data.actions || [],
      requireInteraction: false,
      silent: false,
    })
  );
});

// ─── NOTIFICATION CLICK ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ─── BACKGROUND SYNC ─────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-timetable') {
    event.waitUntil(syncTimetable());
  }
});

async function syncTimetable() {
  // Future: sync offline changes
  console.log('[SW] Background sync triggered');
}

// ─── SCHEDULED NOTIFICATIONS (via periodic background sync) ─────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-classes') {
    event.waitUntil(checkUpcomingClasses());
  }
});

async function checkUpcomingClasses() {
  try {
    const res = await fetch('/api/today', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    // Actual scheduling is done client-side in app.js
    console.log('[SW] Periodic sync: timetable refreshed');
  } catch (e) {
    console.warn('[SW] Periodic sync failed:', e);
  }
}
