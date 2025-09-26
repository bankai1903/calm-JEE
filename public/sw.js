// Service Worker for StudyBuddy AI
const CACHE_NAME = 'studybuddy-v1';
const STATIC_CACHE_NAME = 'studybuddy-static-v1';
const DYNAMIC_CACHE_NAME = 'studybuddy-dynamic-v1';

const STATIC_FILES = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.min.js'
];

const DYNAMIC_CACHE_LIMIT = 50;

// Install event - cache static resources
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching static files');
        return cache.addAll(STATIC_FILES);
      })
      .then(() => {
        console.log('Service Worker: Installed successfully');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('Service Worker: Installation failed', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== STATIC_CACHE_NAME && cacheName !== DYNAMIC_CACHE_NAME) {
              console.log('Service Worker: Deleting old cache', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker: Activated successfully');
        return self.clients.claim();
      })
  );
});

// Fixed fetch event handler - allows external CDN resources
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other non-http(s) schemes
  if (!event.request.url.startsWith('http')) {
    return;
  }

  // Skip API requests - let them go directly to network
  if (event.request.url.includes('/api/')) {
    return;
  }

  // Allow external CDN resources to pass through without caching issues
  const url = new URL(event.request.url);
  const isExternalCDN = url.hostname.includes('cdnjs.cloudflare.com') || 
                       url.hostname.includes('fonts.googleapis.com') ||
                       url.hostname.includes('fonts.gstatic.com');

  if (isExternalCDN) {
    // For external CDNs, just fetch directly and cache if successful
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(DYNAMIC_CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        }).catch(error => {
          console.warn('External CDN fetch failed:', error);
          return new Response('', { status: 404 });
        });
      })
    );
    return;
  }

  // For local resources, use the original caching strategy
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request)
          .then(networkResponse => {
            if (!networkResponse || networkResponse.status !== 200) {
              return networkResponse;
            }

            const responseToCache = networkResponse.clone();
            const shouldCache = 
              url.pathname.endsWith('.css') ||
              url.pathname.endsWith('.js') ||
              url.pathname.endsWith('.png') ||
              url.pathname.endsWith('.jpg') ||
              url.pathname.endsWith('.jpeg') ||
              url.pathname.endsWith('.svg') ||
              url.pathname.endsWith('.woff') ||
              url.pathname.endsWith('.woff2') ||
              url.pathname === '/' ||
              url.pathname.endsWith('.html');

            if (shouldCache) {
              caches.open(DYNAMIC_CACHE_NAME).then(cache => {
                cache.put(event.request, responseToCache).then(() => {
                  limitCacheSize(DYNAMIC_CACHE_NAME, DYNAMIC_CACHE_LIMIT);
                });
              });
            }

            return networkResponse;
          })
          .catch(error => {
            console.warn('Network request failed:', error);
            if (event.request.destination === 'document') {
              return caches.match('/').then(offlineResponse => {
                return offlineResponse || new Response('App is offline', {
                  status: 503,
                  statusText: 'Service Unavailable',
                  headers: { 'Content-Type': 'text/plain' }
                });
              });
            }
            throw error;
          });
      })
  );
});
// Background sync for offline data
self.addEventListener('sync', (event) => {
  console.log('Service Worker: Background sync triggered', event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(syncData());
  }
});

// Push notifications
self.addEventListener('push', (event) => {
  console.log('Service Worker: Push notification received');
  
  const options = {
    body: event.data ? event.data.text() : 'New study reminder!',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'Start Studying',
        icon: '/icons/study-icon.png'
      },
      {
        action: 'close',
        title: 'Remind Later',
        icon: '/icons/close-icon.png'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('StudyBuddy AI', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('Service Worker: Notification clicked', event.action);
  
  event.notification.close();

  if (event.action === 'explore') {
    // Open the app
    event.waitUntil(
      self.clients.openWindow('/#study-timer')
    );
  } else if (event.action === 'close') {
    // Schedule another notification for later
    console.log('Notification dismissed');
  } else {
    // Default action - open the app
    event.waitUntil(
      self.clients.openWindow('/')
    );
  }
});

// Message handling from main thread
self.addEventListener('message', (event) => {
  console.log('Service Worker: Message received', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_STUDY_DATA') {
    // Cache study progress data
    caches.open(DYNAMIC_CACHE_NAME)
      .then(cache => {
        const response = new Response(JSON.stringify(event.data.payload));
        return cache.put('/study-data', response);
      });
  }
});

// Utility function to limit cache size
async function limitCacheSize(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    
    if (keys.length > maxItems) {
      // Remove oldest entries
      const keysToDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(keysToDelete.map(key => cache.delete(key)));
      console.log(`Service Worker: Cleaned cache ${cacheName}, removed ${keysToDelete.length} items`);
    }
  } catch (error) {
    console.error('Service Worker: Error limiting cache size', error);
  }
}

// Sync offline data when connection is restored
async function syncData() {
  try {
    console.log('Service Worker: Syncing offline data...');
    
    // Get cached study data
    const cache = await caches.open(DYNAMIC_CACHE_NAME);
    const studyDataResponse = await cache.match('/study-data');
    
    if (studyDataResponse) {
      const studyData = await studyDataResponse.json();
      
      // Send data to server when online
      const response = await fetch('/api/sync-study-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(studyData)
      });
      
      if (response.ok) {
        console.log('Service Worker: Data synced successfully');
        // Remove cached data after successful sync
        await cache.delete('/study-data');
      }
    }
  } catch (error) {
    console.error('Service Worker: Sync failed', error);
    // Re-register for sync to try again later
    return self.registration.sync.register('background-sync');
  }
}

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  console.log('Service Worker: Periodic sync triggered', event.tag);
  
  if (event.tag === 'study-reminder') {
    event.waitUntil(sendStudyReminder());
  }
});

// Send study reminder notification
async function sendStudyReminder() {
  try {
    const notification = await self.registration.showNotification('Time to Study!', {
      body: 'Take a break and review your study materials',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: 'study-reminder',
      requireInteraction: false,
      actions: [
        {
          action: 'start-study',
          title: 'Start Session'
        },
        {
          action: 'snooze',
          title: 'Remind Later'
        }
      ]
    });
    
    console.log('Service Worker: Study reminder sent');
  } catch (error) {
    console.error('Service Worker: Failed to send reminder', error);
  }
}