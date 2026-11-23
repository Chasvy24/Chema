// Opérations métier : chaque action écrit localement, affiche un message clair
// et, quand c'est pertinent, propose « Annuler ».

import { data, commit, put, setSettings, uid, nowStamp, type Change } from './store';
import type { Category, Deadline, Doc, Goal, Move, Recurring, Tx, ID, DeadlineStatus } from './schema';
import type { Currency } from '../lib/money';
import { fmtMoney } from '../lib/money';
import { addDays, addMonths as addMonthsSafe, currentMonth, fmtDate, monthOf, today, type ISODate, type MonthKey } from '../lib/dates';
import { labelKey } from '../lib/categorize';
import { txMonth } from '../lib/budget';
import type { Occurrence } from '../lib/recurring';
import { nextDate, noticeDeadline } from '../lib/deadlines';
import { goalProgress } from '../lib/savings';
import { choose, confirmAction, toast } from '../ui/feedback';
import { deleteFiles } from './files';

// ---------- Sélecteurs ----------

export const alive = <T extends { deletedAt?: string }>(list: T[]) => list.filter((x) => !x.deletedAt);

export function categoriesOf(kind: Category['kind']): Category[] {
  return alive(data.value.categories)
    .filter((c) => c.kind === kind)
    .sort((a, b) => a.order - b.order);
}

export function catName(id: string | null | undefined): string {
  if (!id) return 'Sans catégorie';
  return data.value.categories.find((c) => c.id === id)?.name ?? 'Sans catégorie';
}

export const findTx = (id: ID) => data.value.txs.find((t) => t.id === id);
export const findDoc = (id: ID) => data.value.docs.find((d) => d.id === id);
export const findDeadline = (id: ID) => data.value.deadlines.find((d) => d.id === id);
export const findGoal = (id: ID) => data.value.goals.find((g) => g.id === id);
export const findRecurring = (id: ID) => data.value.recurring.find((r) => r.id === id);

export function receiptsCategoryId(): ID {
  return data.value.categories.find((c) => c.system === 'receipts')?.id ?? 'doc-recus';
}

// ---------- Opérations (dépenses, remboursements, entrées) ----------

export interface TxInput {
  kind?: Tx['kind'];
  amount: number;
  currency: Currency;
  categoryId: ID | null;
  label?: string;
  date?: ISODate;
  month?: MonthKey;
  note?: string;
  docIds?: ID[];
  receiptDocId?: ID;
  refundOf?: ID;
  occurrence?: string;
  deadlineId?: ID;
  source: Tx['source'];
}

export function makeTx(input: TxInput): Tx {
  const date = input.date ?? today();
  const month = input.month && input.month !== monthOf(date) ? input.month : undefined;
  return {
    id: uid(),
    kind: input.kind ?? 'expense',
    date,
    ...(month ? { month } : {}),
    amount: Math.abs(input.amount),
    currency: input.currency,
    categoryId: input.categoryId,
    label: (input.label ?? '').trim() || catName(input.categoryId),
    note: input.note?.trim() || undefined,
    docIds: input.docIds ?? [],
    receiptDocId: input.receiptDocId,
    refundOf: input.refundOf,
    occurrence: input.occurrence,
    deadlineId: input.deadlineId,
    source: input.source,
    createdAt: nowStamp(),
    updatedAt: nowStamp(),
  };
}

function learnChange(label: string, categoryId: ID | null, currency?: Currency): Change {
  const s = data.value.settings;
  const rules = { ...s.labelRules };
  const key = labelKey(label);
  if (key && categoryId) rules[key] = categoryId;
  return setSettings({ labelRules: rules, ...(currency ? { lastCurrency: currency } : {}) });
}

export async function addTx(input: TxInput, extra: Change[] = [], message?: string): Promise<Tx> {
  const t = makeTx(input);
  const changes: Change[] = [put('txs', t), ...extra];
  if (t.kind === 'expense') changes.push(learnChange(t.label, t.categoryId, t.currency));
  await commit(changes, { message: message ?? `${t.kind === 'expense' ? 'Dépense' : t.kind === 'refund' ? 'Remboursement' : 'Entrée'} enregistrée : ${fmtMoney(t.amount, t.currency)}`, undo: true });
  return t;
}

export async function updateTx(t: Tx, patch: Partial<Tx>): Promise<void> {
  const next: Tx = { ...t, ...patch, updatedAt: nowStamp() };
  if (next.month && next.month === monthOf(next.date)) delete next.month;
  const changes: Change[] = [put('txs', next)];
  if (patch.categoryId !== undefined && patch.categoryId !== t.categoryId && next.kind === 'expense') changes.push(learnChange(next.label, next.categoryId));
  const receipt = t.receiptDocId ? findDoc(t.receiptDocId) : undefined;
  await commit(changes, { message: receipt && !receipt.deletedAt ? 'Opération modifiée. Le reçu lié reste inchangé dans le coffre.' : 'Opération modifiée', undo: true });
}

export async function deleteTx(t: Tx): Promise<boolean> {
  const receipt = t.receiptDocId ? findDoc(t.receiptDocId) : undefined;
  const refunds = alive(data.value.txs).filter((x) => x.refundOf === t.id);
  const otherDocs = t.docIds.map(findDoc).filter((d): d is Doc => !!d && !d.deletedAt && d.id !== t.receiptDocId);
  const details: string[] = [];
  if (refunds.length) details.push(`${refunds.length} remboursement(s) lié(s) seront aussi supprimés.`);
  if (t.occurrence) details.push('La charge fixe de ce mois redeviendra « prévue ».');
  if (otherDocs.length) details.push(`Les documents liés (${otherDocs.map((d) => d.title).join(', ')}) restent dans le coffre.`);
  details.push('Restauration possible depuis Réglages › Corbeille pendant 30 jours.');
  let withReceipt = false;
  if (receipt && !receipt.deletedAt) {
    const v = await choose(
      'Supprimer cette dépense ?',
      `${t.label} · ${fmtMoney(t.amount, t.currency)}. Elle a un reçu associé : « ${receipt.title} ». Que faire du reçu ?`,
      [
        { value: 'keep', label: 'Supprimer la dépense, garder le reçu', tone: 'primary' },
        { value: 'both', label: 'Supprimer la dépense et le reçu', tone: 'danger' },
      ],
      { details },
    );
    if (!v) return false;
    withReceipt = v === 'both';
  } else {
    const v = await choose('Supprimer cette opération ?', `${t.label} · ${fmtMoney(t.amount, t.currency)} du ${fmtDate(t.date)}.`, [{ value: 'yes', label: 'Supprimer', tone: 'danger' }], { details });
    if (!v) return false;
  }
  const stamp = nowStamp();
  const changes: Change[] = [put('txs', { ...t, deletedAt: stamp }), ...refunds.map((r) => put('txs', { ...r, deletedAt: stamp }))];
  if (withReceipt && receipt) changes.push(put('docs', { ...receipt, deletedAt: stamp }));
  await commit(changes, { message: withReceipt ? 'Dépense et reçu placés dans la corbeille' : receipt ? 'Dépense supprimée — le reçu reste dans le coffre' : 'Opération supprimée', undo: true });
  return true;
}

export async function addRefund(orig: Tx, amount: number, date: ISODate, countIn: 'expense' | 'refund', note?: string): Promise<void> {
  const month = countIn === 'expense' ? txMonth(orig) : monthOf(date);
  await addTx(
    { kind: 'refund', amount, currency: orig.currency, categoryId: orig.categoryId, label: `Remboursement : ${orig.label}`, date, month, refundOf: orig.id, note, source: 'manual' },
    [],
    `Remboursement de ${fmtMoney(amount, orig.currency)} enregistré — il réduit le total « ${catName(orig.categoryId)} »`,
  );
}

// ---------- Charges fixes ----------

export function withBaseFrom(rec: Recurring, month: MonthKey, amount: number): Recurring {
  const amounts = rec.amounts.filter((a) => a.from < month);
  amounts.push({ from: month, amount });
  return { ...rec, amounts, updatedAt: nowStamp() };
}

export async function payOccurrence(occ: Occurrence, amount: number, date: ISODate, updateBase: boolean): Promise<void> {
  const rec = occ.rec;
  const extra: Change[] = [];
  if (updateBase && amount !== occ.baseAmount) extra.push(put('recurring', withBaseFrom(rec, occ.month, amount)));
  const t = makeTx({ amount, currency: rec.currency, categoryId: rec.categoryId, label: rec.name, date, month: occ.month, occurrence: occ.key, source: 'recurring' });
  await commit([put('txs', t), ...extra], {
    message: `${rec.name} payée : ${fmtMoney(amount, rec.currency)}${updateBase && amount !== occ.baseAmount ? ' · nouveau montant de base' : ''}`,
    undo: true,
  });
}

export async function setOccurrence(rec: Recurring, month: MonthKey, patch: { amount?: number | null; skipped?: boolean }, message: string): Promise<void> {
  const cur = { ...(rec.overrides[month] ?? {}) };
  if (patch.amount === null) delete cur.amount;
  else if (patch.amount !== undefined) cur.amount = patch.amount;
  if (patch.skipped !== undefined) {
    if (patch.skipped) cur.skipped = true;
    else delete cur.skipped;
  }
  const overrides = { ...rec.overrides };
  if (Object.keys(cur).length) overrides[month] = cur;
  else delete overrides[month];
  await commit([put('recurring', { ...rec, overrides, updatedAt: nowStamp() })], { message, undo: true });
}

export async function saveRecurring(rec: Recurring, isNew: boolean): Promise<void> {
  await commit([put('recurring', { ...rec, updatedAt: nowStamp() })], { message: isNew ? `Charge fixe « ${rec.name} » créée` : 'Charge fixe modifiée', undo: true });
}

export async function pauseRecurring(rec: Recurring): Promise<void> {
  await commit([put('recurring', { ...rec, pauses: [...rec.pauses, { from: today() }], updatedAt: nowStamp() })], {
    message: `« ${rec.name} » suspendue : plus aucune occurrence prévue à partir d’aujourd’hui`,
    undo: true,
  });
}

export async function resumeRecurring(rec: Recurring): Promise<void> {
  const pauses = rec.pauses.map((p) => (p.to ? p : { ...p, to: today() }));
  await commit([put('recurring', { ...rec, pauses, updatedAt: nowStamp() })], { message: `« ${rec.name} » reprise`, undo: true });
}

export async function deleteRecurring(rec: Recurring): Promise<boolean> {
  const ok = await confirmAction(
    `Supprimer « ${rec.name} » ?`,
    'Les occurrences futures et non payées disparaîtront. Les paiements déjà confirmés restent dans l’historique. Pour arrêter temporairement, utilisez plutôt « Suspendre ».',
    'Supprimer',
    true,
  );
  if (!ok) return false;
  await commit([put('recurring', { ...rec, deletedAt: nowStamp() })], { message: 'Charge fixe placée dans la corbeille', undo: true });
  return true;
}

// ---------- Échéances ----------

export function newDeadline(p: Partial<Deadline>): Deadline {
  return {
    id: uid(),
    title: '',
    date: addDays(today(), 7),
    type: 'bill',
    status: 'todo',
    docIds: [],
    frequency: 'none',
    createdAt: nowStamp(),
    updatedAt: nowStamp(),
    ...p,
  };
}

function normalizeDeadline(d: Deadline): Deadline {
  const out = { ...d, updatedAt: nowStamp() };
  if (out.contract && !out.contract.manual) out.date = noticeDeadline(out.contract.endDate, out.contract.noticeValue, out.contract.noticeUnit);
  return out;
}

export async function saveDeadline(d: Deadline, isNew: boolean): Promise<Deadline> {
  const n = normalizeDeadline(d);
  await commit([put('deadlines', n)], { message: isNew ? `Échéance ajoutée pour le ${fmtDate(n.date)}` : 'Échéance modifiée', undo: true });
  return n;
}

export async function setDeadlineStatus(d: Deadline, status: DeadlineStatus): Promise<void> {
  await commit([put('deadlines', { ...d, status, completedAt: status === 'done' ? nowStamp() : undefined, updatedAt: nowStamp() })], {
    message: status === 'doing' ? 'Statut : en cours' : status === 'todo' ? 'Statut : à faire' : 'Échéance terminée',
    undo: true,
  });
}

export async function postpone(d: Deadline, days: number): Promise<void> {
  const date = addDays(d.date < today() ? today() : d.date, days);
  await commit([put('deadlines', { ...d, originalDate: d.originalDate ?? d.date, date, updatedAt: nowStamp() })], {
    message: `Reportée au ${fmtDate(date)}`,
    undo: true,
  });
}

export function buildNext(d: Deadline): Deadline | null {
  const nd = nextDate(d);
  if (!nd) return null;
  const months = { none: 0, monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 }[d.frequency];
  let contract = d.contract;
  let date = nd;
  if (contract) {
    contract = { ...contract, endDate: addMonthsSafe(contract.endDate, months) };
    date = contract.manual ? addMonthsSafe(d.originalDate ?? d.date, months) : noticeDeadline(contract.endDate, contract.noticeValue, contract.noticeUnit);
  }
  return {
    ...d,
    id: uid(),
    date,
    contract,
    status: 'todo',
    originalDate: undefined,
    completedAt: undefined,
    nextId: undefined,
    createdAt: nowStamp(),
    updatedAt: nowStamp(),
  };
}


export async function completeDeadline(d: Deadline, expense?: { amount: number; currency: Currency; categoryId: ID | null; date: ISODate }): Promise<Deadline | null> {
  const next = d.nextId && findDeadline(d.nextId) && !findDeadline(d.nextId)!.deletedAt ? null : buildNext(d);
  const done: Deadline = { ...d, status: 'done', completedAt: nowStamp(), updatedAt: nowStamp(), ...(next ? { nextId: next.id } : {}) };
  const changes: Change[] = [put('deadlines', done)];
  if (next) changes.push(put('deadlines', next));
  if (expense) {
    const t = makeTx({ amount: expense.amount, currency: expense.currency, categoryId: expense.categoryId, label: d.title, date: expense.date, deadlineId: d.id, docIds: [...d.docIds], source: 'deadline' });
    changes.push(put('txs', t));
  }
  const parts = ['Échéance terminée'];
  if (expense) parts.push(`dépense de ${fmtMoney(expense.amount, expense.currency)} ajoutée au budget ${expense.currency}`);
  if (next) parts.push(`nouvelle échéance créée pour le ${fmtDate(next.date)}`);
  await commit(changes, { message: parts.join(' · '), undo: true });
  return next;
}

export async function reopenDeadline(d: Deadline): Promise<void> {
  await commit([put('deadlines', { ...d, status: 'todo', completedAt: undefined, updatedAt: nowStamp() })], { message: 'Échéance rouverte', undo: true });
}

export async function deleteDeadline(d: Deadline): Promise<boolean> {
  const msg = d.sourceDocId
    ? 'Le document lié reste dans le coffre, mais sa date d’expiration ne sera plus rappelée (elle sera recréée si vous modifiez cette date dans le document).'
    : 'Vous pourrez la restaurer depuis Réglages › Corbeille pendant 30 jours.';
  if (!(await confirmAction(`Supprimer « ${d.title} » ?`, msg, 'Supprimer', true))) return false;
  await commit([put('deadlines', { ...d, deletedAt: nowStamp() })], { message: 'Échéance supprimée', undo: true });
  return true;
}

// ---------- Documents ----------

export function expiryDeadlineOf(docId: ID): Deadline | undefined {
  return data.value.deadlines.find((d) => d.sourceDocId === docId && !d.deletedAt);
}

/** Crée, met à jour ou retire l'échéance « Fin de validité » liée au document. */
export function syncExpiry(doc: Doc): { changes: Change[]; note: string } {
  const existing = expiryDeadlineOf(doc.id);
  if (doc.expiryDate && !doc.deletedAt) {
    const title = `Fin de validité : ${doc.title}`;
    if (existing) {
      if (existing.date === doc.expiryDate && existing.title === title) return { changes: [], note: '' };
      const reopen = existing.status === 'done' && doc.expiryDate >= today() && existing.date !== doc.expiryDate;
      return {
        changes: [put('deadlines', { ...existing, title, date: doc.expiryDate, originalDate: undefined, ...(reopen ? { status: 'todo' as const, completedAt: undefined } : {}), updatedAt: nowStamp() })],
        note: existing.date !== doc.expiryDate ? `échéance de validité déplacée au ${fmtDate(doc.expiryDate)}` : '',
      };
    }
    const d = newDeadline({ title, date: doc.expiryDate, type: 'expiry', docIds: [doc.id], sourceDocId: doc.id });
    return { changes: [put('deadlines', d)], note: `échéance « Fin de validité » créée pour le ${fmtDate(doc.expiryDate)}` };
  }
  if (existing && !doc.expiryDate) {
    return { changes: [put('deadlines', { ...existing, deletedAt: nowStamp() })], note: 'échéance de validité retirée' };
  }
  return { changes: [], note: '' };
}

export async function saveDoc(doc: Doc, isNew: boolean, extra: Change[] = []): Promise<void> {
  const d = { ...doc, updatedAt: nowStamp() };
  const sync = syncExpiry(d);
  await commit([put('docs', d), ...sync.changes, ...extra], {
    message: [isNew ? 'Document ajouté au coffre' : 'Document modifié', sync.note].filter(Boolean).join(' · '),
    undo: true,
  });
}

export function linksOfDoc(docId: ID) {
  const txs = alive(data.value.txs).filter((t) => t.docIds.includes(docId) || t.receiptDocId === docId);
  const deadlines = alive(data.value.deadlines).filter((d) => d.docIds.includes(docId) || d.sourceDocId === docId);
  return { txs, deadlines };
}

export async function deleteDoc(doc: Doc): Promise<boolean> {
  const { txs, deadlines } = linksOfDoc(doc.id);
  const exp = expiryDeadlineOf(doc.id);
  const details: string[] = [];
  if (txs.length) details.push(`Lié à ${txs.length} opération(s) : elles restent dans le budget, sans pièce jointe.`);
  const otherDl = deadlines.filter((d) => d.id !== exp?.id);
  if (otherDl.length) details.push(`Lié à ${otherDl.length} échéance(s) : elles restent, sans document.`);
  details.push('Restauration possible depuis Réglages › Corbeille pendant 30 jours.');
  const options = exp
    ? [
        { value: 'both', label: 'Supprimer le document et son échéance de validité', tone: 'danger' as const },
        { value: 'doc', label: 'Supprimer seulement le document', tone: 'plain' as const },
      ]
    : [{ value: 'doc', label: 'Supprimer le document', tone: 'danger' as const }];
  const v = await choose(`Supprimer « ${doc.title} » ?`, undefined, options, { details });
  if (!v) return false;
  const stamp = nowStamp();
  const changes: Change[] = [put('docs', { ...doc, deletedAt: stamp })];
  if (exp && v === 'both') changes.push(put('deadlines', { ...exp, deletedAt: stamp }));
  if (exp && v === 'doc') changes.push(put('deadlines', { ...exp, sourceDocId: undefined, docIds: exp.docIds.filter((x) => x !== doc.id), updatedAt: stamp }));
  await commit(changes, { message: 'Document placé dans la corbeille', undo: true });
  return true;
}

export async function linkDoc(docId: ID, target: { kind: 'tx' | 'deadline'; id: ID }, on: boolean): Promise<void> {
  if (target.kind === 'tx') {
    const t = findTx(target.id)!;
    const docIds = on ? Array.from(new Set([...t.docIds, docId])) : t.docIds.filter((x) => x !== docId);
    await commit([put('txs', { ...t, docIds, updatedAt: nowStamp() })], { message: on ? 'Document lié à l’opération' : 'Lien retiré', undo: true });
  } else {
    const d = findDeadline(target.id)!;
    const docIds = on ? Array.from(new Set([...d.docIds, docId])) : d.docIds.filter((x) => x !== docId);
    await commit([put('deadlines', { ...d, docIds, updatedAt: nowStamp() })], { message: on ? 'Document lié à l’échéance' : 'Lien retiré', undo: true });
  }
}

// ---------- Épargne ----------

export async function saveGoal(g: Goal, isNew: boolean, initial?: number): Promise<void> {
  const changes: Change[] = [put('goals', { ...g, updatedAt: nowStamp() })];
  if (isNew && initial && initial > 0) changes.push(put('moves', { id: uid(), goalId: g.id, date: today(), amount: initial, note: 'Montant de départ', createdAt: nowStamp() } as Move));
  await commit(changes, { message: isNew ? `Objectif « ${g.name} » créé` : 'Objectif modifié', undo: true });
  await checkAchieved(g.id);
}

async function checkAchieved(goalId: ID) {
  const g = findGoal(goalId);
  if (!g) return;
  const p = goalProgress(g, data.value.moves);
  if (p.reached && !g.achievedAt) {
    await commit([put('goals', { ...g, achievedAt: nowStamp() })]);
    toast(`Bravo ! Objectif « ${g.name} » atteint. Il passe dans « Réalisés ».`, { tone: 'ok', duration: 6000 });
  } else if (!p.reached && g.achievedAt) {
    await commit([put('goals', { ...g, achievedAt: undefined })]);
  }
}

export async function addMove(g: Goal, amount: number, date: ISODate, note?: string): Promise<void> {
  const m: Move = { id: uid(), goalId: g.id, date, amount, note: note?.trim() || undefined, createdAt: nowStamp() };
  await commit([put('moves', m)], { message: amount >= 0 ? `Versement de ${fmtMoney(amount, g.currency)} ajouté` : `Retrait de ${fmtMoney(-amount, g.currency)} enregistré`, undo: true });
  await checkAchieved(g.id);
}

export async function deleteMove(m: Move): Promise<void> {
  await commit([{ coll: 'moves', id: m.id, value: null }], { message: 'Mouvement supprimé', undo: true });
  await checkAchieved(m.goalId);
}

export async function deleteGoal(g: Goal): Promise<boolean> {
  if (!(await confirmAction(`Supprimer l’objectif « ${g.name} » ?`, 'Son historique sera conservé dans la corbeille pendant 30 jours.', 'Supprimer', true))) return false;
  await commit([put('goals', { ...g, deletedAt: nowStamp() })], { message: 'Objectif supprimé', undo: true });
  return true;
}

// ---------- Catégories ----------

export async function addCategory(kind: Category['kind'], name: string): Promise<Category> {
  const list = categoriesOf(kind);
  const c: Category = { id: uid(), kind, name: name.trim(), order: (list[list.length - 1]?.order ?? 0) + 1 };
  await commit([put('categories', c)], { message: `Catégorie « ${c.name} » ajoutée`, undo: true });
  return c;
}

export async function renameCategory(c: Category, name: string): Promise<void> {
  await commit([put('categories', { ...c, name: name.trim() })], { message: 'Catégorie renommée', undo: true });
}

export async function moveCategory(c: Category, dir: -1 | 1): Promise<void> {
  const list = categoriesOf(c.kind);
  const i = list.findIndex((x) => x.id === c.id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  const reordered = [...list];
  [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
  await commit(reordered.map((x, k) => put('categories', { ...x, order: k })));
}

export function categoryUsage(c: Category) {
  const d = data.value;
  if (c.kind === 'expense') {
    return {
      txs: alive(d.txs).filter((t) => t.categoryId === c.id).length,
      recurring: alive(d.recurring).filter((r) => r.categoryId === c.id).length,
      deadlines: alive(d.deadlines).filter((x) => x.categoryId === c.id).length,
      docs: 0,
    };
  }
  return { txs: 0, recurring: 0, deadlines: 0, docs: alive(d.docs).filter((x) => x.categoryId === c.id).length };
}

/** Supprime une catégorie ; si elle est utilisée, les éléments concernés sont reclassés dans `target`. */
export async function deleteCategory(c: Category, target: ID | null): Promise<void> {
  const d = data.value;
  const stamp = nowStamp();
  const changes: Change[] = [put('categories', { ...c, deletedAt: stamp })];
  if (c.kind === 'expense') {
    for (const t of d.txs) if (t.categoryId === c.id) changes.push(put('txs', { ...t, categoryId: target, updatedAt: stamp }));
    for (const r of d.recurring) if (r.categoryId === c.id) changes.push(put('recurring', { ...r, categoryId: target, updatedAt: stamp }));
    for (const x of d.deadlines) if (x.categoryId === c.id) changes.push(put('deadlines', { ...x, categoryId: target, updatedAt: stamp }));
    const budgets = { ...d.settings.budgets };
    for (const cur of ['CHF', 'MAD'] as Currency[]) {
      budgets[cur] = budgets[cur].map((e) => {
        if (!(c.id in e.caps)) return e;
        const caps = { ...e.caps };
        delete caps[c.id];
        return { ...e, caps };
      });
    }
    const rules = Object.fromEntries(Object.entries(d.settings.labelRules).filter(([, v]) => v !== c.id));
    changes.push(setSettings({ budgets, labelRules: rules }));
  } else if (target) {
    for (const x of d.docs) if (x.categoryId === c.id) changes.push(put('docs', { ...x, categoryId: target, updatedAt: stamp }));
  }
  await commit(changes, { message: `Catégorie « ${c.name} » supprimée${target ? ` — éléments reclassés dans « ${catName(target)} »` : ''}`, undo: true });
}

// ---------- Budgets ----------

export async function setBudget(cur: Currency, amount: number | null, caps?: Record<ID, number>): Promise<void> {
  const s = data.value.settings;
  const month = currentMonth();
  const list = [...(s.budgets[cur] ?? [])].sort((a, b) => a.from.localeCompare(b.from));
  const last = list.filter((e) => e.from <= month).pop() ?? list[0];
  const entry = { from: list.length ? month : '2000-01', amount: amount ?? last?.amount ?? 0, caps: caps ?? last?.caps ?? {} };
  const next = list.filter((e) => e.from < entry.from);
  next.push(entry);
  await commit([setSettings({ budgets: { ...s.budgets, [cur]: next } })], { message: `Budget ${cur} enregistré (à partir de ce mois)`, undo: true });
}

// ---------- Corbeille ----------

export interface TrashItem {
  coll: 'txs' | 'docs' | 'deadlines' | 'goals' | 'recurring';
  id: ID;
  label: string;
  detail: string;
  deletedAt: string;
}

export function trashItems(): TrashItem[] {
  const d = data.value;
  const out: TrashItem[] = [];
  for (const t of d.txs) if (t.deletedAt) out.push({ coll: 'txs', id: t.id, label: t.label, detail: `Opération · ${fmtMoney(t.amount, t.currency)} · ${fmtDate(t.date)}`, deletedAt: t.deletedAt });
  for (const x of d.docs) if (x.deletedAt) out.push({ coll: 'docs', id: x.id, label: x.title, detail: 'Document', deletedAt: x.deletedAt });
  for (const x of d.deadlines) if (x.deletedAt) out.push({ coll: 'deadlines', id: x.id, label: x.title, detail: `Échéance · ${fmtDate(x.date)}`, deletedAt: x.deletedAt });
  for (const x of d.goals) if (x.deletedAt) out.push({ coll: 'goals', id: x.id, label: x.name, detail: `Objectif ${x.currency}`, deletedAt: x.deletedAt });
  for (const x of d.recurring) if (x.deletedAt) out.push({ coll: 'recurring', id: x.id, label: x.name, detail: 'Charge fixe', deletedAt: x.deletedAt });
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Restaure l'élément et ceux supprimés en même temps (ex. dépense + reçu). */
export async function restoreTrash(item: TrashItem): Promise<void> {
  const d = data.value;
  const changes: Change[] = [];
  for (const coll of ['txs', 'docs', 'deadlines', 'goals', 'recurring'] as const) {
    for (const x of d[coll] as Array<{ id: string; deletedAt?: string }>) {
      if (x.deletedAt === item.deletedAt) changes.push(put(coll, { ...x, deletedAt: undefined }));
    }
  }
  await commit(changes, { message: changes.length > 1 ? `${changes.length} éléments restaurés` : `« ${item.label} » restauré`, undo: true });
  // Si un document restauré a une date d'expiration, on remet l'échéance liée en place.
  for (const c of changes) if (c.coll === 'docs' && c.value) {
    const sync = syncExpiry(c.value as Doc);
    if (sync.changes.length) await commit(sync.changes);
  }
}

/** Suppression définitive des éléments de la corbeille (plus anciens que `days` jours, ou tous). */
export async function purgeTrash(days: number | null): Promise<number> {
  const d = data.value;
  const limit = days === null ? null : new Date(Date.now() - days * 86400000).toISOString();
  const old = trashItems().filter((t) => limit === null || t.deletedAt < limit);
  if (!old.length) return 0;
  const ids = new Set(old.map((o) => o.id));
  const changes: Change[] = old.map((o) => ({ coll: o.coll, id: o.id, value: null }));
  const fileIds: string[] = [];
  for (const doc of d.docs) if (ids.has(doc.id) && doc.fileId) fileIds.push(doc.fileId);
  // Nettoie les liens vers les documents définitivement supprimés.
  for (const t of d.txs) {
    if (ids.has(t.id)) continue;
    const docIds = t.docIds.filter((x) => !ids.has(x));
    if (docIds.length !== t.docIds.length || (t.receiptDocId && ids.has(t.receiptDocId))) changes.push(put('txs', { ...t, docIds, receiptDocId: t.receiptDocId && ids.has(t.receiptDocId) ? undefined : t.receiptDocId }));
  }
  for (const x of d.deadlines) {
    if (ids.has(x.id)) continue;
    const docIds = x.docIds.filter((y) => !ids.has(y));
    if (docIds.length !== x.docIds.length) changes.push(put('deadlines', { ...x, docIds }));
  }
  // Mouvements d'épargne des objectifs supprimés
  for (const m of d.moves) if (ids.has(m.goalId)) changes.push({ coll: 'moves', id: m.id, value: null });
  await commit(changes);
  if (fileIds.length) await deleteFiles(fileIds);
  return old.length;
}
