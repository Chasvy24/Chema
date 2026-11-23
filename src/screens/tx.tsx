import { useEffect, useState } from 'preact/hooks';
import { Camera, ChevronDown, FileText, Link2, Paperclip, Receipt, RotateCcw, Trash2, Pencil, Repeat, CalendarClock } from 'lucide-preact';
import { data, put, uid, nowStamp } from '../db/store';
import { addTx, addRefund, alive, catName, categoriesOf, deleteTx, findDeadline, findDoc, findTx, receiptsCategoryId, updateTx } from '../db/actions';
import { saveFile, fileURL } from '../db/files';
import type { Doc, Tx } from '../db/schema';
import { AmountInput, CurrencySeg, DateInput, DateQuick, Field, Money, SensitiveWarning, Seg, SheetBody, useAmount } from '../ui/kit';
import { fmtDate, monthLabel, monthOf, today, type ISODate } from '../lib/dates';
import { fmtMoney, type Currency } from '../lib/money';
import { maskSensitive } from '../lib/sensitive';
import { suggestCategory } from '../lib/categorize';
import { txMonth } from '../lib/budget';
import { openSheet, go } from '../ui/router';
import { readReceipt, type ReceiptGuess } from '../services/ocr';
import { DocPicker } from './docs';

export function CategoryChips({ value, onChange }: { value: string | null; onChange: (id: string) => void }) {
  const cats = categoriesOf('expense');
  return (
    <div class="chips" role="group" aria-label="Catégorie">
      {cats.map((c) => (
        <button type="button" class="chip" aria-pressed={value === c.id} onClick={() => onChange(c.id)}>
          {c.name}
        </button>
      ))}
    </div>
  );
}

export function CategorySelect({ value, onChange, allowNone }: { value: string | null; onChange: (id: string | null) => void; allowNone?: boolean }) {
  return (
    <select class="input" value={value ?? ''} onChange={(e) => onChange((e.target as HTMLSelectElement).value || null)} aria-label="Catégorie">
      {allowNone && <option value="">Sans catégorie</option>}
      {categoriesOf('expense').map((c) => (
        <option value={c.id}>{c.name}</option>
      ))}
    </select>
  );
}

const clean = (s: string) => maskSensitive(s.trim()).text;

/** Saisie rapide : montant, monnaie, catégorie. Le reste est facultatif. */
export function ExpenseForm({ close, initial, receiptFile }: { close: () => void; initial?: Tx; receiptFile?: File }) {
  const s = data.value.settings;
  const editing = !!initial;
  const amt = useAmount(initial?.amount);
  const [cur, setCur] = useState<Currency>(initial?.currency ?? s.lastCurrency);
  const [cat, setCat] = useState<string | null>(initial?.categoryId ?? null);
  const [kind, setKind] = useState<Tx['kind']>(initial?.kind ?? 'expense');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [date, setDate] = useState<ISODate>(initial?.date ?? today());
  const [note, setNote] = useState(initial?.note ?? '');
  const [file, setFile] = useState<File | null>(receiptFile ?? null);
  const [preview, setPreview] = useState<string | null>(null);
  const [guess, setGuess] = useState<ReceiptGuess | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [labelTouched, setLabelTouched] = useState(false);

  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    readReceipt(file).then((g) => setGuess(g));
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // Proposition de catégorie depuis le libellé
  useEffect(() => {
    if (!labelTouched || cat || !label.trim()) return;
    const sug = suggestCategory(label, data.value.categories, s.labelRules);
    if (sug) setCat(sug);
  }, [label]);

  const valid = amt.cents !== null && amt.cents > 0 && (kind !== 'expense' || !!cat);

  async function save() {
    setTried(true);
    if (!valid || busy) return;
    setBusy(true);
    try {
      const base = { amount: amt.cents!, currency: cur, categoryId: cat, label: clean(label), date, note: clean(note) || undefined, kind };
      if (editing && initial) {
        await updateTx(initial, { ...base, label: base.label || catName(cat), month: initial.occurrence || initial.refundOf ? initial.month : undefined });
        close();
        return;
      }
      if (file) {
        const rec = await saveFile(file, file.name || 'ticket.jpg');
        const docId = uid();
        const title = `Ticket ${base.label || catName(cat)} — ${fmtDate(date)}`;
        const doc: Doc = { id: docId, title, country: cur === 'CHF' ? 'CH' : 'MA', categoryId: receiptsCategoryId(), fileId: rec.id, fileName: rec.name, mime: rec.mime, size: rec.size, createdAt: nowStamp(), updatedAt: nowStamp() };
        await addTx({ ...base, docIds: [docId], receiptDocId: docId, source: 'receipt' }, [put('docs', doc)], `Dépense enregistrée : ${fmtMoney(base.amount, cur)} · ticket rangé dans le coffre (Reçus)`);
      } else {
        await addTx({ ...base, source: label || note ? 'manual' : 'quick' });
      }
      close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetBody
      foot={
        <button class="btn primary big" onClick={save} disabled={busy}>
          {editing ? 'Enregistrer les modifications' : 'Enregistrer'}
        </button>
      }
    >
      {preview && (
        <div class="preview-box" style={{ maxHeight: 220, overflow: 'auto', marginBottom: 8 }}>
          <img src={preview} alt="Ticket" />
        </div>
      )}
      {file && guess && guess.amount && (
        <div class="callout blue">
          Lecture automatique (sur le téléphone, rien n’est envoyé) : <b>{fmtMoney(guess.amount, cur)}</b>
          {guess.date ? ` le ${fmtDate(guess.date)}` : ''}. À vérifier.
          <div class="row" style={{ marginTop: 8 }}>
            <button
              class="btn sm primary"
              onClick={() => {
                amt.setText(String(guess.amount! / 100));
                if (guess.date) setDate(guess.date);
              }}
            >
              Utiliser ces valeurs
            </button>
          </div>
        </div>
      )}
      {file && guess === null && (
        <p class="small muted" style={{ margin: '6px 0 0' }}>
          Pas de lecture automatique sur cet appareil : la photo est conservée, saisissez le montant ci-dessous.
        </p>
      )}
      {!editing && (
        <div style={{ marginTop: 6 }}>
          <Seg
            label="Type"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'expense', label: 'Dépense' },
              { value: 'income', label: 'Autre entrée' },
            ]}
          />
        </div>
      )}
      <Field label="Montant" error={tried && !(amt.cents && amt.cents > 0) ? 'Indiquez un montant.' : null}>
        <AmountInput text={amt.text} setText={amt.setText} big autoFocus={!editing} />
      </Field>
      <div style={{ marginTop: 12 }}>
        <CurrencySeg value={cur} onChange={setCur} />
      </div>
      <div class="field">
        <span class="lab">Catégorie{kind === 'income' ? ' (facultative)' : ''}</span>
        <CategoryChips value={cat} onChange={(id) => setCat(id === cat && kind === 'income' ? null : id)} />
        {tried && kind === 'expense' && !cat && <span class="error">Choisissez une catégorie.</span>}
      </div>
      {kind === 'income' && <p class="small muted">Une « autre entrée » apparaît dans le bilan du mois mais ne change pas votre budget. Pour un remboursement lié à une dépense, ouvrez la dépense puis « Remboursement ».</p>}

      <details class="more" open={editing || !!file}>
        <summary>
          <ChevronDown size={18} /> Plus de détails (libellé, date, note{editing ? '' : ', ticket'})
        </summary>
        <Field label="Libellé">
          <input
            class="input"
            value={label}
            placeholder="Ex. Migros, café, taxi…"
            onInput={(e) => {
              setLabel((e.target as HTMLInputElement).value);
              setLabelTouched(true);
            }}
          />
        </Field>
        <SensitiveWarning text={label} />
        <Field label="Date">
          <DateInput value={date} onChange={(v) => v && setDate(v)} />
        </Field>
        <DateQuick value={date} onChange={setDate} />
        <Field label="Note">
          <textarea class="input" value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
        </Field>
        <SensitiveWarning text={note} />
        {!editing && !file && (
          <label class="btn block" style={{ marginTop: 14 }}>
            <Camera size={20} /> Joindre une photo du ticket
            <input type="file" accept="image/*" class="sr-only" onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
          </label>
        )}
        {file && (
          <button class="btn block ghost" style={{ marginTop: 8 }} onClick={() => setFile(null)}>
            Retirer la photo
          </button>
        )}
      </details>
    </SheetBody>
  );
}

export function openExpense(initial?: Tx) {
  openSheet(initial ? 'Modifier l’opération' : 'Nouvelle dépense', (close) => <ExpenseForm close={close} initial={initial} />);
}

export function openReceipt(file: File) {
  openSheet('Ticket photographié', (close) => <ExpenseForm close={close} receiptFile={file} />);
}

// ---------- Remboursement ----------

function RefundForm({ orig, close }: { orig: Tx; close: () => void }) {
  const already = alive(data.value.txs)
    .filter((t) => t.refundOf === orig.id)
    .reduce((s, t) => s + t.amount, 0);
  const amt = useAmount(Math.max(0, orig.amount - already));
  const [date, setDate] = useState(today());
  const [countIn, setCountIn] = useState<'expense' | 'refund'>('expense');
  const [note, setNote] = useState('');
  const origMonth = txMonth(orig);
  const refundMonth = monthOf(date);
  const tooMuch = amt.cents !== null && amt.cents + already > orig.amount;
  return (
    <SheetBody
      foot={
        <button
          class="btn primary big"
          disabled={!amt.cents}
          onClick={async () => {
            await addRefund(orig, amt.cents!, date, countIn, clean(note));
            close();
          }}
        >
          Enregistrer le remboursement
        </button>
      }
    >
      <p class="muted small" style={{ marginTop: 0 }}>
        Pour : <b>{orig.label}</b> · {fmtMoney(orig.amount, orig.currency)} du {fmtDate(orig.date)} ({catName(orig.categoryId)}).
        {already > 0 && ` Déjà remboursé : ${fmtMoney(already, orig.currency)}.`}
      </p>
      <Field label={`Montant remboursé (${orig.currency})`}>
        <AmountInput text={amt.text} setText={amt.setText} big />
      </Field>
      {tooMuch && <div class="callout">Le total remboursé dépasserait la dépense d’origine. Vérifiez le montant.</div>}
      <Field label="Reçu le">
        <DateInput value={date} onChange={(v) => v && setDate(v)} />
      </Field>
      {origMonth !== refundMonth && (
        <div class="field">
          <span class="lab">Corriger quel mois ?</span>
          <Seg
            value={countIn}
            onChange={setCountIn}
            options={[
              { value: 'expense', label: `${monthLabel(origMonth)} (dépense)` },
              { value: 'refund', label: `${monthLabel(refundMonth)}` },
            ]}
          />
        </div>
      )}
      <Field label="Note (facultative)">
        <input class="input" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
      </Field>
      <p class="small muted">Le remboursement réduit le total de la catégorie « {catName(orig.categoryId)} » du mois choisi. Il n’est pas compté comme un revenu.</p>
    </SheetBody>
  );
}

// ---------- Détail d'une opération ----------

function Thumb({ fileId }: { fileId?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (fileId) fileURL(fileId, true).then(setUrl);
  }, [fileId]);
  return <div class="avatar thumb">{url ? <img src={url} alt="" /> : <FileText size={20} />}</div>;
}

export function TxDetail({ id, close }: { id: string; close: () => void }) {
  const t = findTx(id);
  if (!t || t.deletedAt) {
    return (
      <SheetBody>
        <p>Cette opération n’existe plus.</p>
      </SheetBody>
    );
  }
  const docs = t.docIds.map(findDoc).filter((d): d is Doc => !!d && !d.deletedAt);
  const refunds = alive(data.value.txs).filter((x) => x.refundOf === t.id);
  const orig = t.refundOf ? findTx(t.refundOf) : undefined;
  const dl = t.deadlineId ? findDeadline(t.deadlineId) : undefined;
  const rec = t.occurrence ? data.value.recurring.find((r) => t.occurrence!.startsWith(r.id + '@')) : undefined;
  const kindLabel = t.kind === 'expense' ? 'Dépense' : t.kind === 'refund' ? 'Remboursement' : 'Autre entrée';
  return (
    <SheetBody
      foot={
        <>
          <button
            class="btn"
            onClick={async () => {
              if (await deleteTx(t)) close();
            }}
            aria-label="Supprimer"
            style={{ flex: '0 0 auto' }}
          >
            <Trash2 size={20} />
          </button>
          <button
            class="btn primary"
            onClick={() => {
              close();
              setTimeout(() => openExpense(t), 50);
            }}
          >
            <Pencil size={18} /> Modifier
          </button>
        </>
      }
    >
      <div class="card flat" style={{ textAlign: 'center' }}>
        <div class="small muted">{kindLabel}</div>
        <div class="hero" style={{ fontSize: 34, color: t.kind === 'expense' ? 'var(--bordeaux)' : 'var(--ok)' }}>
          <Money cents={t.kind === 'expense' ? t.amount : t.amount} cur={t.currency} sign={t.kind !== 'expense'} />
        </div>
        <div style={{ fontWeight: 650, marginTop: 4 }}>{t.label}</div>
        <div class="small muted">
          {catName(t.categoryId)} · {fmtDate(t.date)}
          {t.month && t.month !== monthOf(t.date) ? ` · compté en ${monthLabel(t.month, false)}` : ''}
        </div>
        {t.note && <p class="small" style={{ marginBottom: 0 }}>{t.note}</p>}
      </div>

      {rec && (
        <p class="small muted row">
          <Repeat size={16} /> Paiement de la charge fixe « {rec.name} ».
        </p>
      )}
      {dl && (
        <button class="item" style={{ borderTop: 'none', paddingLeft: 0 }} onClick={() => go(`/echeances/${dl.id}`)}>
          <div class="avatar blue">
            <CalendarClock size={20} />
          </div>
          <div class="main">
            <div class="title">{dl.title}</div>
            <div class="meta">Échéance liée · {fmtDate(dl.date)}</div>
          </div>
        </button>
      )}
      {orig && !orig.deletedAt && (
        <p class="small">
          Rembourse : <b>{orig.label}</b> ({fmtMoney(orig.amount, orig.currency)} du {fmtDate(orig.date)})
        </p>
      )}

      {t.kind === 'expense' && (
        <div class="section">
          <div class="section-head">
            <h2 style={{ fontSize: 17 }}>Remboursements</h2>
            <button class="link-btn" onClick={() => openSheet('Remboursement', (c) => <RefundForm orig={t} close={c} />)}>
              <RotateCcw size={15} /> Ajouter
            </button>
          </div>
          {refunds.length ? (
            <div class="list">
              {refunds.map((r) => (
                <div class="item">
                  <div class="main">
                    <div class="title">{fmtDate(r.date)}</div>
                    <div class="meta">{r.month ? `Compté en ${monthLabel(r.month, false)}` : ''}</div>
                  </div>
                  <Money cents={r.amount} cur={r.currency} sign cls="amount-pos" />
                </div>
              ))}
            </div>
          ) : (
            <p class="small muted" style={{ margin: 0 }}>Aucun. Un remboursement corrige le total de la catégorie sans être compté comme revenu.</p>
          )}
        </div>
      )}

      <div class="section">
        <div class="section-head">
          <h2 style={{ fontSize: 17 }}>Documents</h2>
          <button class="link-btn" onClick={() => openSheet('Lier un document', (c) => <DocPicker target={{ kind: 'tx', id: t.id }} close={c} />)}>
            <Link2 size={15} /> Lier
          </button>
        </div>
        {docs.length ? (
          <div class="list">
            {docs.map((d) => (
              <button class="item" onClick={() => go(`/documents/${d.id}`)}>
                <Thumb fileId={d.fileId} />
                <div class="main">
                  <div class="title">{d.title}</div>
                  <div class="meta">{d.id === t.receiptDocId ? 'Reçu (photo du ticket)' : catName(d.categoryId)}</div>
                </div>
                {d.id === t.receiptDocId ? <Receipt size={18} color="var(--ink-3)" /> : <Paperclip size={18} color="var(--ink-3)" />}
              </button>
            ))}
          </div>
        ) : (
          <p class="small muted" style={{ margin: 0 }}>Aucun document lié.</p>
        )}
      </div>
    </SheetBody>
  );
}

export function openTx(id: string) {
  openSheet('Opération', (close) => <TxDetail id={id} close={close} />);
}

