import { describe, expect, it } from 'vitest';
import { addMonths, fmtDate, parseUserDate, relativeDays, dayInMonth } from '../../src/lib/dates';
import { fmtMoney, parseAmount } from '../../src/lib/money';
import { detectSensitive, maskSensitive } from '../../src/lib/sensitive';
import { occurrencesForMonth, occKey, dueDateIn } from '../../src/lib/recurring';
import { monthStats } from '../../src/lib/budget';
import { noticeDeadline, sortDeadlines, missedReminders, nextDate, reminderAt } from '../../src/lib/deadlines';
import { analyzeColumns, decodeBytes, detectDelimiter, detectHeaderRow, extractRows, findDuplicate, guessMapping, matchOccurrence, parseCSV } from '../../src/lib/csv';
import { suggestCategory, labelKey } from '../../src/lib/categorize';
import { decryptBytes, encryptBytes, hashPin } from '../../src/lib/crypto';
import { deadlinesToICS } from '../../src/lib/ics';
import { monthlyNeeded, goalProgress } from '../../src/lib/savings';
import type { Category, Deadline, Recurring, Settings, Tx, Goal, Move } from '../../src/db/schema';

const now = '2026-11-23T10:00:00.000Z';

function tx(p: Partial<Tx>): Tx {
  return { id: Math.random().toString(36).slice(2), kind: 'expense', date: '2026-11-10', amount: 1000, currency: 'CHF', categoryId: 'alimentation', label: 'x', docIds: [], source: 'manual', createdAt: now, updatedAt: now, ...p };
}

function rec(p: Partial<Recurring>): Recurring {
  return { id: 'r1', name: 'Loyer', currency: 'CHF', categoryId: 'logement', day: 1, frequency: 1, startDate: '2026-01-01', amounts: [{ from: '2026-01', amount: 150000 }], overrides: {}, pauses: [], createdAt: now, updatedAt: now, ...p };
}

const settings: Settings = {
  id: 'main',
  budgets: { CHF: [{ from: '2026-01', amount: 400000, caps: { alimentation: 60000 } }], MAD: [{ from: '2026-01', amount: 500000, caps: {} }] },
  reminderTime: '18:00',
  notificationsWanted: false,
  lastCurrency: 'CHF',
  labelRules: {},
  createdAt: now,
};

describe('dates', () => {
  it('formate en jj.mm.aaaa', () => expect(fmtDate('2026-03-07')).toBe('07.03.2026'));
  it('analyse les formats courants', () => {
    expect(parseUserDate('07.03.2026')).toBe('2026-03-07');
    expect(parseUserDate('7/3/26')).toBe('2026-03-07');
    expect(parseUserDate('2026-03-07')).toBe('2026-03-07');
    expect(parseUserDate('03/07/2026', 'mdy')).toBe('2026-03-07');
    expect(parseUserDate('31.02.2026')).toBeNull();
    expect(parseUserDate('20260307')).toBe('2026-03-07');
  });
  it('ajoute des mois en gardant la fin de mois', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-12-15', 2)).toBe('2027-02-15');
    expect(dayInMonth('2026-02', 31)).toBe('2026-02-28');
  });
  it('jours relatifs', () => {
    expect(relativeDays('2026-11-24', '2026-11-23').text).toBe('Demain');
    expect(relativeDays('2026-11-20', '2026-11-23').text).toBe('Retard 3 j');
  });
});

describe('montants', () => {
  it.each([
    ['12.50', 1250], ['12,5', 1250], ["1'234.50", 123450], ['1’234.50', 123450], ['1 234,50', 123450], ['1.234,50', 123450],
    ['1,234.50', 123450], ['-12.50', -1250], ['12.50-', -1250], ['(12.50)', -1250], ['CHF 12.50', 1250], ['1234', 123400], ['1.234', 123400], ['0.05', 5],
  ])('parseAmount(%s)', (s, v) => expect(parseAmount(s)).toBe(v));
  it('refuse les valeurs illisibles', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('1.2.3,45,6')).toBeNull();
  });
  it('formate avec la monnaie', () => expect(fmtMoney(123450, 'MAD')).toBe('1 234.50 MAD'));
});

describe('données sensibles', () => {
  it('détecte IBAN, carte, AVS', () => {
    expect(detectSensitive('Virement CH93 0076 2011 6238 5295 7').map((h) => h.kind)).toContain('iban');
    expect(detectSensitive('Carte 4111 1111 1111 1111').map((h) => h.kind)).toContain('card');
    expect(detectSensitive('AVS 756.1234.5678.97').map((h) => h.kind)).toContain('avs');
    expect(detectSensitive('Passeport X1234567').map((h) => h.kind)).toContain('id');
    expect(detectSensitive('RIB 007 780 0001234567890123 45').length).toBeGreaterThan(0);
  });
  it('laisse les textes ordinaires', () => {
    expect(detectSensitive('Contrat assurance ménage 2026')).toEqual([]);
    expect(detectSensitive('Migros Genève 23.11.2026 12.50')).toEqual([]);
  });
  it('masque', () => {
    const r = maskSensitive('Paiement à CH93 0076 2011 6238 5295 7 merci');
    expect(r.count).toBe(1);
    expect(r.text).toBe('Paiement à [numéro masqué] merci');
  });
});

describe('charges fixes', () => {
  it('génère une occurrence prévue par mois', () => {
    const r = rec({});
    const occ = occurrencesForMonth([r], [], '2026-11');
    expect(occ).toHaveLength(1);
    expect(occ[0].status).toBe('planned');
    expect(occ[0].dueDate).toBe('2026-11-01');
  });
  it('respecte fréquence, début et fin', () => {
    const r = rec({ frequency: 3, startDate: '2026-02-15', day: 15, endDate: '2026-12-31' });
    expect(dueDateIn(r, '2026-02')).toBe('2026-02-15');
    expect(dueDateIn(r, '2026-03')).toBeNull();
    expect(dueDateIn(r, '2026-05')).toBe('2026-05-15');
    expect(dueDateIn(r, '2027-02')).toBeNull();
    expect(dueDateIn(rec({ day: 1, startDate: '2026-11-23' }), '2026-11')).toBeNull();
  });
  it('payée = opération confirmée, pas de double comptage', () => {
    const r = rec({});
    const paid = tx({ amount: 152000, occurrence: occKey('r1', '2026-11'), month: '2026-11', categoryId: 'logement', date: '2026-12-02' });
    const s = monthStats({ settings, txs: [paid], recurring: [r], goals: [], moves: [] }, 'CHF', '2026-11');
    expect(s.planned).toBe(0);
    expect(s.confirmed).toBe(152000);
    expect(s.remaining).toBe(400000 - 152000);
    // Le mois de décembre n'est pas affecté par la date réelle du paiement
    const d = monthStats({ settings, txs: [paid], recurring: [r], goals: [], moves: [] }, 'CHF', '2026-12');
    expect(d.confirmed).toBe(0);
    expect(d.planned).toBe(150000);
  });
  it('montant ajusté pour un mois sans changer la base', () => {
    const r = rec({ overrides: { '2026-11': { amount: 99000 } } });
    expect(occurrencesForMonth([r], [], '2026-11')[0].amount).toBe(99000);
    expect(occurrencesForMonth([r], [], '2026-12')[0].amount).toBe(150000);
  });
  it('historique du montant de base', () => {
    const r = rec({ amounts: [{ from: '2026-01', amount: 150000 }, { from: '2026-12', amount: 160000 }] });
    expect(occurrencesForMonth([r], [], '2026-11')[0].amount).toBe(150000);
    expect(occurrencesForMonth([r], [], '2027-01')[0].amount).toBe(160000);
  });
  it('suspendue et ignorée', () => {
    const r = rec({ pauses: [{ from: '2026-10-15' }] });
    expect(occurrencesForMonth([r], [], '2026-10')).toHaveLength(1);
    expect(occurrencesForMonth([r], [], '2026-11')).toHaveLength(0);
    const r2 = rec({ overrides: { '2026-11': { skipped: true } } });
    const s = monthStats({ settings, txs: [], recurring: [r2], goals: [], moves: [] }, 'CHF', '2026-11');
    expect(s.planned).toBe(0);
  });
});

describe('budget', () => {
  it('sépare CHF et MAD, compte remboursements et seuils', () => {
    const txs = [
      tx({ amount: 300000 }),
      tx({ amount: 20000, kind: 'refund' }),
      tx({ amount: 999999, currency: 'MAD' }),
      tx({ amount: 50000, kind: 'income' }),
    ];
    const s = monthStats({ settings, txs, recurring: [], goals: [], moves: [] }, 'CHF', '2026-11');
    expect(s.spentGross).toBe(300000);
    expect(s.refunds).toBe(20000);
    expect(s.confirmed).toBe(280000);
    expect(s.income).toBe(50000);
    expect(s.remaining).toBe(120000);
    expect(s.level).toBe('ok');
    const cat = s.byCategory.find((c) => c.categoryId === 'alimentation')!;
    expect(cat.spent).toBe(280000);
    expect(cat.cap).toBe(60000);
  });
  it('orange à 80 %, rouge au dépassement', () => {
    const base = { settings, recurring: [], goals: [], moves: [] };
    expect(monthStats({ ...base, txs: [tx({ amount: 320000 })] }, 'CHF', '2026-11').level).toBe('warn');
    expect(monthStats({ ...base, txs: [tx({ amount: 400001 })] }, 'CHF', '2026-11').level).toBe('over');
  });
  it("l'épargne n'est pas une dépense", () => {
    const goal: Goal = { id: 'g', name: 'Voyage', currency: 'CHF', target: 100000, order: 0, createdAt: now, updatedAt: now };
    const moves: Move[] = [{ id: 'm', goalId: 'g', date: '2026-11-05', amount: 20000, createdAt: now }];
    const s = monthStats({ settings, txs: [], recurring: [], goals: [goal], moves }, 'CHF', '2026-11');
    expect(s.savingsIn).toBe(20000);
    expect(s.remaining).toBe(400000);
  });
});

describe('échéances', () => {
  it('calcule la date limite de résiliation', () => {
    expect(noticeDeadline('2026-12-31', 3, 'months')).toBe('2026-09-30');
    expect(noticeDeadline('2026-06-30', 3, 'months')).toBe('2026-03-31');
    expect(noticeDeadline('2026-12-31', 1, 'months')).toBe('2026-11-30');
    expect(noticeDeadline('2026-12-31', 30, 'days')).toBe('2026-12-01');
  });
  const dl = (p: Partial<Deadline>): Deadline => ({ id: Math.random().toString(36), title: 't', date: '2026-11-30', type: 'bill', status: 'todo', docIds: [], frequency: 'none', createdAt: now, updatedAt: now, ...p });
  it('met les retards en premier', () => {
    const list = sortDeadlines([dl({ title: 'b', date: '2026-11-25' }), dl({ title: 'a', date: '2026-11-01' }), dl({ title: 'c', date: '2026-11-24' })], '2026-11-23');
    expect(list.map((d) => d.title)).toEqual(['a', 'c', 'b']);
  });
  it('rappels manqués depuis la dernière visite', () => {
    const d = dl({ date: '2026-11-23' });
    const last = new Date(2026, 10, 21, 12).getTime();
    const nowMs = new Date(2026, 10, 23, 9).getTime();
    expect(missedReminders([d], '18:00', last, nowMs, {})).toHaveLength(1);
    expect(reminderAt(d, '18:00')).toBe(new Date(2026, 10, 22, 18).getTime());
  });
  it('prochaine occurrence depuis la date d’origine', () => {
    expect(nextDate(dl({ frequency: 'monthly', date: '2026-11-17', originalDate: '2026-11-15' }))).toBe('2026-12-15');
    expect(nextDate(dl({ frequency: 'yearly', date: '2026-11-15' }))).toBe('2027-11-15');
    expect(nextDate(dl({ frequency: 'none' }))).toBeNull();
  });
  it('export ics avec rappel la veille à 18 h', () => {
    const ics = deadlinesToICS([dl({ title: 'Facture, électricité', date: '2026-11-30' })], '18:00');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261130');
    expect(ics).toContain('TRIGGER:-PT6H');
    expect(ics).toContain('SUMMARY:Facture\\, électricité');
  });
});

describe('import CSV', () => {
  const sample = [
    'Compte;CH93 0076 2011 6238 5295 7',
    'Période;01.11.2026 - 23.11.2026',
    '',
    'Date;Texte de notification;Crédit en CHF;Débit en CHF;Valeur;Solde en CHF',
    '03.11.2026;"Achat Migros Genève";;-45.60;03.11.2026;1000.00',
    '05.11.2026;Remboursement CSS Assurance;120.00;;05.11.2026;1120.00',
    '07.11.2026;Swisscom facture;;-59.90;07.11.2026;1060.10',
    '08.11.2026;Ligne cassée;;abc;;',
    'xx;Mauvaise date;;-1.00;;',
  ].join('\r\n');

  it('détecte séparateur, en-tête et colonnes', () => {
    const d = detectDelimiter(sample);
    expect(d).toBe(';');
    const rows = parseCSV(sample, d);
    const h = detectHeaderRow(rows);
    expect(rows[h][0]).toBe('Date');
    const cols = analyzeColumns(rows[h], rows.slice(h + 1));
    const map = guessMapping(cols);
    expect(map.mode).toBe('split');
    expect(cols[map.date].name).toBe('Date');
    expect(cols[map.label].name).toBe('Texte de notification');
    const parsed = extractRows(rows, h, map);
    expect(parsed.filter((p) => p.ok)).toHaveLength(3);
    expect(parsed.filter((p) => !p.ok)).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ date: '2026-11-03', amount: 4560, credit: false });
    expect(parsed[1]).toMatchObject({ amount: 12000, credit: true });
  });

  it('montant unique, dates jj/mm/aaaa, montants à la française', () => {
    const csv = 'Date opération,Libellé,Montant\n02/11/2026,"MARJANE, CASA",-"1 234,50"\n15/11/2026,Virement reçu,"500,00"';
    const fixed = csv.replace('-"1 234,50"', '"-1 234,50"');
    const d = detectDelimiter(fixed);
    expect(d).toBe(',');
    const rows = parseCSV(fixed, d);
    const map = guessMapping(analyzeColumns(rows[0], rows.slice(1)));
    const parsed = extractRows(rows, 0, map);
    expect(parsed[0]).toMatchObject({ ok: true, date: '2026-11-02', amount: 123450, credit: false, label: 'MARJANE, CASA' });
    expect(parsed[1]).toMatchObject({ ok: true, credit: true, amount: 50000 });
  });

  it('masque les numéros dans les libellés et décode le latin-1', () => {
    const csv = 'Date;Libellé;Montant\n01.11.2026;Virement CH93 0076 2011 6238 5295 7 Loyer;-1500.00';
    const rows = parseCSV(csv, ';');
    const parsed = extractRows(rows, 0, guessMapping(analyzeColumns(rows[0], rows.slice(1))));
    expect(parsed[0].label).toBe('Virement [numéro masqué] Loyer');
    expect(parsed[0].maskedCount).toBe(1);
    const latin = new Uint8Array([0x44, 0xe9, 0x62, 0x69, 0x74]); // "Débit" en windows-1252
    expect(decodeBytes(latin.buffer)).toBe('Débit');
  });

  it('repère les colonnes sensibles', () => {
    const csv = 'Date;IBAN;Libellé;Montant\n01.11.2026;CH9300762011623852957;Coop;-10.00\n02.11.2026;CH9300762011623852957;Coop;-12.00';
    const rows = parseCSV(csv, ';');
    const cols = analyzeColumns(rows[0], rows.slice(1));
    expect(cols[1].sensitive).toBe(true);
    expect(guessMapping(cols).label).toBe(2);
  });

  it('signale les doublons et les charges fixes', () => {
    const existing = [tx({ date: '2026-11-03', amount: 4560, label: 'Migros' })];
    expect(findDuplicate({ date: '2026-11-03', amount: 4560, label: 'Achat Migros Genève' }, 'CHF', existing)).not.toBeNull();
    expect(findDuplicate({ date: '2026-11-03', amount: 4560, label: 'x' }, 'MAD', existing)).toBeNull();
    expect(findDuplicate({ date: '2026-11-05', amount: 4560, label: 'Migros Genève' }, 'CHF', existing)).not.toBeNull();
    const occ = occurrencesForMonth([rec({})], [], '2026-11');
    expect(matchOccurrence({ date: '2026-11-02', amount: 150000, label: 'Ordre permanent Régie' }, occ)?.rec.id).toBe('r1');
    expect(matchOccurrence({ date: '2026-11-02', amount: 4000, label: 'Coop' }, occ)).toBeNull();
  });

  it('propose une catégorie', () => {
    const cats: Category[] = ['alimentation', 'transport', 'abonnements', 'divers'].map((id, i) => ({ id, kind: 'expense', name: id, order: i }));
    expect(suggestCategory('Achat Migros Genève', cats, {})).toBe('alimentation');
    expect(suggestCategory('CFF billet', cats, {})).toBe('transport');
    expect(suggestCategory('Netflix.com', cats, {})).toBe('abonnements');
    expect(suggestCategory('Boutique Truc', cats, { [labelKey('Boutique Truc')]: 'divers' })).toBe('divers');
    expect(suggestCategory('Inconnu', cats, {})).toBeNull();
  });
});

describe('chiffrement', () => {
  it('chiffre et déchiffre une sauvegarde', async () => {
    const data = new TextEncoder().encode('{"hello":"monde"}');
    const env = await encryptBytes(data, 'mot de passe solide', 1000);
    expect(env.payload).not.toContain('hello');
    const back = await decryptBytes(env, 'mot de passe solide');
    expect(new TextDecoder().decode(back)).toBe('{"hello":"monde"}');
    await expect(decryptBytes(env, 'faux')).rejects.toThrow('Mot de passe incorrect');
  });
  it('empreinte de code PIN stable', async () => {
    const salt = 'AAAAAAAAAAAAAAAAAAAAAA==';
    expect(await hashPin('1234', salt, 1000)).toBe(await hashPin('1234', salt, 1000));
    expect(await hashPin('1234', salt, 1000)).not.toBe(await hashPin('1235', salt, 1000));
  });
});

describe('épargne', () => {
  const g: Goal = { id: 'g', name: 'Appartement', currency: 'MAD', target: 1200000, targetDate: '2027-10-31', order: 0, createdAt: now, updatedAt: now };
  it('progression et mensualité', () => {
    const moves: Move[] = [{ id: '1', goalId: 'g', date: '2026-11-01', amount: 200000, createdAt: now }, { id: '2', goalId: 'g', date: '2026-11-02', amount: -50000, createdAt: now }];
    const p = goalProgress(g, moves);
    expect(p.current).toBe(150000);
    const m = monthlyNeeded(g, p.current, '2026-11-23')!;
    expect(m.months).toBe(12);
    expect(m.perMonth).toBe(Math.ceil((1200000 - 150000) / 12));
  });
});
