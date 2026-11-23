import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { detectRecurring, merchantKey, periodMonth, prettyName, typicalDay, coverage } from '../../src/lib/detect';
import type { Recurring, Tx } from '../../src/db/schema';

const now = '2026-11-23T10:00:00.000Z';
let n = 0;
function tx(date: string, label: string, amount: number, p: Partial<Tx> = {}): Tx {
  return { id: `t${++n}`, kind: 'expense', date, amount, currency: 'CHF', categoryId: null, label, docIds: [], source: 'csv', createdAt: now, updatedAt: now, ...p };
}

const sample: Tx[] = [
  // Loyer : ordre permanent autour du 1er (un paiement le 30 du mois précédent)
  tx('2026-08-01', 'ORDRE PERMANENT REGIE DUPONT SA LOYER', 150000, { categoryId: 'logement' }),
  tx('2026-08-30', 'ORDRE PERMANENT REGIE DUPONT SA LOYER', 150000, { categoryId: 'logement' }),
  tx('2026-10-01', 'ORDRE PERMANENT REGIE DUPONT SA LOYER', 150000, { categoryId: 'logement' }),
  tx('2026-11-02', 'ORDRE PERMANENT REGIE DUPONT SA LOYER', 150000, { categoryId: 'logement' }),
  // Swisscom : montant variable vers le 28
  tx('2026-08-28', 'LSV+ SWISSCOM (SCHWEIZ) AG 3050 BERN', 5990),
  tx('2026-09-27', 'LSV+ SWISSCOM (SCHWEIZ) AG 3050 BERN', 6420),
  tx('2026-10-28', 'LSV+ SWISSCOM (SCHWEIZ) AG 3050 BERN', 6130),
  // Assurance trimestrielle
  tx('2026-05-15', 'HELSANA VERSICHERUNGEN AG PRAEMIE 05.2026', 112000),
  tx('2026-08-14', 'HELSANA VERSICHERUNGEN AG PRAEMIE 08.2026', 112000),
  tx('2026-11-16', 'HELSANA VERSICHERUNGEN AG PRAEMIE 11.2026', 112000),
  // Courses : plusieurs fois par mois → pas une charge fixe
  ...['2026-08-03', '2026-08-10', '2026-08-17', '2026-09-02', '2026-09-09', '2026-09-20', '2026-10-05', '2026-10-12', '2026-11-03'].map((d, i) => tx(d, 'ACHAT CARTE MIGROS GENEVE', 3000 + i * 731)),
  // Abonnement résilié (plus vu depuis août)
  tx('2026-06-12', 'NETFLIX.COM', 1890),
  tx('2026-07-12', 'NETFLIX.COM', 1890),
  tx('2026-08-12', 'NETFLIX.COM', 1890),
  // Retraits d'espèces réguliers → exclus
  tx('2026-08-05', 'RETRAIT BANCOMAT GENEVE', 20000),
  tx('2026-09-05', 'RETRAIT BANCOMAT GENEVE', 20000),
  tx('2026-10-05', 'RETRAIT BANCOMAT GENEVE', 20000),
  // Achat ponctuel
  tx('2026-09-14', 'IKEA VERNIER', 34990),
];

describe('détection des charges fixes', () => {
  it('outils de libellé', () => {
    expect(merchantKey('LSV+ SWISSCOM (SCHWEIZ) AG 3050 BERN')).toBe('swisscom bern');
    expect(merchantKey('HELSANA VERSICHERUNGEN AG PRAEMIE 05.2026')).toBe(merchantKey('HELSANA VERSICHERUNGEN AG PRAEMIE 08.2026'));
    expect(prettyName(['LSV+ SWISSCOM (SCHWEIZ) AG 3050 BERN'])).toBe('Swisscom Bern');
    expect(prettyName(['ORDRE PERMANENT REGIE DUPONT SA LOYER'])).toBe('Regie Dupont Loyer');
    expect(typicalDay([1, 30, 1, 2]).day).toBe(1);
    expect(periodMonth('2026-08-30', 1)).toBe('2026-09');
    expect(periodMonth('2026-10-02', 28)).toBe('2026-09');
  });

  const found = detectRecurring(sample, [], 'CHF', '2026-11-23');
  const by = (s: string) => found.find((c) => c.name.toLowerCase().includes(s));

  it('trouve loyer, Swisscom et assurance trimestrielle', () => {
    const loyer = by('regie')!;
    expect(loyer).toBeTruthy();
    expect(loyer.frequency).toBe(1);
    expect(loyer.day).toBe(1);
    expect(loyer.amount).toBe(150000);
    expect(loyer.variable).toBe(false);
    expect(loyer.categoryId).toBe('logement');
    expect(loyer.matches.map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    expect(loyer.confidence).toBe('high');

    const sw = by('swisscom')!;
    expect(sw.variable).toBe(true);
    expect(sw.min).toBe(5990);
    expect(sw.max).toBe(6420);
    expect(sw.day).toBe(28);

    const ins = by('helsana')!;
    expect(ins.frequency).toBe(3);
    expect(ins.amount).toBe(112000);
  });

  it('ignore courses, retraits, achats ponctuels et abonnements arrêtés', () => {
    expect(by('migros')).toBeUndefined();
    expect(by('bancomat')).toBeUndefined();
    expect(by('ikea')).toBeUndefined();
    expect(by('netflix')).toBeUndefined();
    expect(found).toHaveLength(3);
  });

  it('ne repropose pas une charge déjà enregistrée ni une autre monnaie', () => {
    const rec: Recurring = { id: 'r', name: 'Swisscom', currency: 'CHF', categoryId: null, day: 28, frequency: 1, startDate: '2026-01-01', amounts: [{ from: '2000-01', amount: 6000 }], overrides: {}, pauses: [], createdAt: now, updatedAt: now };
    expect(detectRecurring(sample, [rec], 'CHF', '2026-11-23').some((c) => c.name.includes('Swisscom'))).toBe(false);
    expect(detectRecurring(sample, [], 'MAD', '2026-11-23')).toEqual([]);
  });

  it('couverture des données', () => {
    const c = coverage(sample, 'CHF')!;
    expect(c.from).toBe('2026-05-15');
    expect(c.months).toBe(7);
  });
});

describe('création des charges détectées', () => {
  it('rattache les paiements passés sans double comptage', async () => {
    const { data, loadAll, commit, put } = await import('../../src/db/store');
    const { createDetectedCharges } = await import('../../src/db/actions');
    const { monthStats } = await import('../../src/lib/budget');
    await loadAll();
    await commit(sample.map((t) => put('txs', t)));
    const cands = detectRecurring(data.value.txs, data.value.recurring, 'CHF', '2026-11-23');
    const loyer = cands.find((c) => c.name.includes('Regie'))!;
    const res = await createDetectedCharges([{ cand: loyer, name: 'Loyer', amount: loyer.amount, frequency: 1, day: 1, categoryId: 'logement' }]);
    expect(res.linked).toBe(4);
    const rec = data.value.recurring.find((r) => r.name === 'Loyer')!;
    expect(rec.startDate).toBe('2026-08-01');
    // Paiement du 30.08 compté pour septembre
    expect(data.value.txs.find((t) => t.date === '2026-08-30')!.month).toBe('2026-09');
    for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) {
      const s = monthStats(data.value, 'CHF', m);
      const occ = s.occurrences.find((o) => o.rec.id === rec.id)!;
      expect(occ.status).toBe('paid');
      expect(s.planned).toBe(0);
    }
    // Décembre : prévu, pas encore payé
    const dec = monthStats(data.value, 'CHF', '2026-12');
    expect(dec.planned).toBe(150000);
    // La détection ne repropose plus le loyer
    expect(detectRecurring(data.value.txs, data.value.recurring, 'CHF', '2026-11-23').some((c) => c.key === loyer.key)).toBe(false);
  });
});
