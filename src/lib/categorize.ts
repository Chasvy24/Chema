// Proposition de catégorie à partir du libellé : correspondances apprises en priorité,
// puis mots-clés courants (Suisse et Maroc). Tout reste modifiable par l'utilisatrice.

import type { Category } from '../db/schema';

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOISE = new Set([
  'achat', 'paiement', 'payment', 'carte', 'debit', 'credit', 'ordre', 'virement', 'prelevement', 'lsv', 'twint', 'maestro', 'visa', 'mastercard',
  'card', 'sa', 'ag', 'sarl', 'gmbh', 'ch', 'ma', 'chf', 'mad', 'de', 'du', 'la', 'le', 'les', 'des', 'et', 'en', 'au', 'aux', 'pos', 'tpe', 'cb',
  'debitmastercard', 'achatcarte', 'masque', 'numero',
]);

/** Clé d'apprentissage : les deux premiers mots significatifs du libellé. */
export function labelKey(label: string): string {
  const words = normalize(label)
    .split(' ')
    .filter((w) => w.length > 1 && !NOISE.has(w) && !/^\d+$/.test(w) && !/\d{3,}/.test(w));
  return words.slice(0, 2).join(' ');
}

const RULES: Array<[string, RegExp]> = [
  ['alimentation', /\b(migros|coop|denner|lidl|aldi|manor food|volg|spar|carrefour|marjane|bim|aswak|acima|label vie|boulangerie|epicerie|supermarche|marche|primeur|boucherie|manor|globus|alnatura|mcdonald|burger|starbucks|cafe|restaurant|resto|pizzeria|traiteur|glovo|uber eats|smood|eat ch|kebab|sushi)\b/],
  ['transport', /\b(sbb|cff|ffs|tpg|tl|tpf|bls|mobilis|unireso|uber|careem|heetch|indrive|taxi|petit taxi|oncf|al boraq|ctm|supratours|tramway|tram|parking|essence|carburant|shell|bp|avia|tamoil|agip|total|afriquia|winxo|ziz|peage|autoroute|adm|mobility|publibike|velo)\b/],
  ['sante', /\b(pharmacie|pharmacy|apotheke|amavita|sun store|sunstore|coop vitality|medecin|docteur|dr|dentiste|clinique|hopital|hug|chuv|laboratoire|labo|opticien|physio|cabinet medical|analyse)\b/],
  ['assurances', /\b(assurance|assurances|versicherung|axa|mobiliere|helvetia|zurich|allianz|generali|baloise|vaudoise|smile|helsana|css|groupe mutuel|swica|sanitas|visana|assura|concordia|kpt|atupri|sympany|wafa assurance|saham|rma|atlantasanad|sanlam|cnops|cnss|amo|mamda|mcma)\b/],
  ['abonnements', /\b(swisscom|salt|sunrise|wingo|yallo|m budget|upc|netflix|spotify|disney|apple com|itunes|icloud|google|youtube|amazon prime|prime video|deezer|canal|maroc telecom|iam|inwi|orange|serafe|billag|abonnement|fitness|basic fit|update fitness|let s go|chatgpt|openai|adobe|microsoft)\b/],
  ['logement', /\b(loyer|miete|regie|gerance|immobilier|charges locatives|syndic|sig|romande energie|groupe e|ewz|bkw|services industriels|electricite|gaz|eau|redal|lydec|amendis|radeema|onee|ikea|conforama|jumbo|hornbach|do it|landi|menage)\b/],
  ['loisirs', /\b(cinema|pathe|cineman|theatre|concert|ticketcorner|fnac|musee|zoo|piscine|ski|livre|librairie|payot|decathlon|ochsner|sport|steam|playstation|nintendo|bar|club)\b/],
  ['voyages', /\b(hotel|airbnb|booking|expedia|easyjet|swiss intl|swiss international|royal air maroc|ram|air arabia|ryanair|transavia|lufthansa|edelweiss|vueling|airport|aeroport|geneva airport|location voiture|hertz|europcar|sixt|avis budget|riad)\b/],
  ['administratif', /\b(impot|impots|afc|aft|steuer|dgi|tresorerie|commune|canton|etat de|office cantonal|ocpm|spop|amende|taxe|emolument|frais administratifs|notaire|registre du commerce|poste|la poste|postfinance frais|frais bancaires|frais de tenue|cotisation)\b/],
];

const NAME_HINTS: Record<string, string[]> = {
  alimentation: ['alimentation', 'courses', 'nourriture'],
  transport: ['transport', 'transports'],
  sante: ['sante'],
  assurances: ['assurance', 'assurances'],
  abonnements: ['abonnement', 'abonnements'],
  logement: ['logement', 'maison'],
  loisirs: ['loisir', 'loisirs'],
  voyages: ['voyage', 'voyages'],
  administratif: ['administratif', 'administration'],
};

export function suggestCategory(label: string, categories: Category[], learned: Record<string, string>): string | null {
  const active = categories.filter((c) => c.kind === 'expense' && !c.deletedAt);
  const key = labelKey(label);
  if (key && learned[key] && active.some((c) => c.id === learned[key])) return learned[key];
  const norm = ` ${normalize(label)} `;
  for (const [slug, re] of RULES) {
    if (re.test(norm)) {
      const hints = NAME_HINTS[slug] ?? [slug];
      const found = active.find((c) => c.id === slug) ?? active.find((c) => hints.includes(normalize(c.name)));
      if (found) return found.id;
    }
  }
  return null;
}

/** Similarité de libellés (0..1) par recouvrement de mots. */
export function labelSimilarity(a: string, b: string): number {
  const wa = new Set(normalize(a).split(' ').filter((w) => w.length > 2 && !NOISE.has(w)));
  const wb = new Set(normalize(b).split(' ').filter((w) => w.length > 2 && !NOISE.has(w)));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / Math.min(wa.size, wb.size);
}
