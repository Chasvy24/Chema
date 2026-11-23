import { describe, expect, it } from 'vitest';
import { autoMap } from '../../src/lib/autoimport';
import { parseTextDate, parseUserDate } from '../../src/lib/dates';

const okList = (r: ReturnType<typeof autoMap>) => r.parsed.filter((p) => p.ok).map((p) => [p.date, p.label, p.amount, !!p.credit]);

describe('lecture automatique des relevés', () => {
  it('Crédit avant Débit, sans titres : le solde tranche', () => {
    // Date | Texte | Crédit | Débit | Solde  (ordre PostFinance)
    const rows = [
      ['01.10.2026', 'Ordre permanent Régie Dupont', '', '1500.00', '850.40'],
      ['03.10.2026', 'Achat Migros', '', '45.60', '804.80'],
      ['25.10.2026', 'Salaire', '5200.00', '', '6004.80'],
      ['26.10.2026', 'Remboursement CSS', '120.00', '', '6124.80'],
      ['27.10.2026', 'Twint Marie', '', '30.00', '6094.80'],
      ['28.10.2026', 'Swisscom', '', '61.30', '6033.50'],
    ];
    const r = autoMap(rows);
    expect(r.checked).toBe(true);
    expect(okList(r)).toEqual([
      ['2026-10-01', 'Ordre permanent Régie Dupont', 150000, false],
      ['2026-10-03', 'Achat Migros', 4560, false],
      ['2026-10-25', 'Salaire', 520000, true],
      ['2026-10-26', 'Remboursement CSS', 12000, true],
      ['2026-10-27', 'Twint Marie', 3000, false],
      ['2026-10-28', 'Swisscom', 6130, false],
    ]);
  });

  it('relevé du plus récent au plus ancien, montant unique signé', () => {
    const rows = [
      ['Date', 'Libellé', 'Montant', 'Solde'],
      ['28/10/2026', 'PRLV MAROC TELECOM', '-199,00', '14 401,00'],
      ['20/10/2026', 'VIREMENT RECU', '8 000,00', '14 600,00'],
      ['05/10/2026', 'PAIEMENT CB MARJANE', '-400,00', '6 600,00'],
      ['02/10/2026', 'PRLV LOYER', '-3 500,00', '7 000,00'],
    ];
    const r = autoMap(rows);
    expect(r.checked).toBe(true);
    expect(okList(r).map((x) => [x[2], x[3]])).toEqual([[19900, false], [800000, true], [40000, false], [350000, false]]);
  });

  it('montant unique sans signe ni solde : les dépenses sont positives', () => {
    const rows = [
      ['12.10.2026', 'Achat Coop', '23.40'],
      ['13.10.2026', 'CFF billet', '12.00'],
      ['14.10.2026', 'Pharmacie', '18.90'],
    ];
    const r = autoMap(rows);
    expect(r.parsed.filter((p) => p.ok).every((p) => !p.credit)).toBe(true);
  });

  it('dates en toutes lettres', () => {
    expect(parseUserDate('01 oct. 2026')).toBe('2026-10-01');
    expect(parseUserDate('1. Oktober 2026')).toBe('2026-10-01');
    expect(parseUserDate('03-NOV-26')).toBe('2026-11-03');
    expect(parseUserDate('Oct 5, 2026')).toBe('2026-10-05');
    expect(parseTextDate('15 déc', 2026)).toBe('2026-12-15');
    expect(parseUserDate('12 pommes')).toBeNull();
  });

  it('PDF daté une fois par jour : les lignes suivantes reprennent la date', () => {
    const rows = [
      ['Date', 'Texte', 'Débit', 'Crédit'],
      ['03.10.2026', 'Achat Migros', '45.60', ''],
      ['', 'Achat Coop', '12.30', ''],
      ['', 'Total du jour', '57.90', ''],
      ['04.10.2026', 'CFF', '8.80', ''],
    ];
    const r = autoMap(rows, { pdf: true });
    expect(okList(r).map((x) => [x[0], x[1]])).toEqual([
      ['2026-10-03', 'Achat Migros'],
      ['2026-10-03', 'Achat Coop'],
      ['2026-10-04', 'CFF'],
    ]);
  });
});
