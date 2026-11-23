import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { data, loadAll } from '../../src/db/store';
import { addTx, payOccurrence, saveRecurring, completeDeadline, saveDeadline, newDeadline, saveDoc, setBudget, postpone, addMove, saveGoal, deleteCategory, purgeTrash } from '../../src/db/actions';
import { buildBackup, decodeBackup, readBackupFile, restoreBackup, summarize } from '../../src/db/backup';
import { toasts } from '../../src/ui/feedback';
import { monthStats } from '../../src/lib/budget';
import { occurrencesForMonth } from '../../src/lib/recurring';
import { currentMonth, today, addDays } from '../../src/lib/dates';
import type { Recurring, Doc, Goal } from '../../src/db/schema';

const stats = (cur: 'CHF' | 'MAD') => monthStats(data.value, cur, currentMonth());

describe('store', () => {
  beforeAll(async () => {
    await loadAll();
  });

  it('initialise les catégories par défaut', () => {
    expect(data.value.categories.filter((c) => c.kind === 'expense')).toHaveLength(10);
    expect(data.value.categories.filter((c) => c.kind === 'doc')).toHaveLength(8);
  });

  it('ajoute une dépense et permet d’annuler', async () => {
    await setBudget('CHF', 300000);
    await addTx({ amount: 1250, currency: 'CHF', categoryId: 'alimentation', source: 'quick' });
    expect(stats('CHF').confirmed).toBe(1250);
    const t = toasts.value[toasts.value.length - 1];
    expect(t.action?.label).toBe('Annuler');
    t.action!.run();
    await new Promise((r) => setTimeout(r, 20));
    expect(stats('CHF').confirmed).toBe(0);
    expect(stats('MAD').confirmed).toBe(0);
  });

  it('charge fixe : prévue puis payée avec montant réel, sans double comptage', async () => {
    const rec: Recurring = {
      id: 'wifi', name: 'Wi-Fi', currency: 'CHF', categoryId: 'abonnements', day: 28, frequency: 1, startDate: `${currentMonth()}-01`,
      amounts: [{ from: currentMonth(), amount: 5990 }], overrides: {}, pauses: [], createdAt: '', updatedAt: '',
    };
    await saveRecurring(rec, true);
    expect(stats('CHF').planned).toBe(5990);
    const occ = occurrencesForMonth(data.value.recurring, data.value.txs, currentMonth())[0];
    await payOccurrence(occ, 6420, today(), false);
    const s = stats('CHF');
    expect(s.planned).toBe(0);
    expect(s.confirmed).toBe(6420);
    expect(s.remaining).toBe(300000 - 6420);
    // le montant de base des mois suivants n'a pas changé
    expect(data.value.recurring[0].amounts.at(-1)!.amount).toBe(5990);
  });

  it('échéance récurrente : la suivante est créée, la facture peut créer une dépense', async () => {
    const d = await saveDeadline(newDeadline({ title: 'Électricité', date: addDays(today(), 1), type: 'bill', frequency: 'monthly', amount: 8000, currency: 'CHF' }), true);
    const next = await completeDeadline(d, { amount: 8350, currency: 'CHF', categoryId: 'logement', date: today() });
    expect(next).not.toBeNull();
    expect(data.value.deadlines.find((x) => x.id === d.id)!.status).toBe('done');
    expect(data.value.txs.some((t) => t.deadlineId === d.id && t.amount === 8350)).toBe(true);
    await postpone(next!, 7);
    const moved = data.value.deadlines.find((x) => x.id === next!.id)!;
    expect(moved.date).toBe(addDays(next!.date, 7));
    expect(moved.originalDate).toBe(next!.date);
  });

  it('résiliation : la date de l’échéance est la date limite de préavis', async () => {
    const d = await saveDeadline(newDeadline({ title: 'Assurance ménage', type: 'contract', frequency: 'yearly', contract: { endDate: '2027-12-31', noticeValue: 3, noticeUnit: 'months', manual: false } }), true);
    expect(d.date).toBe('2027-09-30');
  });

  it('document avec expiration : une seule échéance liée, mise à jour', async () => {
    const doc: Doc = { id: 'pass', title: 'Passeport', country: 'CH', categoryId: 'doc-identite', expiryDate: '2030-05-01', createdAt: '', updatedAt: '' };
    await saveDoc(doc, true);
    let linked = data.value.deadlines.filter((x) => x.sourceDocId === 'pass' && !x.deletedAt);
    expect(linked).toHaveLength(1);
    expect(linked[0].type).toBe('expiry');
    await saveDoc({ ...doc, expiryDate: '2031-06-01' }, false);
    linked = data.value.deadlines.filter((x) => x.sourceDocId === 'pass' && !x.deletedAt);
    expect(linked).toHaveLength(1);
    expect(linked[0].date).toBe('2031-06-01');
  });

  it('épargne : objectif atteint', async () => {
    const g: Goal = { id: 'g1', name: 'Voyage', currency: 'MAD', target: 100000, order: 0, createdAt: '', updatedAt: '' };
    await saveGoal(g, true, 50000);
    await addMove(data.value.goals.find((x) => x.id === 'g1')!, 60000, today());
    expect(data.value.goals.find((x) => x.id === 'g1')!.achievedAt).toBeTruthy();
    expect(stats('MAD').savingsIn).toBe(110000);
    expect(stats('MAD').remaining).toBeNull(); // pas de budget MAD défini
  });

  it('suppression de catégorie utilisée : reclassement', async () => {
    const cat = data.value.categories.find((c) => c.id === 'abonnements')!;
    await deleteCategory(cat, 'divers');
    expect(data.value.txs.filter((t) => t.categoryId === 'abonnements' && !t.deletedAt)).toHaveLength(0);
    expect(data.value.recurring[0].categoryId).toBe('divers');
    expect(await purgeTrash(30)).toBe(0);
  });

  it('sauvegarde chiffrée : aller-retour complet', async () => {
    const snap = () => { const by = (l: any[]) => [...l].sort((a, b) => a.id.localeCompare(b.id)); return JSON.stringify({ txs: by(data.value.txs), deadlines: by(data.value.deadlines), docs: by(data.value.docs), s: data.value.settings.budgets }); };
    const before = snap();
    const { blob, filename } = await buildBackup({ password: 'test-1234', includeFiles: true });
    expect(filename).toContain('chiffree');
    const text = await blob.text();
    expect(text).not.toContain('Électricité');
    const file = new File([text], filename, { type: 'application/json' });
    const { encrypted, raw } = await readBackupFile(file);
    expect(encrypted).toBe(true);
    await expect(decodeBackup(raw, 'mauvais')).rejects.toThrow();
    const plain = await decodeBackup(raw, 'test-1234');
    expect(summarize(plain).counts.deadlines).toBeGreaterThan(0);
    await restoreBackup(plain);
    await loadAll();
    expect(snap()).toBe(before);
  });
});
