// État de l'application : tout est chargé en mémoire au démarrage (volumes personnels modestes)
// et chaque modification est écrite immédiatement dans IndexedDB.
// Chaque lot de modifications peut être annulé (bouton « Annuler » des messages).

import { signal } from '@preact/signals';
import { COLLECTIONS, type CollName, type Data, type DeviceSettings, type Settings, type Category } from './schema';
import { getAll, writeMany, type Write } from './idb';
import { toast } from '../ui/feedback';

export const data = signal<Data>(null as unknown as Data);
export const loadError = signal<string | null>(null);

export function uid(): string {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

export const nowStamp = () => new Date().toISOString();

export const DEFAULT_EXPENSE_CATEGORIES: Array<[string, string]> = [
  ['logement', 'Logement'],
  ['alimentation', 'Alimentation'],
  ['transport', 'Transport'],
  ['sante', 'Santé'],
  ['assurances', 'Assurances'],
  ['abonnements', 'Abonnements'],
  ['loisirs', 'Loisirs'],
  ['voyages', 'Voyages'],
  ['administratif', 'Administratif'],
  ['divers', 'Divers'],
];

export const DEFAULT_DOC_CATEGORIES: Array<[string, string, Category['system']?]> = [
  ['doc-identite', 'Identité', 'identity'],
  ['doc-logement', 'Logement'],
  ['doc-assurances', 'Assurances'],
  ['doc-impots', 'Impôts'],
  ['doc-banque', 'Banque', 'bank'],
  ['doc-sante', 'Santé'],
  ['doc-recus', 'Reçus', 'receipts'],
  ['doc-garanties', 'Garanties'],
];

export function defaultCategories(): Category[] {
  return [
    ...DEFAULT_EXPENSE_CATEGORIES.map(([id, name], i): Category => ({ id, kind: 'expense', name, order: i })),
    ...DEFAULT_DOC_CATEGORIES.map(([id, name, system], i): Category => ({ id, kind: 'doc', name, order: i, ...(system ? { system } : {}) })),
  ];
}

export function defaultSettings(): Settings {
  return {
    id: 'main',
    budgets: { CHF: [], MAD: [] },
    reminderTime: '18:00',
    notificationsWanted: false,
    lastCurrency: 'CHF',
    labelRules: {},
    createdAt: nowStamp(),
  };
}

export function defaultDevice(): DeviceSettings {
  return { id: 'device', notifLog: {} };
}

export async function loadAll(): Promise<void> {
  const meta = await getAll<Settings | DeviceSettings>('meta');
  const settings = (meta.find((m) => m.id === 'main') as Settings) ?? defaultSettings();
  const device = (meta.find((m) => m.id === 'device') as DeviceSettings) ?? defaultDevice();
  const colls = await Promise.all(COLLECTIONS.map((c) => getAll<any>(c)));
  const d: any = { settings: { ...defaultSettings(), ...settings }, device: { ...defaultDevice(), ...device } };
  COLLECTIONS.forEach((c, i) => (d[c] = colls[i]));
  const first = !meta.length && !d.categories.length;
  if (!d.categories.length) d.categories = defaultCategories();
  data.value = d as Data;
  if (first) {
    await writeMany([
      { store: 'meta', id: 'main', value: d.settings },
      { store: 'meta', id: 'device', value: d.device },
      ...d.categories.map((c: Category) => ({ store: 'categories' as const, id: c.id, value: c })),
    ]);
  }
}

export type Change =
  | { coll: CollName; id: string; value: any | null }
  | { coll: 'settings'; value: Settings }
  | { coll: 'device'; value: DeviceSettings };

function currentValue(d: Data, c: Change): any {
  if (c.coll === 'settings') return d.settings;
  if (c.coll === 'device') return d.device;
  return (d[c.coll] as any[]).find((x) => x.id === c.id) ?? null;
}

function applyToMemory(d: Data, changes: Change[]): Data {
  const next: any = { ...d };
  for (const c of changes) {
    if (c.coll === 'settings') next.settings = c.value;
    else if (c.coll === 'device') next.device = c.value;
    else {
      const list: any[] = next[c.coll] === d[c.coll] ? [...(d[c.coll] as any[])] : next[c.coll];
      const idx = list.findIndex((x) => x.id === c.id);
      if (c.value === null) {
        if (idx >= 0) list.splice(idx, 1);
      } else if (idx >= 0) list[idx] = c.value;
      else list.push(c.value);
      next[c.coll] = list;
    }
  }
  return next as Data;
}

function toWrites(changes: Change[]): Write[] {
  return changes.map((c) => {
    if (c.coll === 'settings') return { store: 'meta', id: 'main', value: c.value };
    if (c.coll === 'device') return { store: 'meta', id: 'device', value: c.value };
    return { store: c.coll, id: c.id, value: c.value };
  });
}

/**
 * Applique un lot de modifications (mémoire + IndexedDB).
 * Si `undo` est fourni, affiche un message avec le bouton « Annuler ».
 */
export async function commit(changes: Change[], opts: { message?: string; undo?: boolean; tone?: 'ok' | 'info' | 'warn' } = {}): Promise<void> {
  if (!changes.length) return;
  const before = data.value;
  const inverse: Change[] = changes
    .slice()
    .reverse()
    .map((c) => (c.coll === 'settings' || c.coll === 'device' ? { ...c, value: currentValue(before, c) } : { coll: c.coll, id: c.id, value: currentValue(before, c) }));
  data.value = applyToMemory(before, changes);
  try {
    await writeMany(toWrites(changes));
  } catch (e) {
    data.value = before;
    toast(`Enregistrement impossible : ${(e as Error).message || e}. Vérifiez l’espace disponible.`, { tone: 'error', duration: 8000 });
    throw e;
  }
  if (opts.message) {
    toast(opts.message, {
      tone: opts.tone ?? 'ok',
      action: opts.undo
        ? {
            label: 'Annuler',
            run: () => {
              commit(inverse).then(() => toast('Action annulée', { tone: 'info' }));
            },
          }
        : undefined,
    });
  }
}

export function put<T extends { id: string }>(coll: CollName, value: T): Change {
  return { coll, id: value.id, value };
}

export function remove(coll: CollName, id: string): Change {
  return { coll, id, value: null };
}

export function setSettings(patch: Partial<Settings>): Change {
  return { coll: 'settings', value: { ...data.value.settings, ...patch } };
}

export function setDevice(patch: Partial<DeviceSettings>): Change {
  return { coll: 'device', value: { ...data.value.device, ...patch } };
}

/** Remplace toutes les données (restauration). */
export function replaceMemory(d: Data) {
  data.value = d;
}
