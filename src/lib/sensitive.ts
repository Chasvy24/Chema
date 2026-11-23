// Détection (imparfaite) de numéros sensibles : IBAN / numéro de compte, carte bancaire,
// numéro AVS, numéro de passeport ou de pièce d'identité.
// Cette détection est une aide : elle ne peut pas garantir de tout repérer.

export type SensitiveKind = 'iban' | 'card' | 'avs' | 'account' | 'id';

export interface SensitiveHit {
  kind: SensitiveKind;
  match: string;
  index: number;
}

export const SENSITIVE_LABEL: Record<SensitiveKind, string> = {
  iban: 'IBAN / numéro de compte',
  card: 'numéro de carte bancaire',
  avs: 'numéro AVS',
  account: 'numéro de compte (RIB)',
  id: 'numéro de passeport ou de pièce d’identité',
};

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function detectSensitive(text: string): SensitiveHit[] {
  if (!text) return [];
  const hits: SensitiveHit[] = [];
  const taken: Array<[number, number]> = [];
  const add = (kind: SensitiveKind, match: string, index: number) => {
    const end = index + match.length;
    if (taken.some(([a, b]) => index < b && end > a)) return;
    taken.push([index, end]);
    hits.push({ kind, match, index });
  };

  // AVS suisse : 756.1234.5678.97 (avec ou sans points)
  for (const m of text.matchAll(/\b756[.\s-]?\d{4}[.\s-]?\d{4}[.\s-]?\d{2}\b/g)) add('avs', m[0], m.index!);

  // IBAN : 2 lettres pays + 2 chiffres + 11 à 30 caractères alphanumériques (espaces tolérés)
  for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g)) {
    const compact = m[0].replace(/\s/g, '');
    if (compact.length >= 15 && /\d{8,}/.test(compact.replace(/[A-Z]/g, ''))) add('iban', m[0], m.index!);
  }

  // Carte bancaire : 13 à 19 chiffres (espaces ou tirets) validés par Luhn,
  // ou format partiellement masqué fourni par la banque (XXXX XXXX XXXX 1234 → laissé tel quel).
  for (const m of text.matchAll(/\b(?:\d[ -]?){12,18}\d\b/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) add('card', m[0], m.index!);
  }

  // RIB marocain : 24 chiffres ; autres numéros de compte longs (≥ 10 chiffres d'affilée)
  for (const m of text.matchAll(/\b(?:\d[ ]?){9,}\d\b/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 10) add('account', m[0], m.index!);
  }

  // Passeport / pièce d'identité : 1 ou 2 lettres suivies de 6 à 8 chiffres (ex. X1234567, AB1234567)
  // ou contexte explicite ("passeport n° …", "numéro AVS …").
  for (const m of text.matchAll(/\b[A-Z]{1,2}\d{6,8}\b/g)) add('id', m[0], m.index!);
  for (const m of text.matchAll(/(?:passeport|passport|carte d['’]identit[ée]|CIN|permis|titre de s[ée]jour|n[°o]\.?\s*(?:de\s+)?(?:document|pi[eè]ce))\s*(?:n[°o]\.?|num[ée]ro|:)?\s*([A-Z0-9]{6,12})\b/gi)) {
    const val = m[1];
    if (/\d/.test(val)) add('id', val, m.index! + m[0].lastIndexOf(val));
  }

  return hits.sort((a, b) => a.index - b.index);
}

/** Remplace les numéros détectés par « [numéro masqué] ». */
export function maskSensitive(text: string): { text: string; count: number } {
  const hits = detectSensitive(text);
  if (!hits.length) return { text, count: 0 };
  let out = '';
  let pos = 0;
  for (const h of hits) {
    out += text.slice(pos, h.index) + '[numéro masqué]';
    pos = h.index + h.match.length;
  }
  out += text.slice(pos);
  return { text: out, count: hits.length };
}

export function describeHits(hits: SensitiveHit[]): string {
  const kinds = Array.from(new Set(hits.map((h) => SENSITIVE_LABEL[h.kind])));
  return kinds.join(', ');
}
