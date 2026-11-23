// Lecture automatique d'un ticket UNIQUEMENT si le navigateur fournit une détection de texte locale
// (API expérimentale TextDetector). Aucune image n'est envoyée à un service externe.
// Sur la plupart des téléphones (dont Safari/iPhone), cette API n'existe pas : la photo est
// simplement conservée et la saisie reste manuelle.

import { parseAmount } from '../lib/money';
import { parseUserDate, type ISODate } from '../lib/dates';

export interface ReceiptGuess {
  amount?: number;
  date?: ISODate;
}

export function hasLocalOCR(): boolean {
  return typeof (window as any).TextDetector === 'function';
}

export function guessFromText(lines: string[]): ReceiptGuess {
  const out: ReceiptGuess = {};
  const totalLine = lines.find((l) => /(total|montant|à payer|a payer|summe|net à payer|ttc)/i.test(l));
  const amountsIn = (l: string) => (l.match(/\d{1,3}(?:['’ .]\d{3})*[.,]\d{2}/g) ?? []).map((x) => parseAmount(x)).filter((x): x is number => x !== null && x > 0);
  if (totalLine) {
    const a = amountsIn(totalLine);
    if (a.length) out.amount = a[a.length - 1];
  }
  if (!out.amount) {
    const all = lines.flatMap(amountsIn);
    if (all.length) out.amount = Math.max(...all);
  }
  for (const l of lines) {
    const m = l.match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/);
    if (m) {
      const d = parseUserDate(m[1]);
      if (d) {
        out.date = d;
        break;
      }
    }
  }
  return out;
}

/** Renvoie null si aucune lecture locale n'est disponible. */
export async function readReceipt(file: Blob): Promise<ReceiptGuess | null> {
  if (!hasLocalOCR()) return null;
  try {
    const bmp = await createImageBitmap(file);
    const det = new (window as any).TextDetector();
    const blocks: Array<{ rawValue: string }> = await det.detect(bmp);
    const g = guessFromText(blocks.map((b) => b.rawValue));
    return g.amount || g.date ? g : null;
  } catch {
    return null;
  }
}
