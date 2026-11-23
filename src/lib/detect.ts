// Détection des charges fixes à partir des opérations déjà enregistrées (relevés importés ou saisies).
// Tout est calculé sur le téléphone. Rien n'est créé sans validation de l'utilisatrice.

import type { Frequency, Recurring, Tx } from '../db/schema';
import type { Currency } from './money';
import { labelSimilarity, normalize } from './categorize';
import { addMonthKey, monthDiff, monthOf, today, type ISODate, type MonthKey } from './dates';

// Mots sans valeur pour reconnaître le bénéficiaire (préfixes bancaires, formes juridiques…)
const NOISE = new Set([
  'lsv', 'ordre', 'permanent', 'debit', 'direct', 'prlv', 'prelevement', 'sepa', 'ebanking', 'banking', 'paiement', 'payment', 'achat', 'carte',
  'card', 'twint', 'maestro', 'visa', 'mastercard', 'debitmastercard', 'virement', 'vir', 'transfer', 'facture', 'rechnung', 'bill', 'ref',
  'reference', 'no', 'nr', 'numero', 'date', 'sa', 'ag', 'gmbh', 'sarl', 'ltd', 'inc', 'cie', 'co', 'ch', 'ma', 'chf', 'mad', 'de', 'du', 'la',
  'le', 'les', 'des', 'et', 'en', 'au', 'aux', 'pour', 'the', 'pos', 'tpe', 'cb', 'avis', 'online', 'www', 'com', 'masque', 'zahlung',
  'belastung', 'dauerauftrag', 'lastschrift', 'einkauf', 'kartenzahlung', 'mensuel', 'mensuelle', 'monatlich', 'prime', 'praemie', 'pramie',
  'cotisation', 'abonnement', 'abo', 'mois', 'month', 'ebill', 'qr', 'iban', 'compte', 'konto', 'beneficiaire', 'order', 'standing',
]);

// Retraits d'espèces : réguliers parfois, mais ce ne sont pas des charges fixes.
const EXCLUDE = /\b(retrait|gab|atm|bancomat|geldautomat|cash|withdrawal)\b/;

/** Clé du bénéficiaire : deux premiers mots significatifs, sans chiffres. */
export function merchantKey(label: string): string {
  const words = normalize(label.replace(/\([^)]*\)/g, ' '))
    .split(' ')
    .filter((w) => w.length > 1 && !NOISE.has(w) && !/\d/.test(w));
  return words.slice(0, 2).join(' ');
}

const LEGAL = /^(sa|ag|gmbh|sarl|ltd|inc|cie|co)$/i;
const PREFIXES = /^(lsv\+?|ordre permanent|d[ée]bit direct|prlv( sepa)?|pr[ée]l[èe]vement|e-?banking|paiement( carte)?|achat( carte)?|twint|virement( [àa])?|dauerauftrag|lastschrift|kartenzahlung)\s*[:\-–]?\s*/i;

/** Nom lisible tiré du libellé bancaire : « LSV+ SWISSCOM (SCHWEIZ) AG 3050 BERN » → « Swisscom Bern ». */
export function prettyName(labels: string[]): string {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  let label = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? '';
  label = label.replace(/\([^)]*\)/g, ' ').replace(/\[numéro masqué\]/g, ' ');
  for (let i = 0; i < 3; i++) label = label.replace(PREFIXES, '');
  const words = label
    .split(/[\s,;/·]+/)
    .filter((w) => w && !/\d/.test(w) && !LEGAL.test(w) && !/^(ref|no|nr|n°)$/i.test(w))
    .slice(0, 3);
  const allCaps = words.join('') === words.join('').toUpperCase();
  const out = words.map((w) => (allCaps ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(' ').trim();
  return out || labels[0]?.slice(0, 30) || 'Charge fixe';
}

export interface Match {
  txId: string;
  month: MonthKey; // période de la charge (peut différer du mois de la date : loyer payé le 30 pour le 1er)
  date: ISODate;
  amount: number;
}

export interface Candidate {
  key: string;
  name: string;
  currency: Currency;
  frequency: Frequency;
  day: number;
  amount: number; // montant de base proposé
  variable: boolean;
  min: number;
  max: number;
  categoryId: string | null;
  matches: Match[];
  firstMonth: MonthKey;
  lastMonth: MonthKey;
  missing: MonthKey[];
  confidence: 'high' | 'medium';
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const dayOf = (d: ISODate) => Number(d.slice(8, 10));
const spread = (a: number[]) => Math.max(...a) - Math.min(...a);

/** Jour habituel, en tenant compte des paiements autour du changement de mois (30, 31, 1, 2…). */
export function typicalDay(days: number[]): { day: number; spread: number } {
  const shifted = days.map((d) => (d <= 12 ? d + 31 : d));
  const useShift = spread(shifted) < spread(days);
  const arr = useShift ? shifted : days;
  let day = median(arr);
  if (day > 31) day -= 31;
  return { day: Math.min(31, Math.max(1, day)), spread: spread(arr) };
}

/** Mois de la charge auquel rattacher un paiement (le loyer du 1er payé le 30 compte pour le mois suivant). */
export function periodMonth(date: ISODate, typical: number): MonthKey {
  const d = dayOf(date);
  const m = monthOf(date);
  if (typical <= 7 && d >= 24) return addMonthKey(m, 1);
  if (typical >= 24 && d <= 7) return addMonthKey(m, -1);
  return m;
}

const FREQS: Frequency[] = [1, 2, 3, 6, 12];

export function detectRecurring(txs: Tx[], recurring: Recurring[], currency: Currency, ref: ISODate = today()): Candidate[] {
  const all = txs.filter((t) => !t.deletedAt && t.currency === currency);
  const pool = all.filter((t) => t.kind === 'expense' && !t.occurrence);
  if (!pool.length) return [];
  const dataLast = all.reduce((m, t) => (t.date > m ? t.date : m), '0000-00-00');
  const dataLastMonth = monthOf(dataLast < ref ? dataLast : ref);
  const known = recurring.filter((r) => !r.deletedAt && r.currency === currency);

  const groups = new Map<string, Tx[]>();
  for (const t of pool) {
    const k = merchantKey(t.label);
    if (!k || EXCLUDE.test(` ${normalize(t.label)} `)) continue;
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }

  const out: Candidate[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const td = typicalDay(list.map((t) => dayOf(t.date)));
    if (td.spread > 7) continue; // jour trop irrégulier

    // Une seule opération par période (la plus proche du jour habituel)
    const byMonth = new Map<MonthKey, Tx[]>();
    for (const t of list) {
      const pm = periodMonth(t.date, td.day);
      const g = byMonth.get(pm);
      if (g) g.push(t);
      else byMonth.set(pm, [t]);
    }
    const months = [...byMonth.keys()].sort();
    if (months.length < 2) continue;
    const crowded = months.filter((m) => byMonth.get(m)!.length > 1).length;
    if (crowded > months.length * 0.25) continue; // achats fréquents (courses…), pas une charge fixe
    const matches: Match[] = months.map((m) => {
      const t = byMonth.get(m)!.sort((a, b) => Math.abs(dayOf(a.date) - td.day) - Math.abs(dayOf(b.date) - td.day))[0];
      return { txId: t.id, month: m, date: t.date, amount: t.amount };
    });

    // Fréquence : écart le plus courant entre deux paiements
    const diffs = months.slice(1).map((m, i) => monthDiff(months[i], m));
    const freqCount = new Map<number, number>();
    for (const d of diffs) freqCount.set(d, (freqCount.get(d) ?? 0) + 1);
    const f = [...freqCount.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0] as Frequency;
    if (!FREQS.includes(f)) continue;
    if (!diffs.every((d) => d % f === 0 && d <= 2 * f)) continue;

    // Toujours actif ?
    const lastMonth = months[months.length - 1];
    if (monthDiff(lastMonth, dataLastMonth) > f) continue;

    // Montant stable ou proche
    const amounts = matches.map((m) => m.amount);
    const med = median(amounts);
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    const fixed = max - min <= Math.max(med * 0.02, 100);
    if (!fixed && (max - min) / med > 0.6) continue;
    const latest = matches[matches.length - 1].amount;
    const amount = fixed ? latest : Math.round(amounts.reduce((s, a) => s + a, 0) / amounts.length);

    const missing: MonthKey[] = [];
    for (let m = months[0]; m <= lastMonth; m = addMonthKey(m, f)) if (!byMonth.has(m)) missing.push(m);

    const cats = new Map<string, number>();
    for (const t of list) if (t.categoryId) cats.set(t.categoryId, (cats.get(t.categoryId) ?? 0) + 1);
    const categoryId = [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const name = prettyName(list.map((t) => t.label));

    // Déjà enregistrée comme charge fixe ?
    if (known.some((r) => merchantKey(r.name) === key || labelSimilarity(r.name, name) >= 0.5)) continue;

    const confidence: Candidate['confidence'] = matches.length >= 3 && td.spread <= 5 ? 'high' : 'medium';
    out.push({ key, name, currency, frequency: f, day: td.day, amount, variable: !fixed, min, max, categoryId, matches, firstMonth: months[0], lastMonth, missing, confidence });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/** Étendue des opérations disponibles pour une monnaie (pour expliquer ce qui a été analysé). */
export function coverage(txs: Tx[], currency: Currency): { from: ISODate; to: ISODate; months: number; count: number } | null {
  const l = txs.filter((t) => !t.deletedAt && t.currency === currency && t.kind === 'expense');
  if (!l.length) return null;
  let from = l[0].date;
  let to = l[0].date;
  for (const t of l) {
    if (t.date < from) from = t.date;
    if (t.date > to) to = t.date;
  }
  return { from, to, months: monthDiff(monthOf(from), monthOf(to)) + 1, count: l.length };
}
