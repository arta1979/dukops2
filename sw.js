// sw.js - Service Worker untuk DUKOPS PWA
const CACHE_NAME = 'dukops-v1';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz-3Z-mRq7JLe-d4B85LY4A_rC4fDfeFmM6OelRl24FfEjeN-MW05Qk69fQyPF8w7bS/exec';

// Files to cache
const urlsToCache = [
  '/',
  '/index.html',
  '/sw.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdn.polyfill.io/v3/polyfill.min.js'
];

// Install event - cache semua file statis
self.addEventListener('install', event => {
  console.log('Service Worker: Installing...');
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching files');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('Service Worker: Install complete');
      })
      .catch(error => {
        console.error('Service Worker: Cache failed', error);
      })
  );
});

// Activate event - bersihkan cache lama
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker: Activation complete');
      return self.clients.claim();
    })
  );
});

// Fetch event - strategi network first, lalu cache
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Skip untuk Apps Script calls (biar selalu fresh)
  if (url.href.includes('script.google.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Skip untuk GitHub raw (biar bisa update data)
  if (url.href.includes('raw.githubusercontent.com')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache successful responses
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache if offline
          return caches.match(event.request);
        })
    );
    return;
  }

  // Untuk file statis, coba cache dulu
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Return cached file
          return cachedResponse;
        }

        // If not in cache, fetch from network
        return fetch(event.request)
          .then(response => {
            // Cache the fetched file for future
            if (response && response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseClone);
              });
            }
            return response;
          })
          .catch(error => {
            console.error('Service Worker: Fetch failed', error);
            // Return offline fallback if needed
          });
      })
  );
});

// Background sync untuk pending submissions
self.addEventListener('sync', event => {
  console.log('Service Worker: Background sync triggered', event.tag);
  
  if (event.tag === 'sync-pending-submissions') {
    event.waitUntil(syncPendingSubmissions());
  }
});

// Message event untuk komunikasi dengan main thread
self.addEventListener('message', event => {
  console.log('Service Worker: Message received', event.data);
  
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.action === 'checkUpdate') {
    // Notify clients about update
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({
          action: 'updateAvailable',
          version: event.data.version
        });
      });
    });
  }
});

// Fungsi untuk sync pending submissions
async function syncPendingSubmissions() {
  console.log('Service Worker: Syncing pending submissions...');
  
  try {
    // Ambil pending submissions dari IndexedDB atau cache
    const cache = await caches.open('pending-submissions');
    const requests = await cache.keys();
    
    for (const request of requests) {
      try {
        const response = await fetch(request);
        if (response.ok) {
          await cache.delete(request);
          console.log('Service Worker: Synced submission', request.url);
        }
      } catch (error) {
        console.error('Service Worker: Sync failed for', request.url, error);
      }
    }
  } catch (error) {
    console.error('Service Worker: Sync error', error);
  }
}

// Periodic sync untuk cek update (jika didukung browser)
self.addEventListener('periodicsync', event => {
  console.log('Service Worker: Periodic sync triggered', event.tag);
  
  if (event.tag === 'check-version') {
    event.waitUntil(checkForUpdates());
  }
});

// Fungsi untuk cek update versi
async function checkForUpdates() {
  try {
    const response = await fetch('/version.json?t=' + Date.now());
    if (response.ok) {
      const data = await response.json();
      
      // Bandingkan dengan versi saat ini
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({
          action: 'versionCheck',
          version: data.version
        });
      });
    }
  } catch (error) {
    console.error('Service Worker: Version check failed', error);
  }
}

// Handle push notifications (jika diperlukan)
self.addEventListener('push', event => {
  console.log('Service Worker: Push received', event);
  
  const options = {
    body: event.data ? event.data.text() : 'Ada update baru!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      { action: 'open', title: 'Buka Aplikasi' },
      { action: 'close', title: 'Tutup' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('DUKOPS Update', options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', event => {
  console.log('Service Worker: Notification click', event);
  
  event.notification.close();
  
  if (event.action === 'open') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Error handling
self.addEventListener('error', event => {
  console.error('Service Worker: Error', event.error);
});

self.addEventListener('unhandledrejection', event => {
  console.error('Service Worker: Unhandled rejection', event.reason);
});
