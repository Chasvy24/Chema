// Génère des relevés bancaires PDF fictifs (mais réalistes) pour tester l'import PDF.
// Données inventées. Rendu par Chromium (page.pdf), donc avec une vraie couche de texte.

const pad = (n) => String(n).padStart(2, '0');
const swissAmt = (n) => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
const maAmt = (n) => n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function monthDate(now, offset, day) {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return new Date(d.getFullYear(), d.getMonth(), Math.min(day, last));
}
const ch = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const ma = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

const CSS = `
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #111; margin: 0; }
  h1 { font-size: 13pt; margin: 0 0 4px; }
  .meta { margin: 0 0 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  thead { display: table-header-group; }
  th { text-align: left; border-bottom: 1px solid #333; padding: 3px 4px; font-size: 8.5pt; }
  td { padding: 3px 4px; vertical-align: top; border-bottom: 1px solid #ddd; }
  .r { text-align: right; white-space: nowrap; }
  .sub { color: #555; font-size: 8pt; }
  tr { page-break-inside: avoid; }
`;

/** Relevé suisse d'un mois : Date | Texte | Valeur | Débit | Crédit | Solde */
function swissHtml(now, offset, startBalance) {
  const ops = [
    [1, 'Ordre permanent', 'Régie Dupont SA, Loyer', 1500, 0],
    [3, 'Achat carte Migros Genève', 'Carte n° XXXX XXXX XXXX 1234', 45.6 + offset, 0],
    [12, 'Achat carte Coop City', '', 88.1 - offset * 2, 0],
    [15, 'Spotify P1234567 Stockholm', '', 12.95, 0],
    [17, 'Achat carte Migros Genève', '', 23.95, 0],
    [25, 'Salaire novembre Exemple Sàrl', 'Virement reçu', 0, 5200],
    [28, 'LSV+ Swisscom (Schweiz) AG', 'Facture mensuelle', [59.9, 64.2, 61.3][offset + 3] ?? 60, 0],
  ];
  let bal = startBalance;
  const rows = ops
    .map(([day, t1, t2, debit, credit]) => {
      const d = monthDate(now, offset, day);
      bal += credit - debit;
      return `<tr><td>${ch(d)}</td><td>${t1}${t2 ? `<br><span class="sub">${t2}</span>` : ''}</td><td>${ch(d)}</td><td class="r">${debit ? swissAmt(debit) : ''}</td><td class="r">${credit ? swissAmt(credit) : ''}</td><td class="r">${swissAmt(bal)}</td></tr>`;
    })
    .join('');
  const first = monthDate(now, offset, 1);
  const last = monthDate(now, offset, 31);
  return {
    end: bal,
    html: `<html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
    <h1>Banque Exemple SA</h1>
    <p class="meta">Relevé de compte privé · IBAN CH93 0076 2011 6238 5295 7 · Monnaie CHF</p>
    <p class="meta">Période du ${ch(first)} au ${ch(last)}</p>
    <table><thead><tr><th>Date</th><th>Texte</th><th>Valeur</th><th class="r">Débit</th><th class="r">Crédit</th><th class="r">Solde</th></tr></thead>
    <tbody><tr><td></td><td>Solde reporté</td><td></td><td></td><td></td><td class="r">${swissAmt(startBalance)}</td></tr>${rows}
    <tr><td></td><td><b>Total des mouvements</b></td><td></td><td class="r">—</td><td class="r">—</td><td class="r">${swissAmt(bal)}</td></tr></tbody></table>
    <p class="meta" style="margin-top:14px">Banque Exemple SA · Rue Fictive 1 · 1200 Genève</p>
    </body></html>`,
  };
}

/** Relevé marocain sur 2 mois : Date opé. | Libellé | Date valeur | Débit | Crédit, montants 1 234,56 */
function moroccanHtml(now) {
  const rows = [];
  for (const offset of [-2, -1]) {
    const ops = [
      [2, 'PRLV LOYER APPARTEMENT CASA', 3500, 0],
      [5, 'PAIEMENT CB MARJANE CALIFORNIE', 412.35 + offset * 10, 0],
      [8, 'PAIEMENT CB MARJANE CALIFORNIE', 238.9, 0],
      [10, 'PRLV MAROC TELECOM', 199, 0],
      [14, 'PAIEMENT CB ACIMA MAARIF', 156.4, 0],
      [20, 'VIREMENT RECU DE SUISSE', 0, 8000],
      [22, 'RETRAIT GAB CASA ANFA', 1000, 0],
    ];
    for (const [day, label, debit, credit] of ops) {
      const d = monthDate(now, offset, day);
      rows.push(`<tr><td>${ma(d)}</td><td>${label}</td><td>${ma(d)}</td><td class="r">${debit ? maAmt(debit) : ''}</td><td class="r">${credit ? maAmt(credit) : ''}</td></tr>`);
    }
  }
  // Remplissage pour forcer plusieurs pages (en-tête répété)
  const filler = Array.from({ length: 18 }, (_, i) => {
    const d = monthDate(now, -1, 24 + (i % 5));
    return `<tr><td>${ma(d)}</td><td>PAIEMENT CB EPICERIE ${i + 1}</td><td>${ma(d)}</td><td class="r">${maAmt(20 + i)}</td><td></td></tr>`;
  });
  return `<html><head><meta charset="utf-8"><style>${CSS} td { padding: 7px 4px; }</style></head><body>
    <h1>BANQUE EXEMPLE DU MAROC</h1>
    <p class="meta">EXTRAIT DE COMPTE · RIB 007 780 0001234567890123 45 · Devise : MAD</p>
    <table><thead><tr><th>Date opé.</th><th>Libellé</th><th>Date valeur</th><th class="r">Débit</th><th class="r">Crédit</th></tr></thead>
    <tbody>${rows.join('')}${filler.join('')}</tbody></table>
    <p class="meta" style="margin-top:14px">TOTAL MOUVEMENTS</p>
    </body></html>`;
}

/** Crée les PDF dans `dir` et renvoie leurs chemins. */
export async function makeStatements(browser, dir, now = new Date()) {
  const page = await browser.newPage();
  const swiss = [];
  let bal = 2350.4;
  for (const offset of [-3, -2, -1]) {
    const { html, end } = swissHtml(now, offset, bal);
    bal = end;
    await page.setContent(html);
    const d = monthDate(now, offset, 1);
    const path = `${dir}releve-ch-${d.getFullYear()}-${pad(d.getMonth() + 1)}.pdf`;
    await page.pdf({ path, format: 'A4', margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' } });
    swiss.push(path);
  }
  await page.setContent(moroccanHtml(now));
  const morocco = `${dir}releve-ma-2-mois.pdf`;
  await page.pdf({ path: morocco, format: 'A5', margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  await page.close();
  return { swiss, morocco };
}
