/* Service worker de Chema
 * - Met l'application en cache pour qu'elle s'ouvre hors ligne.
 * - N'envoie AUCUNE donnée : il ne fait que servir les fichiers de l'application.
 * - Android/Chrome (app installée) : « periodicsync » best-effort pour notifier les échéances
 *   du lendemain, lorsque le navigateur décide de le déclencher (non garanti).
 */
const VERSION = "f416e568c129";
const PRECACHE = ["./assets/fraunces-latin-600-normal-BFCDtZfi.woff2","./assets/fraunces-latin-600-normal-DL5QCzvS.woff","./assets/index-Da5Vsn6T.css","./assets/index-Dc7vsJVy.js","./icons/apple-touch-icon.png","./icons/badge-96.png","./icons/favicon.svg","./icons/icon-192.png","./icons/icon-512.png","./icons/maskable-512.png","./index.html","./manifest.webmanifest"];
const CACHE = 'chema-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(['./', ...PRECACHE]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('chema-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Réseau d'abord pour la page (mises à jour), cache en secours hors ligne.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./', { ignoreSearch: true, ignoreVary: true })),
    );
    return;
  }
  // Fichiers de l'application : cache d'abord ; ceux qui n'ont pas été pré-téléchargés (ex. lecteur PDF)
  // sont mis en cache à leur première utilisation.
  event.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.pathname.includes('/assets/')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// ---------- Rappels en arrière-plan (best-effort) ----------

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('chema');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function getAll(db, store) {
  return new Promise((resolve, reject) => {
    const r = db.transaction(store, 'readonly').objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function put(db, store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function checkDeadlines() {
  const db = await openDB();
  if (!db.objectStoreNames.contains('deadlines')) return;
  const [meta, deadlines] = await Promise.all([getAll(db, 'meta'), getAll(db, 'deadlines')]);
  const settings = meta.find((m) => m.id === 'main') || {};
  const device = meta.find((m) => m.id === 'device') || { id: 'device', notifLog: {} };
  if (!settings.notificationsWanted) return;
  const now = new Date();
  const today = iso(now);
  const tmr = new Date(now);
  tmr.setDate(tmr.getDate() + 1);
  const tomorrow = iso(tmr);
  const [h, m] = String(settings.reminderTime || '18:00').split(':').map(Number);
  const log = Object.assign({}, device.notifLog || {});
  let changed = false;
  for (const d of deadlines) {
    if (d.deletedAt || d.status === 'done') continue;
    const key = `${d.id}@${d.date}`;
    if (log[key]) continue;
    // La veille à partir de l'heure réglée, ou le jour même (rappel rattrapé).
    const eve = d.date === tomorrow && (now.getHours() > h || (now.getHours() === h && now.getMinutes() >= (m || 0)));
    if (!eve && d.date !== today) continue;
    await self.registration.showNotification(`${d.date === today ? 'Aujourd’hui' : 'Demain'} : ${d.title}`, {
      body: 'Échéance à ne pas oublier.',
      tag: d.id,
      icon: './icons/icon-192.png',
      badge: './icons/badge-96.png',
      data: { url: `#/echeances/${d.id}` },
    });
    log[key] = Date.now();
    changed = true;
  }
  if (changed) await put(db, 'meta', Object.assign({}, device, { notifLog: log }));
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'echeances') event.waitUntil(checkDeadlines().catch(() => null));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '#/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate ? c.navigate('./' + target).catch(() => null) : null;
          return c.focus();
        }
      }
      return self.clients.openWindow('./' + target);
    }),
  );
});
