import type { Goal, Move } from '../db/schema';
import { monthDiff, monthOf, today, type ISODate } from './dates';

export function goalCurrent(goal: Goal, moves: Move[]): number {
  let s = 0;
  for (const m of moves) if (m.goalId === goal.id) s += m.amount;
  return s;
}

export function goalProgress(goal: Goal, moves: Move[]) {
  const current = goalCurrent(goal, moves);
  const pct = goal.target > 0 ? Math.max(0, Math.min(1, current / goal.target)) : 0;
  const reached = goal.target > 0 && current >= goal.target;
  return { current, pct, reached, remaining: Math.max(0, goal.target - current) };
}

/**
 * Montant mensuel approximatif pour atteindre l'objectif à la date cible.
 * Nombre de mois restants comptés à partir du mois en cours (inclus) jusqu'au mois de la date cible (inclus).
 */
export function monthlyNeeded(goal: Goal, current: number, ref: ISODate = today()): { months: number; perMonth: number; late: boolean } | null {
  if (!goal.targetDate) return null;
  const remaining = Math.max(0, goal.target - current);
  if (goal.targetDate < ref) return { months: 0, perMonth: remaining, late: remaining > 0 };
  const months = Math.max(1, monthDiff(monthOf(ref), monthOf(goal.targetDate)) + 1);
  return { months, perMonth: Math.ceil(remaining / months), late: false };
}
