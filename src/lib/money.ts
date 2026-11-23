// Montants stockés en centimes (entiers) pour éviter les erreurs d'arrondi.
// CHF et MAD ne sont jamais additionnés ni convertis.

export type Currency = 'CHF' | 'MAD';
export const CURRENCIES: Currency[] = ['CHF', 'MAD'];

const NNBSP = ' '; // espace fine insécable

/** 123456 → "1 234.56" */
export function fmtNumber(cents: number, opts: { decimals?: boolean } = {}): string {
  const neg = cents < 0;
  const showDec = opts.decimals !== false;
  const abs = showDec ? Math.abs(Math.round(cents)) : Math.round(Math.abs(cents) / 100) * 100; // arrondi (pas de troncature)
  const units = Math.floor(abs / 100);
  const dec = abs % 100;
  const intStr = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  const out = showDec ? `${intStr}.${String(dec).padStart(2, '0')}` : intStr;
  return (neg ? '−' : '') + out;
}

/** 123456, 'CHF' → "1 234.56 CHF" */
export function fmtMoney(cents: number, cur: Currency, opts: { decimals?: boolean; sign?: boolean } = {}): string {
  const s = fmtNumber(cents, opts);
  const sign = opts.sign && cents > 0 ? '+' : '';
  return `${sign}${s} ${cur}`;
}

/**
 * Analyse un montant saisi ou importé : "12.50", "12,5", "1'234.50", "1 234,50", "1.234,50",
 * "-12.50", "12.50-", "(12.50)", "CHF 12.50". Renvoie des centimes, ou null si illisible.
 */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  let s = String(input).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[A-Za-z    '’`]/g, '').replace(/[^\d.,+\-−]/g, '');
  if (/[-−]$/.test(s)) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  if (/^[-−]/.test(s)) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!s || /[-−+]/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const sepIdx = Math.max(lastDot, lastComma);
  let intPart = s;
  let decPart = '';
  if (sepIdx >= 0) {
    const after = s.slice(sepIdx + 1);
    const sepChar = s[sepIdx];
    const otherChar = sepChar === '.' ? ',' : '.';
    const sepCount = s.split(sepChar).length - 1;
    const hasOther = s.includes(otherChar);
    // Séparateur décimal si 1 ou 2 chiffres après, ou si l'autre séparateur est présent avant,
    // ou s'il n'apparaît qu'une fois avec un nombre de chiffres ≠ 3.
    const isDecimal = after.length <= 2 || (hasOther && s.indexOf(otherChar) < sepIdx) || (sepCount === 1 && after.length !== 3);
    if (isDecimal && sepCount === 1) {
      intPart = s.slice(0, sepIdx);
      decPart = after;
    } else if (isDecimal && sepCount > 1) {
      return null;
    }
    intPart = intPart.replace(/[.,]/g, '');
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(decPart) || (intPart === '' && decPart === '')) return null;
  if (decPart.length > 2) return null;
  const cents = Number(intPart || '0') * 100 + Number((decPart + '00').slice(0, 2));
  if (!Number.isFinite(cents)) return null;
  return neg ? -cents : cents;
}

/** Valeur à afficher dans un champ de saisie (sans séparateur de milliers). */
export function centsToInput(cents: number | undefined | null): string {
  if (cents === undefined || cents === null) return '';
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}${abs % 100 ? '.' + String(abs % 100).padStart(2, '0') : ''}`;
  return cents < 0 ? '-' + s : s;
}
