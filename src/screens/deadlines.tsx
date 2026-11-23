import { useState } from 'preact/hooks';
import { AlertTriangle, BellRing, CalendarClock, CalendarPlus, Check, CircleDashed, FileSignature, FileText, IdCard, Landmark, Pencil, Receipt, Trash2, Undo2, Link2, CalendarDays } from 'lucide-preact';
import { data } from '../db/store';
import { alive, catName, completeDeadline, deleteDeadline, findDeadline, findDoc, newDeadline, postpone, reopenDeadline, saveDeadline, setDeadlineStatus } from '../db/actions';
import type { Deadline, DeadlineFreq, DeadlineType, Doc } from '../db/schema';
import { AmountInput, Chips, CurrencySeg, DateInput, Empty, Field, Money, SensitiveWarning, Seg, SheetBody, Switch, TopBar, useAmount } from '../ui/kit';
import { addMonths, fmtDate, relativeDays, today, weekdayLabel, type ISODate } from '../lib/dates';
import { fmtMoney, type Currency } from '../lib/money';
import { maskSensitive } from '../lib/sensitive';
import { FREQS_BY_TYPE, FREQ_LABEL, STATUS_LABEL, TYPE_LABEL, displayStatus, isOverdue, noticeDeadline, noticeExplanation, sortDeadlines } from '../lib/deadlines';
import { suggestCategory } from '../lib/categorize';
import { go, goBack, openSheet, route } from '../ui/router';
import { DocPicker } from './docs';
import { exportICS, missedNow } from '../services/reminders';
import { CategorySelect } from './tx';

export const TYPE_ICON: Record<DeadlineType, (p: { size: number }) => any> = {
  bill: Receipt,
  contract: FileSignature,
  admin: Landmark,
  expiry: IdCard,
};

export function DeadlineRow({ d, onCheck }: { d: Deadline; onCheck?: (d: Deadline) => void }) {
  const st = displayStatus(d);
  const rel = relativeDays(d.date);
  const tomorrow = rel.days === 1 && st !== 'done';
  const Icon = TYPE_ICON[d.type];
  return (
    <div class={`item ${st === 'late' ? 'late' : ''} ${tomorrow ? 'tomorrow' : ''} ${st === 'done' ? 'done' : ''}`} style={{ padding: 0 }}>
      <button class="item" style={{ border: 'none', background: 'transparent', flex: 1, minWidth: 0 }} onClick={() => go(`/echeances/${d.id}`)}>
        <div class={`avatar ${st === 'late' ? 'red' : tomorrow ? 'yellow' : 'blue'}`}>{st === 'late' ? <AlertTriangle size={20} /> : <Icon size={20} />}</div>
        <div class="main">
          <div class="title wrap2">{d.title}</div>
          <div class="meta row wrap" style={{ gap: 6, marginTop: 3 }}>
            {st === 'done' ? (
              <span class="pill ok">Terminée</span>
            ) : st === 'late' ? (
              <span class="pill red">{rel.text}</span>
            ) : tomorrow ? (
              <span class="pill yellow">Demain</span>
            ) : rel.days === 0 ? (
              <span class="pill bordeaux">Aujourd’hui</span>
            ) : (
              <span class="pill">{rel.text}</span>
            )}
            <span class="num">{fmtDate(d.date)}</span>
            {d.amount && d.currency ? <span class="num">· {fmtMoney(d.amount, d.currency)}</span> : d.variable ? <span>· variable</span> : null}
            {st === 'doing' && <span>· en cours</span>}
          </div>
        </div>
      </button>
      {onCheck && st !== 'done' && (
        <button class="icon-btn" style={{ marginRight: 6 }} aria-label={`Terminer « ${d.title} »`} onClick={() => onCheck(d)}>
          <CircleDashed size={26} />
        </button>
      )}
    </div>
  );
}

// ---------- Terminer une échéance (avec dépense éventuelle) ----------

function CompleteBill({ d, close }: { d: Deadline; close: () => void }) {
  const s = data.value.settings;
  const amt = useAmount(d.variable ? null : d.amount ?? null);
  const [cur, setCur] = useState<Currency>(d.currency ?? s.lastCurrency);
  const [cat, setCat] = useState<string | null>(d.categoryId ?? suggestCategory(d.title, data.value.categories, s.labelRules) ?? 'divers');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const finish = async (withExpense: boolean) => {
    if (busy) return;
    setBusy(true);
    await completeDeadline(d, withExpense && amt.cents ? { amount: amt.cents, currency: cur, categoryId: cat, date } : undefined);
    close();
  };
  return (
    <SheetBody
      foot={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          <button class="btn primary big block" disabled={!amt.cents || busy} onClick={() => finish(true)}>
            Terminer et créer la dépense
          </button>
          <button class="btn block" disabled={busy} onClick={() => finish(false)}>
            Terminer sans créer de dépense
          </button>
        </div>
      }
    >
      <p style={{ marginTop: 0 }}>
        <b>{d.title}</b> — {fmtDate(d.date)}
      </p>
      <p class="small muted">La dépense n’est créée que si vous appuyez sur « Terminer et créer la dépense ».{d.variable ? ' Montant variable : indiquez le montant réellement payé.' : ''}</p>
      <Field label="Montant payé">
        <AmountInput text={amt.text} setText={amt.setText} big autoFocus={!!d.variable} />
      </Field>
      <div style={{ marginTop: 12 }}>
        <CurrencySeg value={cur} onChange={setCur} />
      </div>
      <Field label="Catégorie">
        <CategorySelect value={cat} onChange={setCat} />
      </Field>
      <Field label="Payée le">
        <DateInput value={date} onChange={(v) => v && setDate(v)} />
      </Field>
      {d.frequency !== 'none' && <div class="callout">Échéance récurrente ({FREQ_LABEL[d.frequency].toLowerCase()}) : la suivante sera créée automatiquement.</div>}
    </SheetBody>
  );
}

export async function startComplete(d: Deadline) {
  if (d.type === 'bill') {
    openSheet('Facture payée ?', (close) => <CompleteBill d={d} close={close} />);
    return;
  }
  await completeDeadline(d);
}

// ---------- Liste ----------

type Filter = 'open' | 'late' | 'soon' | 'done';

export function DeadlinesScreen() {
  const q = route.value.query;
  const [filter, setFilter] = useState<Filter>((q.get('f') as Filter) || 'open');
  const [type, setType] = useState<DeadlineType | 'all'>('all');
  const all = alive(data.value.deadlines);
  const t = today();
  const in30 = addMonths(t, 1);
  let list = all.filter((d) => type === 'all' || d.type === type);
  if (filter === 'open') list = sortDeadlines(list.filter((d) => d.status !== 'done'));
  if (filter === 'late') list = sortDeadlines(list.filter((d) => isOverdue(d)));
  if (filter === 'soon') list = sortDeadlines(list.filter((d) => d.status !== 'done' && d.date <= in30));
  if (filter === 'done') list = list.filter((d) => d.status === 'done').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  const late = all.filter((d) => isOverdue(d)).length;
  const missed = missedNow();
  return (
    <>
      <TopBar title="Échéances">
        <button class="icon-btn soft" aria-label="Exporter vers le calendrier" onClick={() => exportICS(sortDeadlines(all.filter((d) => d.status !== 'done' && d.date >= t)))}>
          <CalendarPlus size={22} />
        </button>
      </TopBar>
      {missed.length > 0 && (
        <div class="banner yellow" style={{ marginBottom: 10 }}>
          <BellRing size={20} />
          <span>
            <b>Rappels manqués depuis votre dernière visite :</b> {missed.map((d) => d.title).join(', ')}.
          </span>
        </div>
      )}
      <Chips
        scroll
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'open', label: 'À faire' },
          { value: 'late', label: `En retard${late ? ` (${late})` : ''}` },
          { value: 'soon', label: '30 prochains jours' },
          { value: 'done', label: 'Historique' },
        ]}
      />
      <div style={{ marginTop: 8 }}>
        <Chips
          scroll
          small
          value={type}
          onChange={setType}
          options={[
            { value: 'all', label: 'Tous types' },
            { value: 'bill', label: 'Factures' },
            { value: 'contract', label: 'Contrats' },
            { value: 'admin', label: 'Impôts et démarches' },
            { value: 'expiry', label: 'Fins de validité' },
          ]}
        />
      </div>
      <div class="section">
        {list.length ? (
          <div class="list">
            {list.map((d) => (
              <DeadlineRow d={d} onCheck={startComplete} />
            ))}
          </div>
        ) : all.length === 0 ? (
          <Empty icon={<CalendarClock size={26} />} title="Aucune échéance" text="Ajoutez une facture, un renouvellement de contrat, une démarche ou une date d’expiration avec le bouton + en bas de l’écran.">
            <button class="btn primary" onClick={() => openDeadlineForm()}>
              Ajouter une échéance
            </button>
          </Empty>
        ) : (
          <Empty icon={<Check size={26} />} title="Rien ici" text={filter === 'late' ? 'Aucune échéance en retard. Bravo !' : 'Aucune échéance ne correspond à ce filtre.'} />
        )}
      </div>
      <p class="small muted" style={{ marginTop: 14 }}>
        Rappel la veille à {data.value.settings.reminderTime.replace(':', ' h ')}. Les échéances dépassées et non terminées restent en haut, en rouge. <a href="#/reglages/rappels">Fiabilité des rappels</a>
      </p>
    </>
  );
}

// ---------- Détail ----------

export function DeadlineDetail({ id }: { id: string }) {
  const d = findDeadline(id);
  if (!d || d.deletedAt) {
    return (
      <>
        <TopBar title="Échéance" back={() => goBack('/echeances')} />
        <Empty icon={<CalendarClock size={26} />} title="Introuvable" text="Cette échéance a été supprimée." />
      </>
    );
  }
  const st = displayStatus(d);
  const rel = relativeDays(d.date);
  const docs = d.docIds.map(findDoc).filter((x): x is Doc => !!x && !x.deletedAt);
  const txs = alive(data.value.txs).filter((t) => t.deadlineId === d.id);
  const next = d.nextId ? findDeadline(d.nextId) : undefined;
  return (
    <>
      <TopBar title={d.title} sub={TYPE_LABEL[d.type]} back={() => goBack('/echeances')}>
        <button class="icon-btn" aria-label="Modifier" onClick={() => openDeadlineForm(d)}>
          <Pencil size={22} />
        </button>
      </TopBar>
      <div class={`card ${st === 'late' ? '' : 'blue'}`} style={st === 'late' ? { background: 'var(--danger-soft)', borderColor: 'var(--danger-light)' } : undefined}>
        <div class="row" style={{ justifyContent: 'space-between' }}>
          <span class={`pill ${st === 'late' ? 'red' : st === 'done' ? 'ok' : st === 'doing' ? 'warn' : 'blue'}`}>{STATUS_LABEL[st]}</span>
          <span class="small muted">{d.frequency !== 'none' ? FREQ_LABEL[d.frequency] : 'Ponctuelle'}</span>
        </div>
        <div class="hero" style={{ fontSize: 30, marginTop: 8, color: st === 'late' ? 'var(--danger)' : 'var(--bordeaux)' }}>
          <span class="num">{fmtDate(d.date)}</span>
        </div>
        <div class="small" style={{ color: st === 'late' ? 'var(--danger)' : 'var(--ink-2)', fontWeight: 600 }}>
          {weekdayLabel(d.date)} · {st === 'done' ? `terminée le ${fmtDate(d.completedAt!.slice(0, 10))}` : rel.days < 0 ? `en retard de ${-rel.days} jour${rel.days < -1 ? 's' : ''}` : rel.days === 1 ? <span class="pill yellow">Demain</span> : rel.text.toLowerCase()}
        </div>
        {d.originalDate && d.originalDate !== d.date && st !== 'done' && <div class="tiny muted">Date initiale : {fmtDate(d.originalDate)}</div>}
        {(d.amount || d.variable) && (
          <div style={{ marginTop: 8, fontWeight: 650 }}>{d.amount && d.currency ? <Money cents={d.amount} cur={d.currency} /> : null}{d.variable ? <span class="small muted"> (montant variable)</span> : null}</div>
        )}
      </div>

      {d.contract && (
        <div class="callout blue">
          {noticeExplanation(d.contract)}
          {d.contract.manual && (
            <>
              <br />
              <b>Date corrigée manuellement : {fmtDate(d.date)}.</b>
            </>
          )}
          <br />
          <span class="small muted">Prévoyez l’envoi quelques jours avant (courrier recommandé).</span>
        </div>
      )}

      {st !== 'done' ? (
        <div class="section">
          <div class="actions">
            <button class="btn primary" onClick={() => startComplete(d)}>
              <Check size={22} /> {d.type === 'bill' ? 'Payée / terminée' : 'Terminer'}
            </button>
            {docs[0] ? (
              <button class="btn blue" onClick={() => go(`/documents/${docs[0].id}`)}>
                <FileText size={22} /> Ouvrir le document
              </button>
            ) : (
              <button class="btn blue" onClick={() => openSheet('Lier un document', (c) => <DocPicker target={{ kind: 'deadline', id: d.id }} close={c} />)}>
                <Link2 size={22} /> Lier un document
              </button>
            )}
            <button class="btn" onClick={() => postpone(d, 1)}>
              <CalendarDays size={22} /> Reporter d’1 jour
            </button>
            <button class="btn" onClick={() => postpone(d, 7)}>
              <CalendarDays size={22} /> Reporter d’1 semaine
            </button>
          </div>
          <div class="row" style={{ marginTop: 8 }}>
            {d.status !== 'doing' ? (
              <button class="btn sm grow" onClick={() => setDeadlineStatus(d, 'doing')}>
                Marquer « en cours »
              </button>
            ) : (
              <button class="btn sm grow" onClick={() => setDeadlineStatus(d, 'todo')}>
                Remettre « à faire »
              </button>
            )}
            <button class="btn sm grow" onClick={() => exportICS([d])}>
              <CalendarPlus size={16} /> Calendrier
            </button>
          </div>
        </div>
      ) : (
        <div class="section">
          <button class="btn block" onClick={() => reopenDeadline(d)}>
            <Undo2 size={18} /> Rouvrir cette échéance
          </button>
          {next && !next.deletedAt && (
            <button class="btn block ghost" onClick={() => go(`/echeances/${next.id}`)}>
              Voir l’échéance suivante ({fmtDate(next.date)})
            </button>
          )}
        </div>
      )}

      {d.note && (
        <div class="section">
          <h2 style={{ fontSize: 17, marginBottom: 6 }}>Note</h2>
          <p class="card flat" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {d.note}
          </p>
        </div>
      )}

      <div class="section">
        <div class="section-head">
          <h2 style={{ fontSize: 17 }}>Documents liés</h2>
          <button class="link-btn" onClick={() => openSheet('Lier un document', (c) => <DocPicker target={{ kind: 'deadline', id: d.id }} close={c} />)}>
            Gérer
          </button>
        </div>
        {docs.length ? (
          <div class="list">
            {docs.map((x) => (
              <button class="item" onClick={() => go(`/documents/${x.id}`)}>
                <div class="avatar">
                  <FileText size={20} />
                </div>
                <div class="main">
                  <div class="title">{x.title}</div>
                  <div class="meta">{catName(x.categoryId)}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p class="small muted" style={{ margin: 0 }}>Aucun document lié.</p>
        )}
      </div>

      {txs.length > 0 && (
        <div class="section">
          <h2 style={{ fontSize: 17, marginBottom: 6 }}>Dépenses créées</h2>
          <div class="list">
            {txs.map((t) => (
              <div class="item">
                <div class="main">
                  <div class="title">{t.label}</div>
                  <div class="meta">{fmtDate(t.date)}</div>
                </div>
                <Money cents={t.amount} cur={t.currency} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div class="section">
        <button
          class="btn block ghost"
          style={{ color: 'var(--danger)' }}
          onClick={async () => {
            if (await deleteDeadline(d)) go('/echeances');
          }}
        >
          <Trash2 size={18} /> Supprimer l’échéance
        </button>
      </div>
    </>
  );
}

// ---------- Formulaire ----------

function DeadlineForm({ initial, close }: { initial?: Deadline; close: () => void }) {
  const isNew = !initial;
  const s = data.value.settings;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [type, setType] = useState<DeadlineType>(initial?.type ?? 'bill');
  const [date, setDate] = useState<ISODate | ''>(initial?.date ?? '');
  const [freq, setFreq] = useState<DeadlineFreq>(initial?.frequency ?? 'none');
  const amt = useAmount(initial?.amount ?? null);
  const [cur, setCur] = useState<Currency>(initial?.currency ?? s.lastCurrency);
  const [variable, setVariable] = useState(!!initial?.variable);
  const [cat, setCat] = useState<string | null>(initial?.categoryId ?? null);
  const [note, setNote] = useState(initial?.note ?? '');
  const [docId, setDocId] = useState<string>(initial?.docIds[0] ?? '');
  const [useContract, setUseContract] = useState(!!initial?.contract);
  const [endDate, setEndDate] = useState<ISODate | ''>(initial?.contract?.endDate ?? '');
  const [noticeVal, setNoticeVal] = useState(String(initial?.contract?.noticeValue ?? 3));
  const [noticeUnit, setNoticeUnit] = useState<'months' | 'days'>(initial?.contract?.noticeUnit ?? 'months');
  const [manual, setManual] = useState(!!initial?.contract?.manual);
  const [tried, setTried] = useState(false);
  const freqs = FREQS_BY_TYPE[type];
  const nv = Math.max(0, parseInt(noticeVal || '0', 10) || 0);
  const computed = useContract && endDate ? noticeDeadline(endDate, nv, noticeUnit) : null;
  const finalDate = useContract && !manual ? computed : date;
  const docs = alive(data.value.docs).sort((a, b) => a.title.localeCompare(b.title));
  const errTitle = tried && !title.trim() ? 'Indiquez un titre.' : null;
  const errDate = tried && !finalDate ? (useContract ? 'Indiquez la date de fin du contrat.' : 'Choisissez une date.') : null;

  async function save() {
    setTried(true);
    if (!title.trim() || !finalDate) return;
    const base = initial ?? newDeadline({});
    const d: Deadline = {
      ...base,
      title: maskSensitive(title.trim()).text,
      type,
      date: finalDate,
      frequency: freqs.includes(freq) ? freq : 'none',
      amount: amt.cents && !variable ? amt.cents : variable ? amt.cents ?? undefined : undefined,
      currency: amt.cents || variable ? cur : undefined,
      variable: type === 'bill' ? variable : undefined,
      categoryId: type === 'bill' ? cat : undefined,
      note: maskSensitive(note.trim()).text || undefined,
      docIds: docId ? Array.from(new Set([docId, ...(base.docIds ?? []).filter((x) => x !== initial?.docIds[0])])) : (base.docIds ?? []).filter((x) => x !== initial?.docIds[0]),
      contract: type === 'contract' && useContract && endDate ? { endDate, noticeValue: nv, noticeUnit, manual } : undefined,
    };
    // Une date modifiée à la main redéfinit le calendrier de la série.
    if (initial && initial.date !== d.date) d.originalDate = undefined;
    const saved = await saveDeadline(d, isNew);
    close();
    if (isNew) go(`/echeances/${saved.id}`);
  }

  return (
    <SheetBody
      foot={
        <button class="btn primary big" onClick={save}>
          {isNew ? 'Ajouter l’échéance' : 'Enregistrer'}
        </button>
      }
    >
      <div class="field">
        <span class="lab">Type</span>
        <Chips
          value={type}
          onChange={(t) => {
            setType(t);
            if (!FREQS_BY_TYPE[t].includes(freq)) setFreq('none');
          }}
          options={(['bill', 'contract', 'admin', 'expiry'] as DeadlineType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
        />
      </div>
      <Field label="Titre" error={errTitle}>
        <input class="input" value={title} placeholder={type === 'bill' ? 'Ex. Facture électricité' : type === 'contract' ? 'Ex. Assurance ménage' : type === 'admin' ? 'Ex. Déclaration d’impôts 2026' : 'Ex. Passeport'} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
      </Field>
      <SensitiveWarning text={title} />
      {type === 'expiry' && <div class="callout">Pour une pièce d’identité, enregistrez son nom et sa date d’expiration, jamais son numéro.</div>}

      {type === 'contract' && (
        <Switch checked={useContract} onChange={setUseContract} label="Calculer la date limite de résiliation" hint="À partir de la fin du contrat et du délai de préavis." />
      )}
      {type === 'contract' && useContract ? (
        <>
          <Field label="Fin du contrat" error={errDate}>
            <DateInput value={endDate} onChange={setEndDate} label="Fin du contrat" />
          </Field>
          <div class="field">
            <span class="lab">Délai de préavis</span>
            <div class="row">
              <input class="input num" style={{ width: 90, textAlign: 'center' }} inputMode="numeric" value={noticeVal} onInput={(e) => setNoticeVal((e.target as HTMLInputElement).value.replace(/\D/g, ''))} aria-label="Durée du préavis" />
              <div class="grow">
                <Seg value={noticeUnit} onChange={setNoticeUnit} options={[{ value: 'months', label: 'mois' }, { value: 'days', label: 'jours' }]} />
              </div>
            </div>
          </div>
          {computed && endDate && (
            <div class="callout blue">
              {noticeExplanation({ endDate, noticeValue: nv, noticeUnit, manual: false })}
              <br />
              <span class="small">C’est cette date qui sera rappelée, pas la fin du contrat.</span>
            </div>
          )}
          <Switch checked={manual} onChange={(v) => { setManual(v); if (v && !date && computed) setDate(computed); }} label="Corriger la date limite à la main" hint="Si votre contrat prévoit une autre règle (ex. fin de trimestre)." />
          {manual && (
            <Field label="Date limite de résiliation">
              <DateInput value={date} onChange={setDate} />
            </Field>
          )}
        </>
      ) : (
        <Field label={type === 'expiry' ? 'Date d’expiration' : 'Date ou date limite'} error={errDate}>
          <DateInput value={date} onChange={setDate} />
        </Field>
      )}

      {freqs.length > 1 && (
        <Field label="Répétition">
          <select class="input" value={freq} onChange={(e) => setFreq((e.target as HTMLSelectElement).value as DeadlineFreq)}>
            {freqs.map((f) => (
              <option value={f}>{FREQ_LABEL[f]}</option>
            ))}
          </select>
        </Field>
      )}

      {type !== 'expiry' && (
        <>
          <Field label={type === 'bill' ? (variable ? 'Montant estimé (facultatif)' : 'Montant') : 'Montant (facultatif)'}>
            <AmountInput text={amt.text} setText={amt.setText} />
          </Field>
          {(amt.cents || type === 'bill') && (
            <div style={{ marginTop: 10 }}>
              <CurrencySeg value={cur} onChange={setCur} />
            </div>
          )}
          {type === 'bill' && (
            <>
              <Switch checked={variable} onChange={setVariable} label="Montant variable" hint="Le montant réel sera demandé au paiement." />
              <Field label="Catégorie de la dépense">
                <CategorySelect value={cat} onChange={setCat} allowNone />
              </Field>
            </>
          )}
        </>
      )}

      <Field label="Document associé (facultatif)">
        <select class="input" value={docId} onChange={(e) => setDocId((e.target as HTMLSelectElement).value)}>
          <option value="">Aucun</option>
          {docs.map((x) => (
            <option value={x.id}>{x.title}</option>
          ))}
        </select>
      </Field>
      <Field label="Note (facultative)">
        <textarea class="input" value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
      </Field>
      <SensitiveWarning text={note} />
    </SheetBody>
  );
}

export function openDeadlineForm(initial?: Deadline) {
  openSheet(initial ? 'Modifier l’échéance' : 'Nouvelle échéance', (close) => <DeadlineForm initial={initial} close={close} />);
}

