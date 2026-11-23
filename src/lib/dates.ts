// Dates "civiles" manipulées sous forme de chaînes ISO AAAA-MM-JJ (sans fuseau horaire)
// et affichées au format jj.mm.aaaa.

export type ISODate = string; // 'YYYY-MM-DD'
export type MonthKey = string; // 'YYYY-MM'

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(now: Date = new Date()): ISODate {
  return toISO(now);
}

export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0); // midi : évite les surprises d'heure d'été
}

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** Format jj.mm.aaaa */
export function fmtDate(s: ISODate | undefined | null): string {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
}

/** Format jj.mm (court) */
export function fmtDateShort(s: ISODate): string {
  const [, m, d] = s.split('-');
  return `${d}.${m}`;
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Ajoute des mois en ramenant le jour au dernier jour du mois si nécessaire (31.01 + 1 mois = 28/29.02). */
export function addMonths(s: ISODate, n: number): ISODate {
  const [y, m, d] = s.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

export function addYears(s: ISODate, n: number): ISODate {
  return addMonths(s, n * 12);
}

/** Nombre de jours de a vers b (b - a). */
export function diffDays(a: ISODate, b: ISODate): number {
  const ms = parseISO(b).getTime() - parseISO(a).getTime();
  return Math.round(ms / 86400000);
}

export function monthOf(s: ISODate): MonthKey {
  return s.slice(0, 7);
}

export function currentMonth(now: Date = new Date()): MonthKey {
  return monthOf(today(now));
}

export function addMonthKey(m: MonthKey, n: number): MonthKey {
  return monthOf(addMonths(`${m}-01`, n));
}

export function monthDiff(a: MonthKey, b: MonthKey): number {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

export function firstDay(m: MonthKey): ISODate {
  return `${m}-01`;
}

export function lastDay(m: MonthKey): ISODate {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${pad(daysInMonth(y, mo))}`;
}

/** Date du mois m au jour "day", ramenée au dernier jour du mois si besoin. */
export function dayInMonth(m: MonthKey, day: number): ISODate {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${pad(Math.min(Math.max(1, day), daysInMonth(y, mo)))}`;
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export function monthLabel(m: MonthKey, capital = true): string {
  const [y, mo] = m.split('-').map(Number);
  const s = `${MONTHS[mo - 1]} ${y}`;
  return capital ? s[0].toUpperCase() + s.slice(1) : s;
}

export function monthName(m: MonthKey): string {
  const mo = Number(m.split('-')[1]);
  return MONTHS[mo - 1];
}

export function monthShort(m: MonthKey): string {
  const [y, mo] = m.split('-').map(Number);
  return `${MONTHS_SHORT[mo - 1]} ${y}`;
}

export function weekdayLabel(s: ISODate): string {
  return WEEKDAYS[parseISO(s).getDay()];
}

/** "Aujourd'hui", "Demain", "Dans 5 j", "En retard de 2 j" */
export function relativeDays(s: ISODate, ref: ISODate = today()): { text: string; days: number } {
  const n = diffDays(ref, s);
  if (n === 0) return { text: "Aujourd'hui", days: n };
  if (n === 1) return { text: 'Demain', days: n };
  if (n === -1) return { text: 'Hier', days: n };
  if (n > 1) return { text: `Dans ${n} j`, days: n };
  return { text: `Retard ${-n} j`, days: n };
}

/** Analyse une date saisie : jj.mm.aaaa, jj/mm/aa, aaaa-mm-jj… (jour avant mois par défaut). */
export function parseUserDate(input: string, order: 'dmy' | 'mdy' | 'ymd' | 'auto' = 'auto'): ISODate | null {
  const s = input.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (m && (order === 'auto' || order === 'ymd')) return build(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})(?:[ T].*)?$/);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += y >= 70 ? 1900 : 2000;
    const a = +m[1];
    const b = +m[2];
    if (order === 'mdy') return build(y, a, b);
    return build(y, b, a);
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return build(+m[1], +m[2], +m[3]);
  return null;
}

function build(y: number, mo: number, d: number): ISODate | null {
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || y < 1900 || y > 2200) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

export function nowISOTime(): string {
  return new Date().toISOString();
}

/** Date/heure locale combinée (ISODate + 'HH:MM') → timestamp ms */
export function atTime(s: ISODate, hhmm: string): number {
  const [y, m, d] = s.split('-').map(Number);
  const [h, mi] = (hhmm || '18:00').split(':').map(Number);
  return new Date(y, m - 1, d, h || 0, mi || 0, 0, 0).getTime();
}
