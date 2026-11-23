// Charges fixes : les occurrences mensuelles sont calculées (pas recopiées), ce qui évite
// les doublons. Une occurrence est « payée » uniquement si une opération confirmée la référence.

import type { Recurring, Tx } from '../db/schema';
import { dayInMonth, monthDiff, monthOf, type ISODate, type MonthKey } from './dates';

export interface Occurrence {
  key: string; // `${recId}@${month}`
  rec: Recurring;
  month: MonthKey;
  dueDate: ISODate;
  amount: number; // montant attendu (ou payé)
  baseAmount: number;
  overridden: boolean;
  status: 'planned' | 'paid' | 'skipped';
  tx?: Tx;
}

export const occKey = (recId: string, month: MonthKey) => `${recId}@${month}`;

export function baseAmountFor(rec: Recurring, month: MonthKey): number {
  const sorted = [...rec.amounts].sort((a, b) => a.from.localeCompare(b.from));
  let amt = sorted.length ? sorted[0].amount : 0;
  for (const e of sorted) if (e.from <= month) amt = e.amount;
  return amt;
}

export function isPausedOn(rec: Recurring, date: ISODate): boolean {
  return rec.pauses.some((p) => p.from <= date && (!p.to || date < p.to));
}

export function isCurrentlyPaused(rec: Recurring): boolean {
  return rec.pauses.some((p) => !p.to);
}

/** Date d'échéance de la charge pour ce mois, ou null si elle ne tombe pas ce mois-là. */
export function dueDateIn(rec: Recurring, month: MonthKey): ISODate | null {
  const startMonth = monthOf(rec.startDate);
  const diff = monthDiff(startMonth, month);
  if (diff < 0 || diff % rec.frequency !== 0) return null;
  const due = dayInMonth(month, rec.day);
  if (due < rec.startDate) return null;
  if (rec.endDate && due > rec.endDate) return null;
  return due;
}

/** Index des paiements de charges fixes : clé d'occurrence → opération */
export function paidIndex(txs: Tx[]): Map<string, Tx> {
  const map = new Map<string, Tx>();
  for (const t of txs) if (t.occurrence && !t.deletedAt) map.set(t.occurrence, t);
  return map;
}

export function occurrencesForMonth(recs: Recurring[], txs: Tx[] | Map<string, Tx>, month: MonthKey): Occurrence[] {
  const paid = txs instanceof Map ? txs : paidIndex(txs);
  const out: Occurrence[] = [];
  for (const rec of recs) {
    const key = occKey(rec.id, month);
    const tx = paid.get(key);
    if (rec.deletedAt && !tx) continue;
    const due = dueDateIn(rec, month);
    if (!due && !tx) continue;
    const dueDate = due ?? dayInMonth(month, rec.day);
    const base = baseAmountFor(rec, month);
    const ov = rec.overrides[month];
    if (tx) {
      out.push({ key, rec, month, dueDate, amount: tx.amount, baseAmount: base, overridden: tx.amount !== base, status: 'paid', tx });
      continue;
    }
    if (isPausedOn(rec, dueDate)) continue;
    const amount = ov?.amount ?? base;
    out.push({ key, rec, month, dueDate, amount, baseAmount: base, overridden: ov?.amount !== undefined, status: ov?.skipped ? 'skipped' : 'planned' });
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.rec.name.localeCompare(b.rec.name));
}

/** Prochaine échéance (à partir de "from") d'une charge, pour l'affichage. */
export function nextDueDate(rec: Recurring, from: ISODate): ISODate | null {
  let m = monthOf(from);
  for (let i = 0; i < 26; i++) {
    const d = dueDateIn(rec, m);
    if (d && d >= from && !isPausedOn(rec, d)) return d;
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  return null;
}

export const FREQ_LABEL: Record<number, string> = {
  1: 'Chaque mois',
  2: 'Tous les 2 mois',
  3: 'Chaque trimestre',
  6: 'Chaque semestre',
  12: 'Chaque année',
};
