import type { ContractInfo, Deadline, DeadlineFreq, DeadlineType } from '../db/schema';
import { addDays, addMonths, atTime, diffDays, fmtDate, today, type ISODate } from './dates';

export const TYPE_LABEL: Record<DeadlineType, string> = {
  bill: 'Facture à payer',
  contract: 'Renouvellement ou résiliation',
  admin: 'Impôts et démarches',
  expiry: 'Fin de validité',
};

export const TYPE_SHORT: Record<DeadlineType, string> = {
  bill: 'Facture',
  contract: 'Contrat',
  admin: 'Démarche',
  expiry: 'Validité',
};

export const FREQ_LABEL: Record<DeadlineFreq, string> = {
  none: 'Ponctuelle',
  monthly: 'Chaque mois',
  quarterly: 'Chaque trimestre',
  semiannual: 'Chaque semestre',
  yearly: 'Chaque année',
};

/** Fréquences proposées selon le type (cf. cahier des charges) */
export const FREQS_BY_TYPE: Record<DeadlineType, DeadlineFreq[]> = {
  bill: ['none', 'monthly', 'quarterly', 'semiannual', 'yearly'],
  contract: ['none', 'yearly'],
  admin: ['none', 'yearly'],
  expiry: ['none'],
};

const FREQ_MONTHS: Record<DeadlineFreq, number> = { none: 0, monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };

export function isOverdue(d: Deadline, ref: ISODate = today()): boolean {
  return d.status !== 'done' && d.date < ref;
}

export type DisplayStatus = 'todo' | 'doing' | 'done' | 'late';

export function displayStatus(d: Deadline, ref: ISODate = today()): DisplayStatus {
  if (d.status === 'done') return 'done';
  if (d.date < ref) return 'late';
  return d.status;
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  todo: 'À faire',
  doing: 'En cours',
  done: 'Terminée',
  late: 'En retard',
};

/** Tri : en retard d'abord, puis par date croissante. */
export function sortDeadlines(list: Deadline[], ref: ISODate = today()): Deadline[] {
  return [...list].sort((a, b) => {
    const la = isOverdue(a, ref) ? 0 : 1;
    const lb = isOverdue(b, ref) ? 0 : 1;
    return la - lb || a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
  });
}

/**
 * Date limite de résiliation : la résiliation doit être reçue avant le début du délai de préavis.
 * Fin 31.12.2026, préavis 3 mois → délai du 01.10 au 31.12 → au plus tard le 30.09.2026.
 * Fin 30.06.2026, préavis 3 mois → au plus tard le 31.03.2026.
 * Préavis en jours : fin − N jours.
 */
export function noticeDeadline(endDate: ISODate, value: number, unit: 'months' | 'days'): ISODate {
  if (unit === 'days') return addDays(endDate, -Math.max(0, value));
  return addDays(addMonths(addDays(endDate, 1), -Math.max(0, value)), -1);
}

export function noticeExplanation(c: ContractInfo): string {
  const limit = noticeDeadline(c.endDate, c.noticeValue, c.noticeUnit);
  const unit = c.noticeUnit === 'months' ? (c.noticeValue > 1 ? 'mois' : 'mois') : c.noticeValue > 1 ? 'jours' : 'jour';
  return `Fin du contrat le ${fmtDate(c.endDate)} − préavis de ${c.noticeValue} ${unit} → résiliation à faire parvenir au plus tard le ${fmtDate(limit)}.`;
}

/** Date de la prochaine occurrence (récurrence) */
export function nextDate(d: Deadline): ISODate | null {
  const n = FREQ_MONTHS[d.frequency];
  if (!n) return null;
  const base = d.originalDate ?? d.date;
  return addMonths(base, n);
}

export function nextContract(c: ContractInfo, months: number): ContractInfo {
  return { ...c, endDate: addMonths(c.endDate, months) };
}

/** Moment du rappel : la veille à l'heure réglée. */
export function reminderAt(d: Deadline, time: string): number {
  return atTime(addDays(d.date, -1), time);
}

export const notifKey = (d: Deadline) => `${d.id}@${d.date}`;

/**
 * Rappels manqués : rappel dont l'heure est passée depuis la dernière visite,
 * pour une échéance non terminée, et non déjà signalé par une notification.
 */
export function missedReminders(list: Deadline[], time: string, lastVisitAt: number | undefined, now: number, notifLog: Record<string, number>): Deadline[] {
  if (!lastVisitAt) return [];
  return list.filter((d) => {
    if (d.deletedAt || d.status === 'done') return false;
    const r = reminderAt(d, time);
    return r > lastVisitAt && r <= now && !notifLog[notifKey(d)];
  });
}

export function daysLeft(d: Deadline, ref: ISODate = today()): number {
  return diffDays(ref, d.date);
}
