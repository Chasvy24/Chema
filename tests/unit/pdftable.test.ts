import { describe, expect, it } from 'vitest';
import { buildTable, groupLines, yearHint, type PdfTextItem } from '../../src/lib/pdftable';
import { analyzeColumns, detectHeaderRow, extractRows, guessMapping } from '../../src/lib/csv';

// Texte positionné tel que PDF.js le fournit (y décroissant vers le bas de la page).
const item = (str: string, x: number, y: number, h = 9, page = 1): PdfTextItem => ({ str, x, y, w: str.length * h * 0.5, h, page });

function parse(items: PdfTextItem[]) {
  const t = buildTable(groupLines(items));
  const h = detectHeaderRow(t.rows);
  const map = guessMapping(analyzeColumns(h >= 0 ? t.rows[h] : null, t.rows.slice(h + 1)));
  return { t, h, map, rows: extractRows(t.rows, h, map, { pdf: true, yearHint: 2026, lineMeta: t.meta }) };
}

describe('relevé PDF → tableau', () => {
  it('colonnes Débit/Crédit/Solde, libellé sur deux lignes, totaux écartés', () => {
    const items = [
      item('Banque Exemple SA', 30, 800, 12),
      item('IBAN CH93 0076 2011 6238 5295 7', 30, 780),
      item('Date', 30, 740), item('Texte', 100, 740), item('Débit', 330, 740), item('Crédit', 400, 740), item('Solde', 470, 740),
      item('Solde reporté', 100, 725), item("2'350.40", 470, 725),
      item('01.08.2026', 30, 710), item('Ordre permanent', 100, 710), item("1'500.00", 330, 710), item('850.40', 470, 710),
      item('Régie Dupont SA, Loyer', 100, 699),
      item('25.08.2026', 30, 680), item('Salaire', 100, 680), item("5'200.00", 400, 680), item("6'050.40", 470, 680),
      item('28.08.2026', 30, 660), item('LSV+ Swisscom', 100, 660), item('59.90', 345, 660), item("5'990.50", 470, 660),
      item('Total des mouvements', 100, 640), item("5'990.50", 470, 640),
      item('Banque Exemple SA · Rue Fictive 1', 30, 600),
    ];
    const { rows, map, t } = parse(items);
    expect(t.rows[detectHeaderRow(t.rows)]).toContain('Débit');
    expect(map.mode).toBe('split');
    const ok = rows.filter((r) => r.ok);
    expect(ok).toHaveLength(3);
    expect(ok[0]).toMatchObject({ date: '2026-08-01', amount: 150000, credit: false, label: 'Ordre permanent Régie Dupont SA, Loyer' });
    expect(ok[1]).toMatchObject({ amount: 520000, credit: true });
    expect(ok[2]).toMatchObject({ amount: 5990, label: 'LSV+ Swisscom' });
    expect(rows.filter((r) => r.ignored).map((r) => r.label)).toEqual(expect.arrayContaining(['Solde reporté', 'Total des mouvements']));
  });

  it('texte de plusieurs colonnes regroupé par PDF.js, dates sans année, montants 1 234,56', () => {
    const items = [
      item('Date', 30, 740), item('Libellé', 90, 740), item('Débit', 300, 740), item('Crédit', 370, 740),
      item('02/09 PRLV LOYER APPARTEMENT', 30, 720), item('3 500,00', 300, 720),
      item('CASA', 90, 709),
      item('20/09 VIREMENT RECU 8 000,00', 30, 690),
      item('22/09 RETRAIT GAB', 30, 670), item('1 000,00', 300, 670),
    ];
    // Aligne à droite les montants (bord droit des colonnes Débit 340 / Crédit 410)
    for (const x of items) if (/\d,\d\d$/.test(x.str) && !/[A-Z]/.test(x.str)) x.x = (x.str === '8 000,00' ? 410 : 340) - x.w;
    const v = items.find((x) => x.str.startsWith('20/09'))!;
    v.w = 410 - v.x; // le morceau regroupé s'étend jusqu'au bord droit de la colonne Crédit
    const { rows } = parse(items);
    const ok = rows.filter((r) => r.ok);
    expect(ok.map((r) => [r.date, r.label, r.amount, r.credit])).toEqual([
      ['2026-09-02', 'PRLV LOYER APPARTEMENT CASA', 350000, false],
      ['2026-09-20', 'VIREMENT RECU', 800000, true],
      ['2026-09-22', 'RETRAIT GAB', 100000, false],
    ]);
  });

  it('année la plus citée', () => {
    expect(yearHint([item('Relevé du 01.09.2026 au 30.09.2026', 0, 0), item('2025', 0, 0)], 2020)).toBe(2026);
  });
});
