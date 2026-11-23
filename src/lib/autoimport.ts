// Lecture automatique d'un relevé : Chema essaie les combinaisons de colonnes plausibles
// (date, montant unique ou débit/crédit, sens des montants) et garde celle qui lit le plus
// d'opérations — en la vérifiant avec la colonne Solde du relevé quand elle existe :
// chaque solde doit être égal au solde précédent plus ou moins le montant de l'opération.

import { analyzeColumns, detectHeaderRow, extractRows, guessMapping, type ColumnInfo, type ColumnMapping, type ExtractOptions, type ParsedRow } from './csv';
import { parseAmount } from './money';

export interface AutoResult {
  headerRow: number;
  map: ColumnMapping;
  parsed: ParsedRow[];
  /** Part des montants confirmés par le solde (0 si pas de colonne Solde exploitable) */
  checkRate: number;
  checked: boolean;
}

/** Vérifie les montants avec une colonne de solde (dans l'ordre du relevé ou à l'envers). */
export function balanceCheck(rows: string[][], parsed: ParsedRow[], map: ColumnMapping, cols: ColumnInfo[]): number {
  const used = new Set(map.mode === 'split' ? [map.debit, map.credit, map.date] : [map.amount, map.date]);
  const cands = cols.filter((c) => !used.has(c.index) && !c.sensitive && c.amountRatio >= 0.8 && c.fill >= 0.5);
  let best = 0;
  for (const col of cands) {
    const seq: Array<{ bal: number; signed: number }> = [];
    for (const p of parsed) {
      if (!p.ok) continue;
      const bal = parseAmount(rows[p.line - 1]?.[col.index] ?? '');
      if (bal === null) continue;
      seq.push({ bal, signed: p.credit ? p.amount! : -p.amount! });
    }
    if (seq.length < 3) continue;
    let fwd = 0;
    let rev = 0;
    for (let i = 1; i < seq.length; i++) {
      if (Math.abs(seq[i].bal - seq[i - 1].bal - seq[i].signed) <= 1) fwd++;
      if (Math.abs(seq[i - 1].bal - seq[i].bal - seq[i - 1].signed) <= 1) rev++;
    }
    best = Math.max(best, Math.max(fwd, rev) / (seq.length - 1));
  }
  return best;
}

interface Candidate {
  h: number;
  map: ColumnMapping;
  guess: boolean;
}

function candidates(rows: string[][]): Array<Candidate & { cols: ColumnInfo[] }> {
  const out: Array<Candidate & { cols: ColumnInfo[] }> = [];
  const headers = Array.from(new Set([detectHeaderRow(rows), -1]));
  for (const h of headers) {
    const data = rows.slice(h + 1);
    const cols = analyzeColumns(h >= 0 ? rows[h] ?? null : null, data);
    const g = guessMapping(cols, data);
    out.push({ h, map: g, guess: true, cols });
    const dates = [g.date, ...cols.filter((c) => c.dateRatio >= 0.6 && c.index !== g.date).map((c) => c.index)].slice(0, 2);
    const numeric = cols
      .filter((c) => !c.sensitive && c.amountRatio >= 0.8 && c.fill > 0 && c.dateRatio < 0.5)
      .map((c) => c.index)
      .slice(0, 4);
    for (const date of dates) {
      let label = g.label;
      if (label === date || numeric.includes(label)) {
        label = [...cols].filter((c) => c.index !== date && !numeric.includes(c.index) && c.dateRatio < 0.5).sort((a, b) => b.avgLen - a.avgLen)[0]?.index ?? label;
      }
      const base = { ...g, date, label, label2: -1 };
      for (const a of numeric) {
        if (a === date) continue;
        out.push({ h, guess: false, cols, map: { ...base, mode: 'single', amount: a, sign: 'negative' } });
        out.push({ h, guess: false, cols, map: { ...base, mode: 'single', amount: a, sign: 'positive' } });
        for (const b of numeric) {
          if (b === a || b === date) continue;
          out.push({ h, guess: false, cols, map: { ...base, mode: 'split', debit: a, credit: b } });
        }
      }
    }
  }
  return out;
}

/** Choisit automatiquement la meilleure lecture du relevé. */
export function autoMap(rows: string[][], opts: ExtractOptions = {}): AutoResult {
  const cands = candidates(rows);
  // Évaluation rapide sur un échantillon, puis lecture complète avec la meilleure combinaison.
  const sampleEnd = Math.min(rows.length, 220);
  const sampleRows = rows.slice(0, sampleEnd);
  let best: { c: (typeof cands)[number]; score: number } | null = null;
  for (const c of cands) {
    const parsed = extractRows(sampleRows, c.h, c.map, opts);
    const ok = parsed.filter((p) => p.ok);
    const expenses = ok.filter((p) => !p.credit).length;
    const rate = balanceCheck(sampleRows, parsed, c.map, c.cols);
    const score = ok.length * 10 + (rate >= 0.6 ? 100_000 * rate : 0) + (expenses >= ok.length - expenses ? 5 : 0) + (c.guess ? 3 : 0);
    if (!best || score > best.score) best = { c, score };
  }
  const c = best!.c;
  const parsed = extractRows(rows, c.h, c.map, opts);
  const checkRate = balanceCheck(rows, parsed, c.map, c.cols);
  return { headerRow: c.h, map: c.map, parsed, checkRate, checked: checkRate >= 0.6 };
}
