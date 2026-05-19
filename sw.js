/* ═══════════════════════════════════════════════════════════════════
   NEXA — Service Worker  v4.0
   Full offline caching + push notifications + notification actions
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

const CACHE_NAME    = 'nexa-cache-v4';
const CACHE_STATIC  = 'nexa-static-v4';
const CACHE_DYNAMIC = 'nexa-dynamic-v4';

/* Assets to pre-cache on install */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/sync-styles.css',
  '/responsive-fix.css',
  '/reminders.css',
  '/due-datetime.css',
  '/feedback.css',
  '/script.js',
  '/sync.js',
  '/sync-patch.js',
  '/responsive-patch.js',
  '/reminders.js',
  '/due-datetime-patch.js',
  '/feedback.js',
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/* ═══════════════════════════════════════════════════════════════════
   INSTALL — pre-cache static assets
═══════════════════════════════════════════════════════════════════ */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      return cache.addAll(PRECACHE_URLS.map(url => {
        return new Request(url, { cache: 'reload' });
      })).catch(err => {
        /* Non-fatal: SW still installs even if some assets are missing */
        console.warn('[SW] Pre-cache partial failure:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

/* ═══════════════════════════════════════════════════════════════════
   ACTIVATE — clean old caches, claim clients immediately
═══════════════════════════════════════════════════════════════════ */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(k => k !== CACHE_STATIC && k !== CACHE_DYNAMIC)
        .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

/* ═══════════════════════════════════════════════════════════════════
   FETCH — cache-first for static, network-first for API
═══════════════════════════════════════════════════════════════════ */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* Skip non-GET, Firebase, and external CDN requests */
  if (request.method !== 'GET') return;
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('gstatic')) return;

  /* Static assets: cache-first */
  if (PRECACHE_URLS.some(u => url.pathname === u || url.pathname === u + 'index.html')) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            caches.open(CACHE_STATIC).then(c => c.put(request, response.clone()));
          }
          return response;
        });
      })
    );
    return;
  }

  /* Navigation: serve shell */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then(r => r || caches.match('/'))
      )
    );
    return;
  }

  /* Dynamic assets: network-first with cache fallback */
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          caches.open(CACHE_DYNAMIC).then(c => c.put(request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

/* ═══════════════════════════════════════════════════════════════════
   MESSAGE — receive reminder schedule requests from page
═══════════════════════════════════════════════════════════════════ */
self.addEventListener('message', event => {
  const data = event.data;
  if (!data) return;

  /* ── Schedule / show a reminder notification ── */
  if (data.type === 'NEXA_SCHEDULE_REMINDER') {
    event.waitUntil(
      _showReminderNotification(data).then(() => {
        /* Notify all open clients that this reminder fired */
        return self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
          .then(clients => clients.forEach(client =>
            client.postMessage({ type: 'NEXA_REMINDER_FIRED', tag: data.tag })
          ));
      }).catch(err => console.error('[SW] showNotification failed:', err))
    );
    return;
  }

  /* ── Skip waiting (used when a new SW version is waiting) ── */
  if (data.type === 'NEXA_SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
});

/* ─── Build and show the notification with action buttons ─── */
function _showReminderNotification(data) {
  const tag        = data.tag   || 'nexa-reminder';
  const title      = data.title || 'NEXA Reminder';
  const body       = data.body  || 'Your task is due';
  const taskId     = data.taskId || data.data?.taskId || null;
  const priority   = data.priority || '';
  const dueTime    = data.dueTime  || '';

  /* Build body with priority emoji */
  const priEmoji = { high: '🔥', urgent: '⚡', medium: '●', low: '○' }[priority] || '';
  const fullBody = [priEmoji, body, dueTime ? `⏰ ${dueTime}` : '']
    .filter(Boolean).join(' · ');

  const options = {
    body:    fullBody,
    icon:    data.icon  || '/icons/icon-192.png',
    badge:   data.badge || '/icons/icon-192.png',
    tag,
    renotify:  false,
    silent:    false,
    requireInteraction: false,
    vibrate:   [200, 100, 200],
    data:      { tag, taskId },
    actions: [
      { action: 'open',     title: '📋 Open Task'      },
      { action: 'complete', title: '✅ Mark Complete'  },
      { action: 'snooze',   title: '⏰ Snooze 10 min'  },
    ],
  };

  return self.registration.showNotification(title, options);
}

/* ═══════════════════════════════════════════════════════════════════
   NOTIFICATION CLICK — action buttons + default click
═══════════════════════════════════════════════════════════════════ */
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const { action }  = event;
  const { taskId }  = event.notification.data || {};
  const tag         = event.notification.data?.tag || event.notification.tag;

  if (action === 'complete') {
    /* Mark task complete in all open clients */
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(clients => {
          clients.forEach(client => client.postMessage({
            type: 'NEXA_ACTION_COMPLETE',
            taskId,
          }));
          if (clients.length) return clients[0].focus();
          return self.clients.openWindow('/');
        })
    );
    return;
  }

  if (action === 'snooze') {
    /* Schedule a new notification in 10 minutes */
    const snoozeMs = 10 * 60 * 1000;
    event.waitUntil(
      new Promise(resolve => {
        setTimeout(() => {
          self.registration.showNotification(
            event.notification.title + ' (Snoozed)',
            {
              body:    event.notification.body,
              icon:    '/icons/icon-192.png',
              badge:   '/icons/icon-192.png',
              tag:     tag + ':snooze',
              renotify: true,
              data:    { taskId, tag: tag + ':snooze' },
              vibrate: [200, 100, 200],
              actions: [
                { action: 'open',     title: '📋 Open Task'     },
                { action: 'complete', title: '✅ Mark Complete' },
              ],
            }
          );
          resolve();
        }, snoozeMs);
      })
    );
    /* Notify the page about the snooze */
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(clients => clients.forEach(client =>
          client.postMessage({ type: 'NEXA_ACTION_SNOOZED', taskId, snoozeMs })
        ))
    );
    return;
  }

  /* Default: 'open' action or bare notification click — focus or open app */
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        /* Notify clients so they can scroll to the task */
        clients.forEach(client => client.postMessage({
          type: 'NEXA_NOTIFICATION_CLICK',
          taskId,
          tag,
        }));
        if (clients.length) return clients[0].focus();
        return self.clients.openWindow('/');
      })
  );
});

/* ═══════════════════════════════════════════════════════════════════
   NOTIFICATION CLOSE (dismissed by user)
═══════════════════════════════════════════════════════════════════ */
self.addEventListener('notificationclose', event => {
  const { taskId } = event.notification.data || {};
  if (!taskId) return;
  self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(clients => clients.forEach(client =>
      client.postMessage({ type: 'NEXA_NOTIFICATION_DISMISSED', taskId })
    ));
});