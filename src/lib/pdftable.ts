// Reconstruction d'un tableau (lignes × colonnes) à partir du texte positionné d'un relevé PDF.
// Fonction pure (testable) : le texte est extrait par PDF.js sur le téléphone (services/pdf.ts).

import { parseTextDate, parseUserDate } from './dates';

export interface PdfTextItem {
  str: string;
  x: number; // bord gauche
  y: number; // ligne de base (origine en bas de page)
  w: number;
  h: number; // hauteur ≈ taille de police
  page: number;
}

export interface Cell {
  text: string;
  x0: number;
  x1: number;
  numeric: boolean;
  date: boolean;
}

export interface Line {
  page: number;
  y: number;
  h: number;
  cells: Cell[];
}

const AMOUNT_RE = /^[-+−]?\(?\s*(?:[A-Z]{3}\s*)?\d{1,3}(?:[ '’.  ]?\d{3})*[.,]\d{1,2}\s*\)?\s*-?$/;
const DATE_RE = /^\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?$/;

export const isAmountText = (s: string) => AMOUNT_RE.test(s.trim());
export const isDateText = (s: string) => DATE_RE.test(s.trim()) || parseUserDate(s) !== null || parseTextDate(s, 2000) !== null;

const LEAD_DATE = /^(\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|\d{1,2}\.?\s[A-Za-zÀ-ÿ]{3,9}\.?(?:\s\d{4})?)\s+(.+)$/;
const TRAIL_DATE = /^(.*[A-Za-zÀ-ÿ].*?)\s+(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})$/;
const TRAIL_AMOUNT = /^(.*[A-Za-zÀ-ÿ].*?)\s+([-+−]?\d{1,3}(?:[ '’.\u202f\u00a0]\d{3})*[.,]\d{2}-?)$/;

/** Vraie date (jj.mm.aaaa, ou jj.mm valide) — « 12.50 » n'en est pas une. */
function isDateToken(s: string): boolean {
  if (parseUserDate(s) || parseTextDate(s, 2000)) return true;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})$/);
  return !!m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12;
}

/**
 * Découpe une cellule qui mélange plusieurs colonnes (PDF.js regroupe parfois le texte d'une même ligne) :
 * date en tête, montant ou date en fin. La position des morceaux est estimée au prorata des caractères ;
 * le bord droit d'un montant final reste exact (c'est son repère d'alignement).
 */
function splitCell(c: Cell): Cell[] {
  const left: Cell[] = [];
  const right: Cell[] = [];
  let cur = c;
  for (let k = 0; k < 6; k++) {
    const t = cur.text;
    const x0 = cur.x0;
    const w = cur.x1 - cur.x0;
    const at = (n: number) => x0 + (w * n) / t.length;
    let m = cur.numeric ? null : t.match(LEAD_DATE);
    if (m && isDateToken(m[1])) {
      left.push(makeCell(m[1], x0, at(m[1].length)));
      cur = makeCell(m[2], at(t.length - m[2].length), cur.x1);
      continue;
    }
    m = cur.numeric ? null : t.match(TRAIL_AMOUNT);
    if (m) {
      right.unshift(makeCell(m[2], at(t.length - m[2].length), cur.x1));
      cur = makeCell(m[1], x0, at(m[1].length));
      continue;
    }
    m = cur.date ? null : t.match(TRAIL_DATE);
    if (m) {
      right.unshift(makeCell(m[2], at(t.length - m[2].length), cur.x1));
      cur = makeCell(m[1], x0, at(m[1].length));
      continue;
    }
    break;
  }
  return [...left, cur, ...right];
}

function makeCell(text: string, x0: number, x1: number): Cell {
  const t = text.replace(/\s+/g, ' ').trim();
  return { text: t, x0, x1, numeric: isAmountText(t), date: isDateText(t) };
}

/** Regroupe les morceaux de texte en lignes, puis en cellules (un écart large = nouvelle cellule). */
export function groupLines(items: PdfTextItem[]): Line[] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: Array<{ page: number; y: number; h: number; items: PdfTextItem[] }> = [];
  for (const it of sorted) {
    const h = it.h > 0 ? it.h : 8;
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= Math.max(2, 0.45 * Math.min(h, last.h))) last.items.push(it);
    else lines.push({ page: it.page, y: it.y, h, items: [it] });
  }
  return lines.map((l) => {
    const its = l.items.sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    let text = its[0].str;
    let x0 = its[0].x;
    let x1 = its[0].x + its[0].w;
    for (let i = 1; i < its.length; i++) {
      const it = its[i];
      const gap = it.x - x1;
      const h = it.h > 0 ? it.h : l.h;
      const standalone = isDateText(it.str.trim()) || isAmountText(it.str.trim());
      if (gap > 0.9 * h || (gap > 0.25 * h && standalone)) {
        cells.push(makeCell(text, x0, x1));
        text = it.str;
        x0 = it.x;
      } else {
        text += gap > 0.12 * h && !text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' + it.str : it.str;
      }
      x1 = Math.max(x1, it.x + it.w);
    }
    cells.push(makeCell(text, x0, x1));
    // Cellules mélangeant plusieurs colonnes : on les sépare.
    const out = cells.flatMap(splitCell);
    return { page: l.page, y: l.y, h: l.h, cells: out };
  });
}

interface Column {
  x0: number;
  x1: number;
  anchor: number;
  numeric: boolean;
  count: number;
}

function cluster(values: Array<{ anchor: number; cell: Cell }>, numeric: boolean, tol: number): Column[] {
  const sorted = [...values].sort((a, b) => a.anchor - b.anchor);
  const cols: Array<Column & { sum: number }> = [];
  for (const v of sorted) {
    const last = cols[cols.length - 1];
    if (last && v.anchor - last.sum / last.count <= tol) {
      last.count++;
      last.sum += v.anchor;
      last.x0 = Math.min(last.x0, v.cell.x0);
      last.x1 = Math.max(last.x1, v.cell.x1);
    } else cols.push({ x0: v.cell.x0, x1: v.cell.x1, anchor: v.anchor, numeric, count: 1, sum: v.anchor });
  }
  return cols.map((c) => ({ x0: c.x0, x1: c.x1, anchor: c.sum / c.count, numeric: c.numeric, count: c.count }));
}

const isTxLine = (l: Line) => l.cells.slice(0, 2).some((c) => c.date) && l.cells.some((c) => c.numeric);

/**
 * Construit un tableau : les colonnes sont déduites des lignes d'opérations (date + montant).
 * Montants alignés à droite (repère = bord droit), textes alignés à gauche (repère = bord gauche).
 */
export interface LineMeta {
  page: number;
  y: number;
  h: number;
}

export function buildTable(lines: Line[]): { rows: string[][]; meta: LineMeta[]; columns: number; txLines: number } {
  const tx = lines.filter(isTxLine);
  const base = tx.length >= 2 ? tx : lines;
  // Colonnes de texte : présentes sur au moins 10 % des lignes. Colonnes de montants : une seule valeur suffit
  // (un mois peut ne compter qu'une ou deux entrées d'argent dans la colonne Crédit).
  const minCount = Math.max(2, Math.floor(base.length * 0.1));
  const numericCells = base.flatMap((l) => l.cells.filter((c) => c.numeric).map((cell) => ({ anchor: cell.x1, cell })));
  const textCells = base.flatMap((l) => l.cells.filter((c) => !c.numeric).map((cell) => ({ anchor: cell.x0, cell })));
  let cols = [...cluster(textCells, false, 14).filter((c) => c.count >= minCount), ...cluster(numericCells, true, 14)];
  if (!cols.length) cols = [...cluster(textCells, false, 14), ...cluster(numericCells, true, 14)];
  cols.sort((a, b) => a.x0 - b.x0 || a.anchor - b.anchor);

  const rows = lines.map((l) => {
    const row: string[] = cols.map(() => '');
    for (const c of l.cells) {
      let best = -1;
      let bestScore = -Infinity;
      cols.forEach((col, i) => {
        // Parmi les colonnes chevauchées, la plus proche de son repère d'alignement
        // (bord gauche pour un texte, bord droit pour un montant).
        const overlap = Math.min(c.x1, col.x1) - Math.max(c.x0, col.x0);
        const typeBonus = col.numeric === c.numeric ? 30 : 0;
        const dist = col.numeric ? Math.abs(c.x1 - col.anchor) : Math.abs(c.x0 - col.anchor);
        const score = (overlap > 0 ? 1000 : 0) + typeBonus - dist;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      });
      if (best >= 0) row[best] = row[best] ? `${row[best]} ${c.text}` : c.text;
    }
    return row;
  });
  const keep = rows.map((r) => r.some((x) => x));
  return {
    rows: rows.filter((_, i) => keep[i]),
    meta: lines.filter((_, i) => keep[i]).map((l) => ({ page: l.page, y: l.y, h: l.h })),
    columns: cols.length,
    txLines: tx.length,
  };
}

/** Année la plus citée dans le document (pour les dates sans année : « 03.11 »). */
export function yearHint(items: PdfTextItem[], fallback: number): number {
  const counts = new Map<number, number>();
  for (const it of items) for (const m of it.str.matchAll(/\b(20\d{2})\b/g)) counts.set(+m[1], (counts.get(+m[1]) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}
