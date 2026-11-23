// Import de relevés bancaires CSV téléchargés manuellement. Aucune connexion bancaire.
// Le contenu brut n'est jamais enregistré : seules les opérations validées le sont.

import { parseUserDate, diffDays, addDays, today, type ISODate } from './dates';
import { parseAmount } from './money';
import { detectSensitive, maskSensitive } from './sensitive';
import { labelSimilarity } from './categorize';
import type { Tx } from '../db/schema';
import type { Currency } from './money';
import type { Occurrence } from './recurring';

/** Décode le fichier : UTF-8 si valide, sinon Windows-1252 (fréquent dans les exports bancaires). */
export function decodeBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.replace(/^﻿/, '');
}

export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  let best = ';';
  let bestScore = -1;
  for (const d of [';', ',', '\t', '|']) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const freq = new Map<number, number>();
    for (const c of counts) if (c > 1) freq.set(c, (freq.get(c) ?? 0) + 1);
    let score = 0;
    for (const [n, f] of freq) score = Math.max(score, f * Math.min(n, 12));
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function splitLine(line: string, d: string): string[] {
  return parseCSV(line, d)[0] ?? [];
}

/** Analyseur CSV (guillemets, retours à la ligne dans les champs, CRLF). */
export function parseCSV(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field.trim() === '') {
      inQuotes = true;
      field = '';
    } else if (c === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f !== ''));
}

const HEADER_WORDS = /(date|datum|libell|description|texte|text|montant|betrag|amount|d[ée]bit|cr[ée]dit|belastung|gutschrift|valeur|valuta|solde|saldo|op[ée]ration|buchung|motif|r[ée]f[ée]rence|devise|währung|currency)/i;

export function detectHeaderRow(rows: string[][]): number {
  const counts = rows.slice(0, 40).map((r) => r.length);
  const freq = new Map<number, number>();
  for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
  const modal = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
  const wide = (r: string[]) => r.filter((f) => f !== '').length >= 2 && r.length >= Math.max(2, modal - 1);
  const hasDate = (r: string[]) => r.some((f) => parseUserDate(f) !== null);
  // 1) Une vraie ligne de titres (Date, Libellé, Débit…) sans date.
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i];
    if (wide(r) && !hasDate(r) && r.filter((f) => HEADER_WORDS.test(f)).length >= 2) return i;
  }
  // 2) Sinon : la ligne qui précède la première ligne datée (pas d'en-tête explicite).
  for (let i = 0; i < Math.min(rows.length, 40); i++) if (wide(rows[i]) && hasDate(rows[i])) return Math.max(-1, i - 1);
  return 0;
}

export interface ColumnMapping {
  date: number;
  label: number;
  label2: number; // -1 si aucune
  mode: 'single' | 'split';
  amount: number;
  debit: number;
  credit: number;
  /** single : 'negative' = les dépenses sont négatives ; 'positive' = les dépenses sont positives */
  sign: 'negative' | 'positive';
  dateOrder: 'auto' | 'dmy' | 'mdy' | 'ymd';
}

export interface ColumnInfo {
  index: number;
  name: string;
  dateRatio: number;
  amountRatio: number;
  sensitive: boolean;
  avgLen: number;
}

export function analyzeColumns(header: string[] | null, data: string[][]): ColumnInfo[] {
  const width = Math.max(header?.length ?? 0, ...data.slice(0, 50).map((r) => r.length));
  const sample = data.slice(0, 60);
  const cols: ColumnInfo[] = [];
  for (let i = 0; i < width; i++) {
    const vals = sample.map((r) => r[i] ?? '').filter((v) => v !== '');
    const n = vals.length || 1;
    const dateRatio = vals.filter((v) => parseUserDate(v) !== null).length / n;
    const amountRatio = vals.filter((v) => /\d/.test(v) && parseAmount(v) !== null && !parseUserDate(v)).length / n;
    const sensitiveVals = vals.filter((v) => detectSensitive(v).some((h) => h.kind !== 'id')).length / n;
    const nameSensitive = /(iban|compte|konto|account|carte|karte|card|num[ée]ro|rib)/i.test(header?.[i] ?? '');
    cols.push({
      index: i,
      name: header?.[i] || `Colonne ${i + 1}`,
      dateRatio,
      amountRatio,
      sensitive: (nameSensitive && sensitiveVals > 0.2) || sensitiveVals > 0.6,
      avgLen: vals.reduce((s, v) => s + v.length, 0) / n,
    });
  }
  return cols;
}

export function guessMapping(cols: ColumnInfo[]): ColumnMapping {
  const used = new Set<number>();
  const by = (...res: RegExp[]) => {
    for (const re of res) {
      const c = cols.find((c) => re.test(c.name) && !c.sensitive && !used.has(c.index));
      if (c) return c.index;
    }
    return -1;
  };
  let date = by(/^(date|datum)$/i, /(date|datum|jour)(?!.*valeur)/i, /date|datum|valuta|valeur/i);
  if (date < 0) date = [...cols].sort((a, b) => b.dateRatio - a.dateRatio)[0]?.index ?? 0;
  used.add(date);
  let label = by(/libell/i, /(description|texte|text|buchungstext|motif|bezeichnung|communication)/i, /(d[ée]tail|op[ée]ration|avis)/i);
  if (label < 0) label = [...cols].filter((c) => c.index !== date && !c.sensitive && c.amountRatio < 0.5).sort((a, b) => b.avgLen - a.avgLen)[0]?.index ?? 1;
  const debit = by(/(d[ée]bit|belastung|lastschrift|sortie|withdraw)/i);
  const credit = by(/(cr[ée]dit|gutschrift|entr[ée]e|deposit)/i);
  let amount = by(/(montant|betrag|amount|somme)/i);
  if (amount < 0) {
    amount = [...cols].filter((c) => c.index !== date && !/solde|saldo|balance/i.test(c.name)).sort((a, b) => b.amountRatio - a.amountRatio)[0]?.index ?? -1;
  }
  const mode: ColumnMapping['mode'] = debit >= 0 && credit >= 0 && debit !== credit ? 'split' : 'single';
  return { date, label, label2: -1, mode, amount, debit, credit, sign: 'negative', dateOrder: 'auto' };
}

/** Ordre des dates : jour avant mois sauf preuve du contraire dans le fichier. */
export function detectDateOrder(values: string[]): 'dmy' | 'mdy' | 'ymd' {
  let firstOver12 = false;
  let secondOver12 = false;
  for (const v of values) {
    if (/^\d{4}[-/.]/.test(v.trim())) return 'ymd';
    const m = v.trim().match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) firstOver12 = true;
    if (+m[2] > 12) secondOver12 = true;
  }
  if (secondOver12 && !firstOver12) return 'mdy';
  return 'dmy';
}

export type RowKind = 'expense' | 'refund' | 'income';

export interface ParsedRow {
  line: number; // numéro de ligne dans le fichier (1 = première)
  ok: boolean;
  error?: string;
  /** Ligne écartée sans être une erreur (PDF : en-tête, solde, total…) */
  ignored?: boolean;
  date?: ISODate;
  label: string;
  amount?: number; // centimes, positif
  credit?: boolean; // entrée d'argent
  maskedCount: number;
}

export interface ExtractOptions {
  /** Relevé PDF : lignes de suite rattachées au libellé précédent, en-têtes/soldes/totaux écartés. */
  pdf?: boolean;
  /** Année à utiliser pour les dates sans année (« 03.11 »). */
  yearHint?: number;
  /** PDF : position de chaque ligne du tableau (même index que `rows`). */
  lineMeta?: Array<{ page: number; y: number; h: number }>;
}

// Dans les libellés bancaires, les références du type « P1234567 » ne sont pas des numéros de passeport :
// on masque IBAN, cartes, AVS et numéros de compte, pas ces références.
const maskLabel = (s: string) => maskSensitive(s, { skip: ['id'] });

function parseDateCell(value: string, order: 'dmy' | 'mdy' | 'ymd', yearHint?: number, ref: ISODate = today()): ISODate | null {
  const d = parseUserDate(value, order);
  if (d || !yearHint) return d;
  const m = value.trim().match(/^(\d{1,2})[./-](\d{1,2})\.?$/);
  if (!m) return null;
  const [a, b] = order === 'mdy' ? [+m[2], +m[1]] : [+m[1], +m[2]];
  let iso = parseUserDate(`${a}.${b}.${yearHint}`, 'dmy');
  // Relevé de décembre lu en janvier : une date « future » de plus d'un mois appartient à l'année précédente.
  if (iso && iso > addDays(ref, 31)) iso = parseUserDate(`${a}.${b}.${yearHint - 1}`, 'dmy');
  return iso;
}

export function extractRows(rows: string[][], headerRow: number, map: ColumnMapping, opts: ExtractOptions = {}): ParsedRow[] {
  const data = rows.slice(headerRow + 1);
  const order = map.dateOrder === 'auto' ? detectDateOrder(data.map((r) => r[map.date] ?? '')) : map.dateOrder;
  const out: ParsedRow[] = [];
  let lastOk: ParsedRow | null = null;
  let lastOkIndex = -10;
  let lastMeta: { page: number; y: number; h: number } | undefined;
  data.forEach((r, i) => {
    const line = headerRow + 2 + i;
    const rawLabel = [r[map.label] ?? '', map.label2 >= 0 ? r[map.label2] ?? '' : ''].filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim();
    const { text: label, count: maskedCount } = maskLabel(rawLabel);
    const date = parseDateCell(r[map.date] ?? '', order, opts.yearHint);
    let amount: number | null = null;
    let credit = false;
    if (map.mode === 'split') {
      const d = parseAmount(r[map.debit] ?? '');
      const c = parseAmount(r[map.credit] ?? '');
      if (d && d !== 0) {
        amount = Math.abs(d);
        credit = false;
      } else if (c && c !== 0) {
        amount = Math.abs(c);
        credit = true;
      } else if (d === 0 || c === 0) amount = 0;
    } else {
      const a = parseAmount(r[map.amount] ?? '');
      if (a !== null) {
        amount = Math.abs(a);
        credit = map.sign === 'negative' ? a > 0 : a < 0;
      }
    }
    if (opts.pdf && !date) {
      const otherText = r.some((cell, k) => cell && k !== map.label && k !== map.label2 && k !== map.date);
      // Suite du libellé de l'opération précédente : ligne de texte seule, juste en dessous
      // (même page, interligne serré). Un pied de page ou l'en-tête de la page suivante n'est pas rattaché.
      const meta = opts.lineMeta?.[headerRow + 1 + i];
      const close = meta && lastMeta ? meta.page === lastMeta.page && lastMeta.y - meta.y > 0 && lastMeta.y - meta.y <= 1.6 * Math.max(meta.h, lastMeta.h) : i - lastOkIndex === 1;
      if (lastOk && amount === null && label && !otherText && i - lastOkIndex === 1 && close) {
        const merged = maskLabel(`${lastOk.label} ${label}`.replace(/\s+/g, ' '));
        lastOk.label = merged.text.slice(0, 200);
        lastOk.maskedCount = merged.count;
        lastOkIndex = i;
        lastMeta = meta;
        return;
      }
      lastOk = null;
      out.push({ line, ok: false, ignored: true, error: 'Ligne sans date (en-tête, solde, total…)', label: label || maskLabel(r.filter(Boolean).join(' ')).text, maskedCount });
      return;
    }
    if (!date) return out.push({ line, ok: false, error: `Date illisible : « ${r[map.date] ?? ''} »`, label, maskedCount });
    if (amount === null || amount === 0) {
      if (opts.pdf) return out.push({ line, ok: false, ignored: true, error: 'Ligne sans montant (solde, report…)', label, date, maskedCount });
      return out.push({ line, ok: false, error: amount === 0 ? 'Montant nul' : 'Montant illisible ou absent', label, date, maskedCount });
    }
    const row: ParsedRow = { line, ok: true, date, label: label || '(sans libellé)', amount, credit, maskedCount };
    out.push(row);
    lastOk = row;
    lastOkIndex = i;
    lastMeta = opts.lineMeta?.[headerRow + 1 + i];
  });
  return out;
}

/** Doublon possible : même date et même montant, ou montant identique avec libellé proche à ±3 jours. */
export function findDuplicate(row: { date: ISODate; amount: number; label: string }, currency: Currency, txs: Tx[]): Tx | null {
  for (const t of txs) {
    if (t.deletedAt || t.currency !== currency || t.amount !== row.amount) continue;
    if (t.date === row.date) return t;
    if (Math.abs(diffDays(t.date, row.date)) <= 3 && labelSimilarity(t.label, row.label) >= 0.5) return t;
  }
  return null;
}

/** Correspondance avec une charge fixe prévue (montant proche, ou nom retrouvé dans le libellé, à ±7 jours). */
export function matchOccurrence(row: { date: ISODate; amount: number; label: string }, occs: Occurrence[]): Occurrence | null {
  let best: Occurrence | null = null;
  let bestScore = 0;
  for (const o of occs) {
    if (o.status !== 'planned') continue;
    const dd = Math.abs(diffDays(o.dueDate, row.date));
    if (dd > 10) continue;
    const sameAmount = o.amount === row.amount;
    const closeAmount = o.amount > 0 && Math.abs(o.amount - row.amount) / o.amount <= 0.15;
    const sim = labelSimilarity(o.rec.name, row.label);
    const score = (sameAmount ? 2 : closeAmount ? 1 : 0) + (sim >= 0.5 ? 1.5 : 0) - dd / 20;
    if ((sameAmount || (closeAmount && sim >= 0.5)) && score > bestScore) {
      best = o;
      bestScore = score;
    }
  }
  return best;
}
