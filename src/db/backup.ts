// Sauvegarde manuelle : un fichier que l'utilisatrice enregistre où elle veut (Fichiers, iCloud Drive, clé USB…).
// Rien n'est envoyé automatiquement à un serveur.
//  - Avec mot de passe : chiffrement AES-GCM 256 bits (clé dérivée par PBKDF2-SHA-256, 600 000 itérations).
//  - Sans mot de passe : fichier JSON lisible par quiconque y a accès.

import { COLLECTIONS, type Data, type FileRec, type Settings } from './schema';
import { data, replaceMemory, defaultDevice, defaultSettings, defaultCategories } from './store';
import { clearAll, getAll, writeMany, type Write } from './idb';
import { decryptBytes, encryptBytes, fromB64, gunzip, gzip, toB64, type EncryptedEnvelope } from '../lib/crypto';

const APP = 'chema';
const FORMAT = 1;

interface PlainBackup {
  app: typeof APP;
  format: number;
  createdAt: string;
  encrypted: false;
  data: Omit<Data, 'device'>;
  files: Array<{ id: string; mime: string; name: string; size: number; data: string }>;
}

interface EncryptedBackup extends EncryptedEnvelope {
  app: typeof APP;
  format: number;
  createdAt: string;
  encrypted: true;
  compressed: boolean;
}

export interface BackupSummary {
  createdAt: string;
  counts: { txs: number; deadlines: number; docs: number; goals: number; recurring: number; files: number };
}

async function blobToB64(b: Blob): Promise<string> {
  return toB64(new Uint8Array(await b.arrayBuffer()));
}

export async function buildBackup(opts: { password?: string; includeFiles: boolean }): Promise<{ blob: Blob; filename: string }> {
  const d = data.value;
  const { device: _device, ...rest } = d;
  const files: PlainBackup['files'] = [];
  if (opts.includeFiles) {
    const recs = await getAll<FileRec>('files');
    const used = new Set(d.docs.map((x) => x.fileId).filter(Boolean));
    for (const f of recs) if (used.has(f.id)) files.push({ id: f.id, mime: f.mime, name: f.name, size: f.size, data: await blobToB64(f.blob) });
  }
  const createdAt = new Date().toISOString();
  const plain: PlainBackup = { app: APP, format: FORMAT, createdAt, encrypted: false, data: rest, files };
  const json = JSON.stringify(plain);
  const stamp = createdAt.slice(0, 10);
  if (!opts.password) {
    return { blob: new Blob([json], { type: 'application/json' }), filename: `chema-sauvegarde-${stamp}-NON-CHIFFREE.json` };
  }
  const bytes = new TextEncoder().encode(json);
  const z = await gzip(bytes);
  const env = await encryptBytes(z ?? bytes, opts.password);
  const enc: EncryptedBackup = { app: APP, format: FORMAT, createdAt, encrypted: true, compressed: !!z, ...env };
  return { blob: new Blob([JSON.stringify(enc)], { type: 'application/json' }), filename: `chema-sauvegarde-${stamp}-chiffree.json` };
}

export async function readBackupFile(file: File): Promise<{ encrypted: boolean; raw: any }> {
  let raw: any;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error('Ce fichier n’est pas une sauvegarde de Chema.');
  }
  if (!raw || raw.app !== APP) throw new Error('Ce fichier n’est pas une sauvegarde de Chema.');
  if (raw.format > FORMAT) throw new Error('Cette sauvegarde vient d’une version plus récente de l’application.');
  return { encrypted: !!raw.encrypted, raw };
}

export async function decodeBackup(raw: any, password?: string): Promise<PlainBackup> {
  if (!raw.encrypted) return raw as PlainBackup;
  if (!password) throw new Error('Mot de passe requis.');
  let bytes = await decryptBytes(raw as EncryptedEnvelope, password);
  if (raw.compressed) bytes = await gunzip(bytes);
  const plain = JSON.parse(new TextDecoder().decode(bytes));
  if (plain.app !== APP) throw new Error('Contenu de sauvegarde invalide.');
  return plain as PlainBackup;
}

export function summarize(b: PlainBackup): BackupSummary {
  const live = (l: Array<{ deletedAt?: string }> = []) => l.filter((x) => !x.deletedAt).length;
  return {
    createdAt: b.createdAt,
    counts: {
      txs: live(b.data.txs),
      deadlines: live(b.data.deadlines),
      docs: live(b.data.docs),
      goals: live(b.data.goals),
      recurring: live(b.data.recurring),
      files: b.files.length,
    },
  };
}

/** Remplace toutes les données de l'appareil par celles de la sauvegarde. Le verrouillage de cet appareil est conservé. */
export async function restoreBackup(b: PlainBackup): Promise<void> {
  const device = data.value?.device ?? defaultDevice();
  const settings: Settings = { ...defaultSettings(), ...(b.data.settings as Settings), id: 'main' };
  const next: any = { settings, device: { ...device, notifLog: {} } };
  for (const c of COLLECTIONS) next[c] = Array.isArray((b.data as any)[c]) ? (b.data as any)[c] : [];
  if (!next.categories.length) next.categories = defaultCategories();
  for (const d of next.docs) if (d.fileId && !b.files.some((f) => f.id === d.fileId)) delete d.fileId;
  await clearAll();
  const writes: Write[] = [
    { store: 'meta', id: 'main', value: settings },
    { store: 'meta', id: 'device', value: next.device },
  ];
  for (const c of COLLECTIONS) for (const x of next[c]) writes.push({ store: c, id: x.id, value: x });
  await writeMany(writes);
  // Fichiers écrits par petits lots pour limiter la mémoire utilisée.
  for (let i = 0; i < b.files.length; i += 10) {
    const chunk = b.files.slice(i, i + 10).map((f) => {
      const blob = new Blob([fromB64(f.data) as BlobPart], { type: f.mime });
      return { store: 'files' as const, id: f.id, value: { id: f.id, blob, mime: f.mime, name: f.name, size: f.size } as FileRec };
    });
    await writeMany(chunk);
  }
  replaceMemory(next as Data);
}

/** Miniatures manquantes après une restauration : recréées à la demande. */
export async function rebuildThumbs(resize: (b: Blob, max: number, q: number) => Promise<Blob>): Promise<void> {
  const recs = await getAll<FileRec>('files');
  for (const r of recs) {
    if (r.thumb || !r.mime.startsWith('image/')) continue;
    try {
      const thumb = await resize(r.blob, 320, 0.7);
      await writeMany([{ store: 'files', id: r.id, value: { ...r, thumb } }]);
    } catch {
      /* ignorée */
    }
  }
}
