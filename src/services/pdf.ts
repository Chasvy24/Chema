// Lecture du texte d'un relevé PDF, sur le téléphone, avec PDF.js (Mozilla), embarqué dans l'application.
// Aucun fichier n'est envoyé ailleurs. PDF.js n'est chargé qu'au moment où l'on choisit un PDF.

import type { PdfTextItem } from '../lib/pdftable';

export class PdfReadError extends Error {}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let lib: Promise<PdfJs> | null = null;

async function loadPdfJs(): Promise<PdfJs> {
  if (!lib) {
    lib = (async () => {
      const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return lib;
}

export interface PdfText {
  items: PdfTextItem[];
  pages: number;
}

/**
 * Extrait le texte positionné de chaque page.
 * `askPassword` est appelé si le PDF est protégé (certaines banques chiffrent leurs relevés).
 */
export async function readPdfText(file: File, askPassword: (retry: boolean) => Promise<string | null>, pageOffset = 0): Promise<PdfText> {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let password: string | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    const task = pdfjs.getDocument({ data: bytes.slice(), password, disableFontFace: true, useSystemFonts: false, useWasm: false, useWorkerFetch: false, stopAtErrors: false });
    try {
      const doc = await task.promise;
      const items: PdfTextItem[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        for (const it of tc.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>) {
          if (!it.str || !it.str.trim() || !it.transform) continue;
          const [a, b, c, d, x, y] = it.transform;
          const h = it.height || Math.hypot(c, d) || Math.hypot(a, b) || 8;
          items.push({ str: it.str, x, y, w: it.width ?? it.str.length * h * 0.5, h, page: pageOffset + p });
        }
        page.cleanup();
      }
      const pages = doc.numPages;
      await task.destroy();
      if (!items.length) {
        throw new PdfReadError(`« ${file.name} » ne contient pas de texte lisible (PDF scanné ou image). Chema ne peut pas le lire : utilisez l’export CSV de votre banque si possible.`);
      }
      return { items, pages };
    } catch (e) {
      task.destroy().catch(() => null);
      if (e instanceof PdfReadError) throw e;
      if ((e as { name?: string }).name === 'PasswordException') {
        const pw = await askPassword(attempt > 0);
        if (pw === null) throw new PdfReadError('Lecture annulée : mot de passe non fourni.');
        password = pw;
        continue;
      }
      throw new PdfReadError(`Impossible de lire « ${file.name} » : ${(e as Error).message || 'fichier PDF invalide'}.`);
    }
  }
  throw new PdfReadError('Mot de passe incorrect.');
}
