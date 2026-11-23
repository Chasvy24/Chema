// Pièces jointes (photos, PDF) stockées comme Blob dans IndexedDB, sur le téléphone.
import { getOne, writeMany } from './idb';
import type { FileRec } from './schema';
import { uid } from './store';

const urlCache = new Map<string, string>();

export async function loadBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      /* repli ci-dessous */
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible sur cet appareil.'));
    };
    img.src = url;
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion impossible'))), type, quality));
}

/** Réduit une image (côté le plus long ≤ max px) pour économiser l'espace du téléphone. */
export async function resizeImage(blob: Blob, max = 2000, quality = 0.85): Promise<Blob> {
  const bmp = await loadBitmap(blob);
  const w = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width;
  const h = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  const scale = Math.min(1, max / Math.max(w, h));
  if (scale === 1 && blob.size < 900_000 && blob.type === 'image/jpeg') return blob;
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp as CanvasImageSource, 0, 0, c.width, c.height);
  return canvasToBlob(c, 'image/jpeg', quality);
}

export async function saveFile(blob: Blob, name: string, opts: { id?: string } = {}): Promise<FileRec> {
  const mime = blob.type || (name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
  let stored = blob;
  let thumb: Blob | undefined;
  if (mime.startsWith('image/')) {
    try {
      stored = await resizeImage(blob);
      thumb = await resizeImage(stored, 320, 0.7);
    } catch {
      stored = blob;
    }
  }
  const rec: FileRec = { id: opts.id ?? uid(), blob: stored, mime: stored.type || mime, name, size: stored.size, thumb };
  await writeMany([{ store: 'files', id: rec.id, value: rec }]);
  return rec;
}

export async function getFile(id: string): Promise<FileRec | undefined> {
  return getOne<FileRec>('files', id);
}

export async function deleteFiles(ids: string[]): Promise<void> {
  for (const id of ids) {
    for (const k of [id, id + ':t']) {
      const u = urlCache.get(k);
      if (u) URL.revokeObjectURL(u);
      urlCache.delete(k);
    }
  }
  await writeMany(ids.map((id) => ({ store: 'files' as const, id, value: null })));
}

/** URL locale (blob:) pour afficher un fichier ou sa miniature. */
export async function fileURL(id: string, thumb = false): Promise<string | null> {
  const key = thumb ? id + ':t' : id;
  const cached = urlCache.get(key);
  if (cached) return cached;
  const rec = await getFile(id);
  if (!rec) return null;
  const blob = thumb ? rec.thumb ?? (rec.mime.startsWith('image/') ? rec.blob : null) : rec.blob;
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

/** Partage (iOS : « Enregistrer dans Fichiers ») ou téléchargement d'un fichier. */
export async function shareOrDownload(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const isTouch = matchMedia('(pointer: coarse)').matches;
  if (isTouch && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  downloadFile(blob, filename);
  return 'downloaded';
}

export function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
