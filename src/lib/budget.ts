// Calculs du budget mensuel, toujours par monnaie (jamais de total CHF + MAD).
//
// Restant = budget mensuel − dépenses confirmées (nettes des remboursements) − charges fixes prévues non payées.
// Une charge payée devient une opération confirmée et n'est plus comptée dans les charges prévues.
// Ce n'est pas le solde d'un compte bancaire.

import type { BudgetEntry, Goal, Move, Recurring, Settings, Tx } from '../db/schema';
import type { Currency } from './money';
import { monthOf, type MonthKey } from './dates';
import { occurrencesForMonth, paidIndex, type Occurrence } from './recurring';

export const txMonth = (t: Tx): MonthKey => t.month ?? monthOf(t.date);

export function budgetEntryFor(settings: Settings, cur: Currency, month: MonthKey): BudgetEntry | null {
  const list = [...(settings.budgets[cur] ?? [])].sort((a, b) => a.from.localeCompare(b.from));
  if (!list.length) return null;
  let e = list[0];
  for (const x of list) if (x.from <= month) e = x;
  return e;
}

export interface CategoryStat {
  categoryId: string | null;
  spent: number; // net des remboursements
  planned: number;
  cap?: number;
}

export interface MonthStats {
  currency: Currency;
  month: MonthKey;
  budget: number | null;
  spentGross: number;
  refunds: number;
  confirmed: number; // spentGross - refunds
  planned: number;
  remaining: number | null;
  used: number; // confirmed + planned
  ratio: number | null;
  level: 'ok' | 'warn' | 'over' | 'none';
  income: number;
  savingsIn: number;
  savingsOut: number;
  occurrences: Occurrence[];
  byCategory: CategoryStat[];
  txCount: number;
}

export function levelFor(ratio: number | null): MonthStats['level'] {
  if (ratio === null) return 'none';
  if (ratio > 1) return 'over';
  if (ratio >= 0.8) return 'warn';
  return 'ok';
}

export function monthStats(
  args: { settings: Settings; txs: Tx[]; recurring: Recurring[]; goals: Goal[]; moves: Move[] },
  cur: Currency,
  month: MonthKey,
  paid?: Map<string, Tx>,
): MonthStats {
  const { settings, txs, recurring, goals, moves } = args;
  let spentGross = 0;
  let refunds = 0;
  let income = 0;
  let txCount = 0;
  const cats = new Map<string | null, CategoryStat>();
  const cat = (id: string | null) => {
    let c = cats.get(id);
    if (!c) cats.set(id, (c = { categoryId: id, spent: 0, planned: 0 }));
    return c;
  };
  for (const t of txs) {
    if (t.deletedAt || t.currency !== cur || txMonth(t) !== month) continue;
    txCount++;
    if (t.kind === 'expense') {
      spentGross += t.amount;
      cat(t.categoryId).spent += t.amount;
    } else if (t.kind === 'refund') {
      refunds += t.amount;
      cat(t.categoryId).spent -= t.amount;
    } else {
      income += t.amount;
    }
  }
  const occ = occurrencesForMonth(recurring.filter((r) => r.currency === cur), paid ?? paidIndex(txs), month);
  let planned = 0;
  for (const o of occ) {
    if (o.status === 'planned') {
      planned += o.amount;
      cat(o.rec.categoryId).planned += o.amount;
    }
  }
  const entry = budgetEntryFor(settings, cur, month);
  const budget = entry && entry.amount > 0 ? entry.amount : null;
  if (entry) for (const [id, cap] of Object.entries(entry.caps)) if (cap > 0) cat(id).cap = cap;
  const confirmed = spentGross - refunds;
  const used = confirmed + planned;
  const remaining = budget === null ? null : budget - used;
  const ratio = budget === null ? null : used / budget;

  const goalIds = new Set(goals.filter((g) => g.currency === cur && !g.deletedAt).map((g) => g.id));
  let savingsIn = 0;
  let savingsOut = 0;
  for (const m of moves) {
    if (!goalIds.has(m.goalId) || monthOf(m.date) !== month) continue;
    if (m.amount >= 0) savingsIn += m.amount;
    else savingsOut += -m.amount;
  }

  return {
    currency: cur,
    month,
    budget,
    spentGross,
    refunds,
    confirmed,
    planned,
    remaining,
    used,
    ratio,
    level: levelFor(ratio),
    income,
    savingsIn,
    savingsOut,
    occurrences: occ,
    byCategory: [...cats.values()],
    txCount,
  };
}
