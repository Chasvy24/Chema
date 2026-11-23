// Parcours de bout en bout sur un téléphone simulé (Chromium, 390×844).
// Prérequis : « npm run build » puis serveur de prévisualisation (lancé automatiquement ici).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = new URL('../../', import.meta.url).pathname;
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const PORT = 4179;
const URL_ = `http://localhost:${PORT}/`;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' });
await new Promise((res) => {
  server.stdout.on('data', (d) => String(d).includes('localhost') && res());
  setTimeout(res, 6000);
});

const errors = [];
const results = [];
const ok = (name) => {
  results.push(['OK', name]);
  console.log('✓', name);
};
const fail = (name, e) => {
  results.push(['ÉCHEC', name, String(e?.message ?? e)]);
  console.log('✗', name, '—', e?.message ?? e);
};
async function step(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(name, e);
    await page.screenshot({ path: `${SHOTS}fail-${results.length}.png` }).catch(() => null);
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'fr-CH', timezoneId: 'Europe/Zurich', acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

const shot = (n) => page.screenshot({ path: `${SHOTS}${n}.png` });
/** Nouveau parcours d'import : bouton « Ajouter N opérations », confirmation, écran « C’est ajouté ». */
async function addAll(pg) {
  await pg.locator('main').getByRole('button', { name: /^Ajouter \d+ opération/ }).click();
  await pg.getByRole('alertdialog').getByRole('button', { name: /^Ajouter \d+ opération/ }).click();
  await pg.getByText('C’est ajouté').waitFor();
}
const reviewText = async (pg) => {
  await pg.getByText(/trouvées? *$|trouvée/).first().waitFor({ timeout: 30000 });
  return (await pg.locator('main').innerText()).replace(/[\u202f\u00a0]/g, ' ');
};
const sheet = () => page.locator('section.sheet').last();
const tapText = (t) => page.getByText(t, { exact: true }).first().click();
const toastText = async () => (await page.locator('.toast .msg').allTextContents()).join(' | ');
const closeToasts = async () => {
  for (let i = 0; i < 5 && (await page.locator('.toast .msg').count()); i++) await page.locator('.toast .msg').first().click().catch(() => null);
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = new Date();
const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
const in5 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5);
const ym = iso(now).slice(0, 7);

await page.goto(URL_);

await step('Écran de bienvenue puis accueil vide', async () => {
  await page.getByRole('dialog', { name: 'Bienvenue' }).waitFor();
  await shot('01-bienvenue');
  await sheet().getByRole('button', { name: 'Plus tard' }).click();
  await page.waitForTimeout(300);
  await shot('02-accueil-vide');
  expect(await page.getByText('Aucune échéance').count(), 'état vide échéances');
});

await step('Fixer les budgets CHF et MAD + plafond', async () => {
  await page.getByRole('button', { name: 'Réglages' }).click();
  await tapText('Budgets mensuels et plafonds');
  const amounts = page.locator('input.amount');
  await amounts.nth(0).fill('4000');
  await page.getByText('Plafonds par catégorie (facultatifs)').first().click();
  await page.getByLabel('Plafond Alimentation').first().fill('600');
  await page.getByRole('button', { name: 'Enregistrer le budget CHF' }).click();
  await amounts.nth(1).fill('6000');
  await page.getByRole('button', { name: 'Enregistrer le budget MAD' }).click();
  await page.waitForTimeout(200);
  expect((await toastText()).includes('Budget MAD enregistré'), 'toast budget');
  await closeToasts();
});

await step('Saisie rapide : dépense CHF en quelques touches', async () => {
  await page.goto(URL_ + '#/');
  await page.getByRole('button', { name: /^Ajouter \(dépense/ }).click();
  await sheet().getByRole('button', { name: /Dépense/ }).first().click();
  await page.waitForTimeout(400);
  await shot('03-saisie-rapide');
  await sheet().locator('input.amount').fill('12.50');
  await sheet().getByRole('button', { name: 'CHF · Suisse' }).click();
  await sheet().getByRole('button', { name: 'Alimentation', exact: true }).click();
  await sheet().getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.waitForTimeout(300);
  expect((await toastText()).includes('12.50'), 'toast dépense: ' + (await toastText()));
});

await step('Dépense MAD avec libellé', async () => {
  await page.getByRole('button', { name: /^Ajouter \(dépense/ }).click();
  await sheet().getByRole('button', { name: /Dépense/ }).first().click();
  await sheet().locator('input.amount').fill('250');
  await sheet().getByRole('button', { name: 'MAD · Maroc' }).click();
  await sheet().getByRole('button', { name: 'Transport', exact: true }).click();
  await sheet().getByText(/Plus de détails/).click();
  await sheet().getByPlaceholder('Ex. Migros, café, taxi…').fill('Petit taxi Casa');
  await sheet().getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.waitForTimeout(300);
  await closeToasts();
});

await step('Détection de numéro sensible dans un libellé', async () => {
  await page.getByRole('button', { name: /^Ajouter \(dépense/ }).click();
  await sheet().getByRole('button', { name: /Dépense/ }).first().click();
  await sheet().locator('input.amount').fill('5');
  await sheet().getByRole('button', { name: 'CHF · Suisse' }).click();
  await sheet().getByRole('button', { name: 'Divers', exact: true }).click();
  await sheet().getByText(/Plus de détails/).click();
  await sheet().getByPlaceholder('Ex. Migros, café, taxi…').fill('Virement CH93 0076 2011 6238 5295 7');
  expect(await sheet().getByText(/semble contenir/).count(), 'avertissement sensible');
  await sheet().getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.waitForTimeout(300);
  const stored = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('chema'); q.onsuccess = () => { const g = q.result.transaction('txs').objectStore('txs').getAll(); g.onsuccess = () => r(g.result.map((t) => t.label)); }; }));
  expect(stored.some((l) => l.includes('[numéro masqué]')) && !stored.some((l) => l.includes('CH93')), 'libellé masqué en base: ' + stored.join(','));
  await closeToasts();
});

await step('Charges fixes : loyer et Wi-Fi', async () => {
  await page.goto(URL_ + '#/budget/charges');
  await page.getByRole('button', { name: 'Ajouter à la main' }).click();
  await sheet().getByPlaceholder(/Loyer/).fill('Loyer');
  await sheet().locator('input.amount').fill('1500');
  await sheet().getByRole('button', { name: 'CHF · Suisse' }).click();
  await sheet().getByRole('button', { name: 'Créer la charge fixe' }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Nouvelle charge fixe' }).click();
  await sheet().getByPlaceholder(/Loyer/).fill('Wi-Fi Swisscom');
  await sheet().locator('input.amount').fill('59.90');
  await sheet().getByRole('button', { name: 'CHF · Suisse' }).click();
  await sheet().locator('select').first().selectOption('abonnements');
  await sheet().locator('input[inputmode=numeric]').fill('28');
  await sheet().getByRole('button', { name: 'Créer la charge fixe' }).click();
  await page.waitForTimeout(250);
  await shot('04-charges-fixes');
  await closeToasts();
});

await step('Budget : charge prévue puis payée avec montant réel (pas de double comptage)', async () => {
  await page.goto(URL_ + '#/budget?cur=CHF');
  await page.waitForTimeout(200);
  const before = await page.locator('.card.blue').first().innerText();
  expect(before.includes('1') && before.includes('559.90'), 'prévu 1559.90 : ' + before);
  await page.getByRole('button', { name: /Wi-Fi Swisscom/ }).click();
  await sheet().locator('input.amount').fill('64.20');
  await sheet().getByText(/nouveau montant de base/).waitFor();
  await sheet().getByRole('button', { name: /Marquer comme payée/ }).click();
  await page.waitForTimeout(300);
  const after = await page.locator('.card.blue').first().innerText();
  // 4000 - 12.50 - 5 - 64.20 - 1500 = 2418.30
  expect(after.replace(/\s| /g, '').includes('2418'), 'restant attendu 2418.30 : ' + after);
  await shot('05-budget-chf');
  await closeToasts();
});

await step('Échéances : facture demain, contrat avec préavis, démarche', async () => {
  await page.getByRole('button', { name: /^Ajouter \(dépense/ }).click();
  await sheet().getByRole('button', { name: /Échéance/ }).click();
  await sheet().getByPlaceholder('Ex. Facture électricité').fill('Facture électricité SIG');
  await sheet().locator('input[type=date]').first().fill(iso(tomorrow));
  await sheet().locator('select').first().selectOption('monthly');
  await sheet().locator('input[inputmode=decimal]').fill('80');
  await sheet().getByRole('button', { name: 'Ajouter l’échéance' }).click();
  await page.waitForTimeout(300);
  expect(page.url().includes('#/echeances/'), 'redirigé vers le détail');
  await shot('06-echeance-detail');
  // Contrat
  await page.getByRole('button', { name: /^Ajouter \(dépense/ }).click();
  await sheet().getByRole('button', { name: /Échéance/ }).click();
  await sheet().getByRole('button', { name: 'Renouvellement ou résiliation' }).click();
  await sheet().getByPlaceholder('Ex. Assurance ménage').fill('Assurance ménage');
  await sheet().getByRole('switch').first().check({ force: true });
  await sheet().locator('input[type=date]').first().fill(`${now.getFullYear() + 1}-06-30`);
  await sheet().getByText(/au plus tard le 31\.03\./).waitFor();
  await shot('07-contrat-preavis');
  await sheet().getByRole('button', { name: 'Ajouter l’échéance' }).click();
  await page.waitForTimeout(300);
  // Démarche en retard (date passée)
  await page.getByRole('button', { name: /^Ajouter \(dépense/ }).click();
  await sheet().getByRole('button', { name: /Échéance/ }).click();
  await sheet().getByRole('button', { name: 'Impôts et démarches' }).click();
  await sheet().getByPlaceholder(/Déclaration/).fill('Clôture Sàrl : bilan final');
  const past = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3);
  await sheet().locator('input[type=date]').first().fill(iso(past));
  await sheet().getByRole('button', { name: 'Ajouter l’échéance' }).click();
  await page.waitForTimeout(300);
  await closeToasts();
  await page.goto(URL_ + '#/echeances');
  await page.waitForTimeout(200);
  const first = await page.locator('.list .item.late').first().innerText();
  expect(first.includes('Clôture'), 'retard en haut : ' + first);
  expect(await page.locator('.pill.yellow', { hasText: 'Demain' }).count(), 'demain surligné');
  await shot('08-echeances');
});

await step('Report d’une semaine puis facture payée → dépense + échéance suivante', async () => {
  await page.getByText('Facture électricité SIG').first().click();
  await page.getByRole('button', { name: /Reporter d’1 semaine/ }).click();
  await page.waitForTimeout(200);
  expect((await toastText()).includes('Reportée au'), 'toast report');
  await closeToasts();
  await page.getByRole('button', { name: /Payée \/ terminée/ }).click();
  await sheet().getByRole('button', { name: 'Terminer et créer la dépense' }).waitFor();
  await sheet().locator('input.amount').fill('83.40');
  await sheet().getByRole('button', { name: 'Terminer et créer la dépense' }).click();
  await page.waitForTimeout(300);
  const t = await toastText();
  expect(t.includes('nouvelle échéance créée') && t.includes('83.40'), 'toast : ' + t);
  await closeToasts();
});

await step('Accueil : cartes CHF/MAD, échéances, alerte retard', async () => {
  await page.goto(URL_ + '#/');
  await page.waitForTimeout(300);
  expect(await page.getByText(/échéance dépassée/).count(), 'bannière retard');
  await shot('09-accueil');
});

await step('Objectif d’épargne MAD + versement (hors budget)', async () => {
  await page.goto(URL_ + '#/epargne');
  await page.getByRole('button', { name: 'Créer un objectif' }).click();
  await sheet().getByRole('button', { name: 'Appartement au Maroc' }).click();
  await sheet().getByRole('button', { name: 'MAD · Maroc' }).click();
  await sheet().locator('input.amount').fill('300000');
  await sheet().locator('input[inputmode=decimal]').nth(1).fill('45000');
  await sheet().locator('input[type=date]').fill(`${now.getFullYear() + 2}-12-31`);
  await sheet().getByRole('button', { name: 'Créer l’objectif' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Verser/ }).click();
  await sheet().locator('input.amount').fill('2000');
  await sheet().getByRole('button', { name: 'Ajouter le versement' }).click();
  await page.waitForTimeout(300);
  await shot('10-objectif');
  await closeToasts();
  await page.goto(URL_ + `#/budget?cur=MAD`);
  await page.waitForTimeout(200);
  const txt = await page.locator('main').innerText();
  expect(txt.includes('Versé sur vos objectifs'), 'bilan épargne');
  const card = await page.locator('.card.cream').first().innerText();
  expect(card.replace(/\s| /g, '').includes('5750'), 'restant MAD 5750 (épargne non déduite) : ' + card);
});

await step('Document avec date d’expiration → échéance liée unique', async () => {
  await page.goto(URL_ + '#/documents');
  await page.getByRole('button', { name: 'Ajouter un document' }).first().click();
  await sheet().getByRole('button', { name: 'Garanties' }).click();
  await sheet().locator('input[type=file][accept="image/*,application/pdf"]').setInputFiles(ROOT + 'public/icons/icon-512.png');
  await sheet().getByPlaceholder('Ex. Contrat assurance ménage 2026').fill('Garantie lave-linge');
  await sheet().locator('input[type=date]').fill(`${now.getFullYear() + 1}-03-15`);
  await sheet().getByRole('button', { name: 'Ajouter au coffre' }).click();
  await page.waitForTimeout(500);
  const t = await toastText();
  expect(t.includes('Fin de validité'), 'échéance créée : ' + t);
  await closeToasts();
  await shot('11-document');
  // modification de la date → même échéance déplacée
  await page.getByRole('button', { name: 'Modifier' }).click();
  await sheet().locator('input[type=date]').fill(`${now.getFullYear() + 1}-04-20`);
  await sheet().getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.waitForTimeout(400);
  const n = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('chema'); q.onsuccess = () => { const g = q.result.transaction('deadlines').objectStore('deadlines').getAll(); g.onsuccess = () => r(g.result.filter((d) => d.type === 'expiry' && !d.deletedAt).map((d) => d.date)); }; }));
  expect(n.length === 1 && n[0].endsWith('-04-20'), 'une seule échéance déplacée : ' + JSON.stringify(n));
  await closeToasts();
});

await step('Document bancaire : avertissement + masquage obligatoire', async () => {
  await page.goto(URL_ + '#/documents');
  await page.getByRole('button', { name: 'Ajouter un document' }).first().click();
  await sheet().getByRole('button', { name: 'Banque' }).click();
  expect(await sheet().getByText(/Document bancaire/).count(), 'avertissement banque');
  await sheet().locator('input[type=file][accept="image/*,application/pdf"]').setInputFiles(ROOT + 'public/icons/icon-512.png');
  await sheet().getByPlaceholder('Ex. Contrat assurance ménage 2026').fill('Relevé PostFinance octobre');
  await sheet().getByRole('button', { name: 'Ajouter au coffre' }).click();
  await page.waitForTimeout(200);
  expect(await sheet().getByText('Choisissez une option pour continuer.').count(), 'blocage sans décision');
  await sheet().getByRole('button', { name: /Masquer les numéros/ }).click();
  await page.waitForTimeout(500);
  const c = page.locator('canvas.mask-canvas');
  const b = await c.boundingBox();
  await page.mouse.move(b.x + 40, b.y + 40);
  await page.mouse.down();
  await page.mouse.move(b.x + 200, b.y + 90, { steps: 5 });
  await page.mouse.up();
  await shot('12-masquage');
  await page.getByRole('button', { name: 'Valider' }).click();
  await page.waitForTimeout(400);
  expect(await sheet().getByText('Masqué').count(), 'badge masqué');
  await sheet().getByRole('button', { name: 'Ajouter au coffre' }).click();
  await page.waitForTimeout(500);
  await closeToasts();
});

await step('Import CSV : colonnes, doublon, crédit, charge fixe, résumé', async () => {
  const d1 = `${ym}-03`;
  const [y, m] = ym.split('-');
  const csv = [
    'Compte;CH93 0076 2011 6238 5295 7',
    '',
    'Date;Texte de notification;Crédit en CHF;Débit en CHF;Valeur;Solde',
    `03.${m}.${y};Achat Migros Genève;;-45.60;03.${m}.${y};1000`,
    `${String(now.getDate()).padStart(2, '0')}.${m}.${y};Coop Pronto;;-12.50;;`,
    `05.${m}.${y};Remboursement CSS Assurance;120.00;;;`,
    `02.${m}.${y};Ordre permanent Régie Loyer;;-1500.00;;`,
    `08.${m}.${y};Ligne illisible;;abc;;`,
  ].join('\r\n');
  const f = SHOTS + 'releve.csv';
  writeFileSync(f, Buffer.from(csv, 'latin1'));
  await page.goto(URL_ + '#/budget/import');
  await page.locator('input[type=file]').setInputFiles(f);
  const txt = await reviewText(page);
  expect(txt.includes('déjà enregistrée'), 'doublon signalé : ' + txt.slice(0, 300));
  expect(txt.includes('Paiement de la charge fixe « Loyer »'), 'charge fixe reconnue');
  expect(txt.includes('1 ligne non lue'), 'ligne illisible signalée');
  await shot('14-import-verification');
  await addAll(page);
  const done = await page.locator('main').innerText();
  expect(done.includes('C’est ajouté') && done.includes('Non ajoutées'), 'résumé');
  await shot('15-import-resume');
  await closeToasts();
  await page.goto(URL_ + '#/budget?cur=CHF');
  await page.waitForTimeout(200);
  const card = await page.locator('.card.blue').first().innerText();
  // 2418.30 - 83.40 (facture) - 45.60 + 120 (remboursement) ; loyer désormais payé (même montant) → 2409.30
  expect(card.replace(/\s| /g, '').includes('2409.30'), 'restant après import 2409.30 : ' + card);
});

await step('Écran Mois : filtres et totaux séparés', async () => {
  await page.goto(URL_ + '#/budget/mois');
  await page.waitForTimeout(200);
  const t = await page.locator('main').innerText();
  expect(t.includes('Total CHF') && t.includes('Total MAD'), 'totaux séparés');
  await shot('16-mois');
});

await step('Suppression avec confirmation + Annuler', async () => {
  await page.getByText('Achat Migros Genève').first().click();
  await sheet().getByRole('button', { name: 'Supprimer' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Supprimer' }).click();
  await page.waitForTimeout(200);
  expect(await page.getByText('Achat Migros Genève').count() === 0, 'supprimée');
  await page.locator('.toast button', { hasText: 'Annuler' }).click();
  await page.waitForTimeout(300);
  expect(await page.getByText('Achat Migros Genève').count() > 0, 'restaurée par Annuler');
});

await step('Recherche globale', async () => {
  await page.goto(URL_ + '#/recherche');
  await page.getByPlaceholder('Dépense, échéance, document…').fill('assurance');
  await page.waitForTimeout(200);
  const t = await page.locator('main').innerText();
  expect(t.includes('Assurance ménage') && t.includes('Remboursement CSS'), 'résultats : ' + t.slice(0, 200));
  await shot('17-recherche');
});

await step('Persistance après rechargement', async () => {
  await page.reload();
  await page.waitForTimeout(800);
  await page.goto(URL_ + '#/budget?cur=CHF');
  await page.waitForTimeout(200);
  const card = await page.locator('.card.blue').first().innerText();
  expect(card.replace(/\s| /g, '').includes('2409.30'), 'données conservées : ' + card);
});

let backupPath = null;
await step('Sauvegarde chiffrée (export)', async () => {
  await page.goto(URL_ + '#/reglages/sauvegarde');
  await page.getByRole('button', { name: 'Exporter une sauvegarde' }).click();
  await sheet().locator('input[type=password]').first().fill('motdepasse123');
  await sheet().locator('input[type=password]').nth(1).fill('motdepasse123');
  const dl = page.waitForEvent('download');
  await sheet().getByRole('button', { name: 'Créer la sauvegarde chiffrée' }).click();
  const d = await dl;
  backupPath = SHOTS + d.suggestedFilename();
  await d.saveAs(backupPath);
  const content = readFileSync(backupPath, 'utf8');
  expect(content.includes('"encrypted":true') && !content.includes('Assurance'), 'fichier chiffré');
  await page.waitForTimeout(300);
  await closeToasts();
});

await step('Tout effacer puis restaurer la sauvegarde', async () => {
  await page.goto(URL_ + '#/reglages');
  await page.getByRole('button', { name: 'Effacer toutes les données' }).click();
  await page.getByRole('alertdialog').locator('input').fill('EFFACER');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Tout effacer définitivement' }).click();
  await page.waitForTimeout(1200);
  await page.goto(URL_ + '#/reglages/sauvegarde');
  await page.waitForTimeout(300);
  await page.locator('.sheet .btn.ghost', { hasText: 'Plus tard' }).click().catch(() => null);
  await page.locator('input[type=file]').setInputFiles(backupPath);
  await page.getByRole('alertdialog').locator('input').fill('motdepasse123');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Valider' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restaurer cette sauvegarde' }).click();
  await page.waitForTimeout(1000);
  await page.goto(URL_ + '#/budget?cur=CHF');
  await page.waitForTimeout(300);
  const card = await page.locator('.card.blue').first().innerText();
  expect(card.replace(/\s| /g, '').includes('2409.30'), 'restauré : ' + card);
  await page.goto(URL_ + '#/documents');
  await page.waitForTimeout(400);
  expect(await page.getByText('Garantie lave-linge').count(), 'document restauré');
  await shot('18-documents');
});

await step('Verrouillage par code', async () => {
  await page.goto(URL_ + '#/reglages/securite');
  await page.getByRole('button', { name: 'Activer un code' }).click();
  await sheet().locator('input[type=password]').first().fill('2468');
  await sheet().locator('input[type=password]').nth(1).fill('2468');
  await sheet().getByRole('button', { name: 'Activer le code' }).click();
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForTimeout(800);
  await page.getByRole('dialog', { name: 'Application verrouillée' }).waitFor();
  await shot('19-verrou');
  for (const k of ['1', '1', '1', '1']) await page.getByRole('button', { name: k, exact: true }).click();
  await page.waitForTimeout(400);
  expect(await page.getByText('Code incorrect.').count(), 'mauvais code refusé');
  for (const k of ['2', '4', '6', '8']) await page.getByRole('button', { name: k, exact: true }).click();
  await page.waitForTimeout(500);
  expect((await page.getByRole('dialog', { name: 'Application verrouillée' }).count()) === 0, 'déverrouillé');
});

await step('Hors ligne : l’application s’ouvre depuis le cache', async () => {
  await page.goto(URL_ + '#/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(800);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForTimeout(1000);
  for (const k of ['2', '4', '6', '8']) await page.getByRole('button', { name: k, exact: true }).click().catch(() => null);
  await page.waitForTimeout(500);
  const t = await page.locator('main').innerText();
  expect(t.includes('Chema') || t.includes('À venir'), 'contenu hors ligne');
  await ctx.setOffline(false);
});

await step('Accessibilité de base : pas de défilement horizontal', async () => {
  for (const r of ['#/', '#/budget', '#/echeances', '#/documents', '#/epargne', '#/reglages', '#/budget/mois']) {
    await page.goto(URL_ + r);
    await page.waitForTimeout(150);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(w <= 391, `défilement horizontal sur ${r} (${w}px)`);
  }
});

await page.goto(URL_ + '#/budget');
await page.waitForTimeout(300);
await shot('20-budget-final');
await page.goto(URL_ + '#/');
await page.waitForTimeout(300);
await shot('21-accueil-final');

// ---------- Détection des charges fixes, sur un téléphone « neuf » ----------
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'fr-CH', timezoneId: 'Europe/Zurich' });
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p2.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
const shot2 = (n) => p2.screenshot({ path: `${SHOTS}${n}.png` });
const dd = (offset, day) => {
  const x = new Date(now.getFullYear(), now.getMonth() + offset, day);
  return `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}.${x.getFullYear()}`;
};

await step('Détection des charges fixes depuis 4 mois de relevé', async () => {
  const rows = ['Date;Texte de notification;Crédit en CHF;Débit en CHF'];
  const add = (date, label, debit) => rows.push(`${date};${label};;-${debit}`);
  add(dd(-3, 1), 'ORDRE PERMANENT REGIE DUPONT SA LOYER', '1500.00');
  add(dd(-3, 30), 'ORDRE PERMANENT REGIE DUPONT SA LOYER', '1500.00'); // loyer du mois suivant payé en avance
  add(dd(-1, 1), 'ORDRE PERMANENT REGIE DUPONT SA LOYER', '1500.00');
  add(dd(0, 1), 'ORDRE PERMANENT REGIE DUPONT SA LOYER', '1500.00');
  add(dd(-3, 28), 'LSV+ SWISSCOM (SCHWEIZ) AG 3050 BERN', '59.90');
  add(dd(-2, 27), 'LSV+ SWISSCOM (SCHWEIZ) AG 3050 BERN', '64.20');
  add(dd(-1, 28), 'LSV+ SWISSCOM (SCHWEIZ) AG 3050 BERN', '61.30');
  for (const o of [-3, -2, -1, 0]) add(dd(o, 15), 'SPOTIFY P1234567 STOCKHOLM', '12.95');
  for (const [o, day, amt] of [[-3, 3, '45.60'], [-3, 12, '88.10'], [-2, 4, '23.95'], [-2, 18, '61.40'], [-1, 6, '37.20'], [-1, 20, '52.75'], [0, 4, '19.90']]) add(dd(o, day), 'ACHAT CARTE MIGROS GENEVE', amt);
  add(dd(-2, 14), 'IKEA VERNIER', '349.90');
  const f = SHOTS + 'releve-4-mois.csv';
  writeFileSync(f, rows.join('\r\n'));

  await p2.goto(URL_);
  await p2.getByRole('dialog', { name: 'Bienvenue' }).waitFor();
  await p2.locator('.sheet .btn.ghost', { hasText: 'Plus tard' }).click();
  await p2.waitForTimeout(400);
  await p2.goto(URL_ + '#/budget/import');
  await p2.locator('input[type=file]').setInputFiles(f);
  await reviewText(p2);
  await addAll(p2);
  await p2.waitForTimeout(400);
  const banner = p2.getByText(/charges? fixes? possibles?/);
  await banner.waitFor();
  expect((await banner.innerText()).includes('3 charges fixes possibles'), 'bandeau : ' + (await banner.innerText()));
  await banner.click();
  await p2.waitForTimeout(400);
  const txt = await p2.locator('main').innerText();
  expect(txt.includes('3 charges fixes trouvées'), 'trois candidates : ' + txt.slice(0, 300));
  expect(!/migros|ikea/i.test(txt.split('3 charges fixes trouvées')[1].split('Les paiements déjà importés')[0]), 'courses et achat ponctuel exclus');
  expect(txt.includes('Montant variable'), 'Swisscom variable signalé');
  await shot2('22-detection');
  await p2.locator('input[aria-label="Nom de la charge"]').first().fill('Loyer');
  await p2.getByRole('button', { name: /^Créer 3 charges fixes/ }).click();
  await p2.waitForTimeout(500);
  expect(p2.url().includes('#/budget/charges'), 'retour à la liste');
  const list = await p2.locator('main').innerText();
  expect(list.includes('Loyer') && list.includes('Swisscom') && list.includes('Spotify'), 'charges créées : ' + list.slice(0, 200));
  await shot2('23-charges-detectees');
  // Mois précédent : tout est payé ou ignoré (rien de « prévu »)
  const prev = (() => { const x = new Date(now.getFullYear(), now.getMonth() - 1, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; })();
  await p2.goto(URL_ + `#/budget?cur=CHF&m=${prev}`);
  await p2.waitForTimeout(300);
  const prevCard = (await p2.locator('.card.blue').first().innerText()).replace(/\s| /g, '');
  expect(prevCard.includes('Chargesfixesprévues(nonpayées)−0.00'), 'mois précédent sans charge prévue : ' + prevCard);
  // Mois en cours : loyer et Spotify payés, Swisscom (vers le 28) prévu
  await p2.goto(URL_ + '#/budget?cur=CHF');
  await p2.waitForTimeout(300);
  const curText = await p2.locator('main').innerText();
  if (now.getDate() < 27) expect(/Swisscom[\s\S]*Prévue/.test(curText), 'Swisscom prévue ce mois-ci');
  await shot2('24-budget-apres-detection');
});
await ctx2.close();

// ---------- Import de relevés PDF (plusieurs fichiers) puis détection ----------
const { makeStatements } = await import('./pdf-fixtures.mjs');
const pdfs = await makeStatements(browser, SHOTS, now);
const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'fr-CH', timezoneId: 'Europe/Zurich' });
const p3 = await ctx3.newPage();
p3.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p3.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

await step('Import de 3 relevés PDF suisses puis détection des charges fixes', async () => {
  await p3.goto(URL_);
  await p3.getByRole('dialog', { name: 'Bienvenue' }).waitFor();
  await p3.locator('.sheet .btn.ghost', { hasText: 'Plus tard' }).click();
  await p3.waitForTimeout(400);
  await p3.goto(URL_ + '#/budget/import');
  await p3.getByRole('button', { name: 'CHF · Suisse' }).click();
  await p3.locator('input[type=file]').setInputFiles(pdfs.swiss);
  const review = await reviewText(p3);
  expect(review.includes('18 dépenses et 3 entrées trouvées') && review.includes('Montants vérifiés avec le solde du relevé'), 'lecture PDF : ' + review.slice(0, 400));
  expect(review.includes('Ordre permanent Régie Dupont SA, Loyer') && review.includes('+5 200.00'), 'libellés et crédit : ' + review.slice(0, 300));
  await p3.screenshot({ path: `${SHOTS}25-import-pdf.png` });
  await addAll(p3);
  const banner = p3.getByText(/charges? fixes? possibles?/);
  await banner.waitFor();
  await banner.click();
  await p3.waitForTimeout(400);
  const det = await p3.locator('main').innerText();
  const names = (await p3.locator('input[aria-label="Nom de la charge"]').evaluateAll((els) => els.map((e) => e.value))).join(' | ');
  expect(det.includes('3 charges fixes trouvées') && /R[ée]gie/.test(names) && names.includes('Swisscom') && names.includes('Spotify'), 'détection : ' + names);
  await p3.screenshot({ path: `${SHOTS}26-detection-pdf.png` });
});

await step('Import d’un relevé PDF marocain (MAD, plusieurs pages)', async () => {
  await p3.goto(URL_ + '#/');
  await p3.waitForTimeout(200);
  await p3.goto(URL_ + '#/budget/import');
  await p3.getByRole('button', { name: 'MAD · Maroc' }).click();
  await p3.locator('input[type=file]').setInputFiles(pdfs.morocco);
  const review = await reviewText(p3);
  expect(review.includes('30 dépenses et 2 entrées trouvées'), 'lecture PDF MA : ' + review.slice(0, 300));
  expect(review.includes('PRLV LOYER APPARTEMENT CASA') && review.includes('+8 000.00'), 'libellés MA : ' + review.slice(0, 300));
});
await ctx3.close();
const ctx4 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'fr-CH', timezoneId: 'Europe/Zurich' });
const p4 = await ctx4.newPage();
p4.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p4.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
await step('Relevé PDF sans ligne de titres : lu automatiquement, réglages cachés disponibles', async () => {
  const p3 = p4;
  await p3.goto(URL_);
  await p3.getByRole('dialog', { name: 'Bienvenue' }).waitFor();
  await p3.locator('.sheet .btn.ghost', { hasText: 'Plus tard' }).click();
  await p3.waitForTimeout(400);
  await p3.goto(URL_ + '#/budget/import');
  await p3.getByRole('button', { name: 'CHF · Suisse' }).click();
  await p3.locator('input[type=file]').setInputFiles(pdfs.headerless);
  const info = await reviewText(p3);
  expect(info.includes('4 dépenses et 1 entrée trouvées') && info.includes('Montants vérifiés'), 'lecture : ' + info.slice(0, 300));
  expect(info.includes('Ordre permanent Régie Dupont SA') && info.includes('1 500.00') && info.includes('+5 200.00'), 'montants et sens : ' + info.slice(0, 500));
  await p3.screenshot({ path: `${SHOTS}27-import-sans-titres.png` });
  // Réglages avancés (cachés) : colonnes numérotées avec exemples
  await p3.getByRole('button', { name: /Corriger la lecture/ }).click();
  await p3.getByText('Corriger la lecture', { exact: true }).waitFor();
  const opts = await p3.locator('main select').first().locator('option').allInnerTexts();
  expect(opts.some((o) => /Colonne 1 — ex\. \d{2}\.\d{2}\.\d{4}/.test(o)), 'exemples dans les menus : ' + opts.join(' | '));
  expect((await p3.locator('table thead th').allInnerTexts()).join('|').includes('Colonne 1'), 'en-têtes numérotés');
});
await ctx4.close();

await browser.close();
server.kill();

console.log('\n--- Résultat ---');
for (const r of results) console.log(r.join(' · '));
const uniq = [...new Set(errors)].filter((e) => !e.includes('favicon'));
console.log(uniq.length ? `\nErreurs console (${uniq.length}) :\n` + uniq.join('\n') : '\nAucune erreur console.');
const failed = results.filter((r) => r[0] !== 'OK').length;
process.exit(failed ? 1 : 0);
