// Accès minimal à IndexedDB (base locale du navigateur, sur le téléphone uniquement).

export const DB_NAME = 'chema';
export const DB_VERSION = 1;
export const STORES = ['meta', 'categories', 'txs', 'recurring', 'deadlines', 'docs', 'goals', 'moves', 'files'] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Base de données bloquée : fermez les autres onglets de l’application.'));
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction annulée'));
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDB();
  return wrap(db.transaction(store, 'readonly').objectStore(store).getAll()) as Promise<T[]>;
}

export async function getOne<T>(store: StoreName, id: string): Promise<T | undefined> {
  const db = await openDB();
  return wrap(db.transaction(store, 'readonly').objectStore(store).get(id)) as Promise<T | undefined>;
}

export interface Write {
  store: StoreName;
  id: string;
  value: unknown | null; // null = suppression
}

export async function writeMany(writes: Write[]): Promise<void> {
  if (!writes.length) return;
  const db = await openDB();
  const stores = Array.from(new Set(writes.map((w) => w.store)));
  const tx = db.transaction(stores, 'readwrite');
  for (const w of writes) {
    const os = tx.objectStore(w.store);
    if (w.value === null) os.delete(w.id);
    else os.put(w.value);
  }
  return done(tx);
}

export async function clearAll(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([...STORES], 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  return done(tx);
}

export async function listKeys(store: StoreName): Promise<string[]> {
  const db = await openDB();
  return wrap(db.transaction(store, 'readonly').objectStore(store).getAllKeys()) as Promise<string[]>;
}
