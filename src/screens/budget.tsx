import { useMemo, useState } from 'preact/hooks';
import { Check, FileUp, List, Pause, Play, Plus, Repeat, Settings2, Trash2, Wallet, Receipt, RotateCcw, ArrowDownLeft, Ban } from 'lucide-preact';
import { data } from '../db/store';
import { alive, catName, categoriesOf, deleteRecurring, payOccurrence, pauseRecurring, resumeRecurring, saveRecurring, setOccurrence, withBaseFrom, findRecurring } from '../db/actions';
import { uid, nowStamp } from '../db/store';
import type { Frequency, Recurring, Tx } from '../db/schema';
import { AmountInput, BudgetBar, Chips, CurrencySeg, DateInput, Empty, Field, Money, MonthNav, Seg, SheetBody, TopBar, useAmount, BigMoney } from '../ui/kit';
import { addMonthKey, currentMonth, fmtDate, firstDay, monthLabel, monthOf, today, weekdayLabel, type ISODate, type MonthKey } from '../lib/dates';
import { fmtMoney, type Currency, CURRENCIES } from '../lib/money';
import { monthStats, txMonth, type MonthStats } from '../lib/budget';
import { FREQ_LABEL, isCurrentlyPaused, nextDueDate, paidIndex, type Occurrence } from '../lib/recurring';
import { maskSensitive } from '../lib/sensitive';
import { go, goBack, openSheet, route } from '../ui/router';
import { openTx } from './tx';
import { CategorySelect } from './tx';
import { normalize } from '../lib/categorize';

export function useStats(cur: Currency, month: MonthKey): MonthStats {
  const d = data.value;
  return useMemo(() => monthStats(d, cur, month), [d, cur, month]);
}

export function SummaryCard({ s }: { s: MonthStats }) {
  return (
    <div class={`card ${s.currency === 'CHF' ? 'blue' : 'cream'}`}>
      <div class="row" style={{ justifyContent: 'space-between' }}>
        <span class="small" style={{ fontWeight: 700, color: s.currency === 'CHF' ? 'var(--blue-ink)' : 'var(--terracotta)' }}>
          RESTANT · {s.currency}
        </span>
        {s.ratio !== null && <span class="small muted num">{Math.round(s.ratio * 100)} % utilisé ou prévu</span>}
      </div>
      {s.remaining === null ? (
        <div style={{ margin: '8px 0' }}>
          <p class="small" style={{ margin: '0 0 8px' }}>
            Aucun budget {s.currency} fixé pour ce mois.
          </p>
          <button class="btn sm primary" onClick={() => go('/reglages/budgets')}>
            Fixer le budget {s.currency}
          </button>
        </div>
      ) : (
        <div class="hero" style={{ fontSize: 34, margin: '4px 0 8px', color: s.remaining < 0 ? 'var(--danger)' : 'var(--bordeaux)' }}>
          <BigMoney cents={s.remaining} cur={s.currency} />
        </div>
      )}
      <BudgetBar confirmed={Math.max(0, s.confirmed)} planned={s.planned} budget={s.budget} level={s.level} />
      {s.level === 'warn' && <div class="level-note warn">Attention : 80 % du budget atteint.</div>}
      {s.level === 'over' && <div class="level-note over">Budget dépassé de {fmtMoney(-(s.remaining ?? 0), s.currency)}.</div>}
      <div style={{ marginTop: 10 }}>
        {s.budget !== null && (
          <div class="kv">
            <span>Budget mensuel</span>
            <b class="num">{fmtMoney(s.budget, s.currency)}</b>
          </div>
        )}
        <div class="kv">
          <span>
            <i class="dot" style={{ background: s.level === 'over' ? 'var(--danger-fill)' : s.level === 'warn' ? 'var(--warn-fill)' : 'var(--steel)' }} />
            Dépenses confirmées
          </span>
          <b class="num">− {fmtMoney(s.confirmed, s.currency)}</b>
        </div>
        {s.refunds > 0 && (
          <div class="kv" style={{ paddingLeft: 13 }}>
            <span>dont remboursements déduits</span>
            <span class="num">{fmtMoney(s.refunds, s.currency)}</span>
          </div>
        )}
        <div class="kv">
          <span>
            <i class="dot" style={{ background: 'var(--steel-light)' }} />
            Charges fixes prévues (non payées)
          </span>
          <b class="num">− {fmtMoney(s.planned, s.currency)}</b>
        </div>
        {s.remaining !== null && (
          <div class="kv" style={{ borderTop: '1px solid var(--line)', paddingTop: 5, marginTop: 6 }}>
            <span style={{ fontWeight: 700, color: 'var(--ink)' }}>= Restant selon le budget</span>
            <b class="num" style={{ color: s.remaining < 0 ? 'var(--danger)' : 'var(--bordeaux)' }}>
              {fmtMoney(s.remaining, s.currency)}
            </b>
          </div>
        )}
      </div>
      <p class="tiny muted" style={{ margin: '8px 0 0' }}>
        Estimation selon votre budget, pas le solde réel de votre compte bancaire.
      </p>
    </div>
  );
}

function OccurrenceSheet({ occ, close }: { occ: Occurrence; close: () => void }) {
  const amt = useAmount(occ.amount);
  const [date, setDate] = useState<ISODate>(occ.dueDate <= today() ? today() : occ.dueDate);
  const [updateBase, setUpdateBase] = useState(false);
  const rec = occ.rec;
  const changed = amt.cents !== null && amt.cents !== occ.baseAmount;
  if (occ.status === 'paid') {
    return (
      <SheetBody>
        <p>
          <b>{rec.name}</b> a été payée : {fmtMoney(occ.amount, rec.currency)} le {fmtDate(occ.tx!.date)}.
        </p>
        <button class="btn block" onClick={() => { close(); setTimeout(() => openTx(occ.tx!.id), 50); }}>
          Voir l’opération (modifier ou annuler le paiement)
        </button>
      </SheetBody>
    );
  }
  return (
    <SheetBody
      foot={
        <button
          class="btn primary big"
          disabled={!amt.cents}
          onClick={async () => {
            await payOccurrence(occ, amt.cents!, date, updateBase);
            close();
          }}
        >
          <Check size={20} /> Marquer comme payée
        </button>
      }
    >
      <p class="small muted" style={{ marginTop: 0 }}>
        {FREQ_LABEL[rec.frequency]} · échéance le {fmtDate(occ.dueDate)} · montant de base {fmtMoney(occ.baseAmount, rec.currency)}
        {occ.status === 'skipped' ? ' · ignorée ce mois-ci' : ''}
      </p>
      <Field label={`Montant réel de ${monthLabel(occ.month, false)} (${rec.currency})`} hint="Pour une facture variable, ajustez avant de confirmer.">
        <AmountInput text={amt.text} setText={amt.setText} big />
      </Field>
      {changed && (
        <label class="check">
          <input type="checkbox" checked={updateBase} onChange={(e) => setUpdateBase((e.target as HTMLInputElement).checked)} />
          <span>Utiliser aussi ce montant comme nouveau montant de base à partir de {monthLabel(occ.month, false)}.</span>
        </label>
      )}
      <Field label="Payée le">
        <DateInput value={date} onChange={(v) => v && setDate(v)} />
      </Field>
      <p class="tiny muted">La dépense sera comptée en {monthLabel(occ.month, false)} et la charge ne sera plus « prévue » : pas de double comptage.</p>
      <div class="grid2" style={{ marginTop: 12 }}>
        <button
          class="btn sm"
          disabled={!changed}
          onClick={async () => {
            await setOccurrence(rec, occ.month, { amount: amt.cents }, `Montant prévu de ${monthLabel(occ.month, false)} : ${fmtMoney(amt.cents!, rec.currency)} (base inchangée)`);
            close();
          }}
        >
          Ajuster sans payer
        </button>
        {occ.status === 'skipped' ? (
          <button
            class="btn sm"
            onClick={async () => {
              await setOccurrence(rec, occ.month, { skipped: false }, 'Charge réactivée pour ce mois');
              close();
            }}
          >
            Réactiver ce mois
          </button>
        ) : (
          <button
            class="btn sm"
            onClick={async () => {
              await setOccurrence(rec, occ.month, { skipped: true }, `${rec.name} ignorée en ${monthLabel(occ.month, false)}`);
              close();
            }}
          >
            <Ban size={16} /> Ignorer ce mois
          </button>
        )}
      </div>
      {occ.overridden && (
        <button
          class="btn sm block ghost"
          style={{ marginTop: 8 }}
          onClick={async () => {
            await setOccurrence(rec, occ.month, { amount: null }, 'Montant de base rétabli pour ce mois');
            close();
          }}
        >
          Revenir au montant de base
        </button>
      )}
      <button class="btn sm block ghost" style={{ marginTop: 4 }} onClick={() => { close(); setTimeout(() => openRecurringForm(rec), 50); }}>
        <Settings2 size={16} /> Paramètres de la charge fixe
      </button>
    </SheetBody>
  );
}

export function OccurrenceRow({ o }: { o: Occurrence }) {
  return (
    <button class="item" onClick={() => openSheet(o.rec.name, (c) => <OccurrenceSheet occ={o} close={c} />)}>
      <div class={`avatar ${o.status === 'paid' ? '' : 'blue'}`}>{o.status === 'paid' ? <Check size={20} /> : <Repeat size={20} />}</div>
      <div class="main">
        <div class="title">{o.rec.name}</div>
        <div class="meta">
          {fmtDate(o.dueDate)} · {o.status === 'paid' ? 'payée' : o.status === 'skipped' ? 'ignorée ce mois' : 'prévue'}
          {o.overridden && o.status !== 'paid' ? ' · montant ajusté' : ''}
        </div>
      </div>
      <div class="end">
        <Money cents={o.amount} cur={o.rec.currency} cls={o.status === 'paid' ? '' : 'amount-planned'} />
        <div style={{ marginTop: 3 }}>{o.status === 'paid' ? <span class="pill ok">Payée</span> : o.status === 'skipped' ? <span class="pill">Ignorée</span> : <span class="pill blue">Prévue</span>}</div>
      </div>
    </button>
  );
}

export function TxRow({ t, showDate }: { t: Tx; showDate?: boolean }) {
  const icon = t.kind === 'refund' ? <RotateCcw size={20} /> : t.kind === 'income' ? <ArrowDownLeft size={20} /> : t.receiptDocId ? <Receipt size={20} /> : t.occurrence ? <Repeat size={20} /> : <Wallet size={20} />;
  return (
    <button class="item" onClick={() => openTx(t.id)}>
      <div class={`avatar ${t.kind === 'expense' ? '' : 'yellow'}`}>{icon}</div>
      <div class="main">
        <div class="title">{t.label}</div>
        <div class="meta">
          {catName(t.categoryId)}
          {showDate ? ` · ${fmtDate(t.date)}` : ''}
          {t.month && t.month !== monthOf(t.date) ? ` · compté en ${monthLabel(t.month, false)}` : ''}
        </div>
      </div>
      <Money cents={t.amount} cur={t.currency} sign={t.kind !== 'expense'} cls={t.kind === 'expense' ? '' : 'amount-pos'} />
    </button>
  );
}

export function BudgetScreen() {
  const q = route.value.query;
  const [cur, setCur] = useState<Currency>((q.get('cur') as Currency) || data.value.settings.lastCurrency);
  const [month, setMonth] = useState<MonthKey>(q.get('m') || currentMonth());
  const s = useStats(cur, month);
  const cats = categoriesOf('expense');
  const recent = alive(data.value.txs)
    .filter((t) => t.currency === cur && txMonth(t) === month)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);
  const catRows = s.byCategory
    .filter((c) => c.spent !== 0 || c.planned !== 0 || c.cap)
    .sort((a, b) => b.spent + b.planned - (a.spent + a.planned));
  const hasAnyRec = alive(data.value.recurring).length > 0;
  return (
    <>
      <TopBar title="Budget">
        <button class="icon-btn soft" aria-label="Importer un relevé CSV" onClick={() => go('/budget/import')}>
          <FileUp size={22} />
        </button>
        <button class="icon-btn soft" aria-label="Toutes les opérations du mois" onClick={() => go(`/budget/mois?m=${month}&cur=${cur}`)}>
          <List size={22} />
        </button>
      </TopBar>
      <MonthNav month={month} onChange={setMonth} max={addMonthKey(currentMonth(), 12)} />
      <div style={{ marginTop: 10 }}>
        <CurrencySeg value={cur} onChange={setCur} />
      </div>
      <div class="section">
        <SummaryCard s={s} />
      </div>

      {(s.income > 0 || s.savingsIn > 0 || s.savingsOut > 0) && (
        <div class="section">
          <h2 style={{ fontSize: 17, marginBottom: 8 }}>Bilan du mois ({cur})</h2>
          <div class="card flat">
            {s.income > 0 && (
              <div class="kv">
                <span>Autres entrées (hors budget)</span>
                <b class="num amount-pos">+ {fmtMoney(s.income, cur)}</b>
              </div>
            )}
            {s.savingsIn > 0 && (
              <div class="kv">
                <span>Versé sur vos objectifs d’épargne</span>
                <b class="num" style={{ color: 'var(--honey-ink)' }}>{fmtMoney(s.savingsIn, cur)}</b>
              </div>
            )}
            {s.savingsOut > 0 && (
              <div class="kv">
                <span>Retiré de vos objectifs</span>
                <b class="num">{fmtMoney(s.savingsOut, cur)}</b>
              </div>
            )}
            <p class="tiny muted" style={{ margin: '6px 0 0' }}>Ces montants ne changent pas le « restant » du budget.</p>
          </div>
        </div>
      )}

      <div class="section">
        <div class="section-head">
          <h2>Charges fixes</h2>
          <button class="link-btn" onClick={() => go('/budget/charges')}>
            Gérer
          </button>
        </div>
        {s.occurrences.length ? (
          <div class="list">
            {s.occurrences.map((o) => (
              <OccurrenceRow o={o} />
            ))}
          </div>
        ) : (
          <Empty icon={<Repeat size={26} />} title={hasAnyRec ? 'Aucune charge fixe ce mois-ci' : 'Pas encore de charges fixes'} text={hasAnyRec ? `Aucune charge ${cur} ne tombe en ${monthLabel(month, false)}.` : 'Définissez une seule fois loyer, assurances, abonnements, Wi-Fi… Ils seront ajoutés chaque mois comme dépenses prévues.'}>
            {!hasAnyRec && (
              <button class="btn primary" onClick={() => openRecurringForm(undefined, cur)}>
                Ajouter une charge fixe
              </button>
            )}
          </Empty>
        )}
      </div>

      <div class="section">
        <div class="section-head">
          <h2>Par catégorie</h2>
          <button class="link-btn" onClick={() => go('/reglages/budgets')}>
            Plafonds
          </button>
        </div>
        {catRows.length ? (
          <div class="list">
            {catRows.map((c) => {
              const used = Math.max(0, c.spent) + c.planned;
              const ratio = c.cap ? used / c.cap : null;
              const level = ratio === null ? 'ok' : ratio > 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok';
              return (
                <button class="item" onClick={() => go(`/budget/mois?m=${month}&cur=${cur}&cat=${c.categoryId ?? ''}`)}>
                  <div class="main">
                    <div class="row" style={{ justifyContent: 'space-between' }}>
                      <span class="title">{catName(c.categoryId)}</span>
                      <span class="small num" style={{ fontWeight: 650 }}>
                        {fmtMoney(used, cur, { decimals: false })}
                        {c.cap ? <span class="muted"> / {fmtMoney(c.cap, cur, { decimals: false })}</span> : null}
                      </span>
                    </div>
                    {c.cap ? (
                      <div style={{ marginTop: 6 }}>
                        <BudgetBar thin confirmed={Math.max(0, c.spent)} planned={c.planned} budget={c.cap} level={level} />
                      </div>
                    ) : null}
                    {c.planned > 0 && <div class="tiny muted" style={{ marginTop: 3 }}>dont {fmtMoney(c.planned, cur)} prévus</div>}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <p class="small muted">Aucune dépense {cur} ce mois-ci. Ajoutez-en une avec le bouton +.</p>
        )}
        {cats.length === 0 && <p class="small">Aucune catégorie : ajoutez-en dans les réglages.</p>}
      </div>

      <div class="section">
        <div class="section-head">
          <h2>Dernières opérations</h2>
          <button class="link-btn" onClick={() => go(`/budget/mois?m=${month}&cur=${cur}`)}>
            Tout voir
          </button>
        </div>
        {recent.length ? (
          <div class="list">
            {recent.map((t) => (
              <TxRow t={t} showDate />
            ))}
          </div>
        ) : (
          <p class="small muted">Rien pour l’instant. Le bouton + permet d’ajouter une dépense en quelques touches, ou importez un relevé CSV.</p>
        )}
      </div>
      <div class="grid2 section">
        <button class="btn" onClick={() => go('/budget/import')}>
          <FileUp size={18} /> Importer CSV
        </button>
        <button class="btn" onClick={() => go('/budget/charges')}>
          <Repeat size={18} /> Charges fixes
        </button>
      </div>
    </>
  );
}

// ---------- Écran « Mois » : opérations filtrables ----------

type KindFilter = 'all' | 'expense' | 'refund' | 'income';

export function MonthScreen() {
  const q = route.value.query;
  const [mode, setMode] = useState<'month' | 'range'>('month');
  const [month, setMonth] = useState<MonthKey>(q.get('m') || currentMonth());
  const [from, setFrom] = useState<ISODate | ''>(firstDay(currentMonth()));
  const [to, setTo] = useState<ISODate | ''>(today());
  const [cur, setCur] = useState<Currency | 'all'>((q.get('cur') as Currency) || 'all');
  const [cat, setCat] = useState<string>(q.get('cat') ?? 'all');
  const [kind, setKind] = useState<KindFilter>('all');
  const [text, setText] = useState('');
  const d = data.value;
  const inPeriod = (t: Tx) => (mode === 'month' ? txMonth(t) === month : (!from || t.date >= from) && (!to || t.date <= to));
  const nt = normalize(text);
  const list = alive(d.txs)
    .filter((t) => inPeriod(t) && (cur === 'all' || t.currency === cur) && (cat === 'all' || (t.categoryId ?? '') === cat) && (kind === 'all' || t.kind === kind) && (!nt || normalize(`${t.label} ${t.note ?? ''}`).includes(nt)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const totals = CURRENCIES.filter((c) => cur === 'all' || c === cur).map((c) => {
    const l = list.filter((t) => t.currency === c);
    const exp = l.filter((t) => t.kind === 'expense').reduce((s, t) => s + t.amount, 0);
    const ref = l.filter((t) => t.kind === 'refund').reduce((s, t) => s + t.amount, 0);
    const inc = l.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount, 0);
    return { c, exp, ref, inc, n: l.length };
  });
  const paid = paidIndex(d.txs);
  const planned =
    mode === 'month'
      ? CURRENCIES.filter((c) => cur === 'all' || c === cur)
          .flatMap((c) => monthStats({ ...d }, c, month, paid).occurrences)
          .filter((o) => o.status === 'planned' && (cat === 'all' || (o.rec.categoryId ?? '') === cat) && (kind === 'all' || kind === 'expense'))
      : [];
  const groups: Array<[string, Tx[]]> = [];
  for (const t of list) {
    const last = groups[groups.length - 1];
    if (last && last[0] === t.date) last[1].push(t);
    else groups.push([t.date, [t]]);
  }
  return (
    <>
      <TopBar title="Opérations" sub={mode === 'month' ? monthLabel(month) : 'Période personnalisée'} back={() => goBack('/budget')} />
      <Seg value={mode} onChange={setMode} options={[{ value: 'month', label: 'Par mois' }, { value: 'range', label: 'Période' }]} />
      <div style={{ marginTop: 10 }}>
        {mode === 'month' ? (
          <MonthNav month={month} onChange={setMonth} />
        ) : (
          <div class="grid2">
            <DateInput value={from} onChange={setFrom} label="Du" allowEmpty />
            <DateInput value={to} onChange={setTo} label="Au" allowEmpty />
          </div>
        )}
      </div>
      <div style={{ marginTop: 10 }}>
        <Chips scroll small value={cur} onChange={setCur} options={[{ value: 'all', label: 'CHF et MAD' }, { value: 'CHF', label: 'CHF' }, { value: 'MAD', label: 'MAD' }]} />
      </div>
      <div style={{ marginTop: 8 }}>
        <Chips scroll small value={kind} onChange={setKind} options={[{ value: 'all', label: 'Tout' }, { value: 'expense', label: 'Dépenses' }, { value: 'refund', label: 'Remboursements' }, { value: 'income', label: 'Entrées' }]} />
      </div>
      <div class="row" style={{ marginTop: 8 }}>
        <select class="input" value={cat} onChange={(e) => setCat((e.target as HTMLSelectElement).value)} aria-label="Catégorie" style={{ minHeight: 44, fontSize: 15 }}>
          <option value="all">Toutes les catégories</option>
          {categoriesOf('expense').map((c) => (
            <option value={c.id}>{c.name}</option>
          ))}
          <option value="">Sans catégorie</option>
        </select>
      </div>
      <div style={{ marginTop: 8 }}>
        <input class="input" type="search" placeholder="Filtrer par libellé" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} style={{ minHeight: 44, fontSize: 15 }} />
      </div>

      <div class={`section ${totals.length > 1 ? 'grid2' : ''}`}>
        {totals.map((x) => (
          <div class={`card flat ${x.c === 'CHF' ? 'blue' : 'cream'}`} style={{ padding: 12 }}>
            <div class="small" style={{ fontWeight: 800, color: x.c === 'CHF' ? 'var(--blue-ink)' : 'var(--terracotta)' }}>
              Total {x.c}
            </div>
            <div class="kv">
              <span>Dépenses</span>
              <b class="num">{fmtMoney(x.exp, x.c)}</b>
            </div>
            <div class="kv">
              <span>Rembours.</span>
              <b class="num">− {fmtMoney(x.ref, x.c)}</b>
            </div>
            <div class="kv">
              <span>Net</span>
              <b class="num">{fmtMoney(x.exp - x.ref, x.c)}</b>
            </div>
            {x.inc > 0 && (
              <div class="kv">
                <span>Entrées</span>
                <b class="num amount-pos">{fmtMoney(x.inc, x.c)}</b>
              </div>
            )}
            <div class="tiny muted" style={{ marginTop: 4 }}>
              {x.n} opération{x.n > 1 ? 's' : ''}
            </div>
          </div>
        ))}
      </div>

      {planned.length > 0 && (
        <div class="section">
          <h2 style={{ fontSize: 17, marginBottom: 8 }}>Charges prévues, pas encore payées</h2>
          <div class="list">
            {planned.map((o) => (
              <OccurrenceRow o={o} />
            ))}
          </div>
        </div>
      )}

      <div class="section">
        {groups.length ? (
          groups.map(([date, ts]) => (
            <>
              <div class="day-head">
                {weekdayLabel(date)} {fmtDate(date)}
              </div>
              <div class="list">
                {ts.map((t) => (
                  <TxRow t={t} />
                ))}
              </div>
            </>
          ))
        ) : (
          <Empty icon={<List size={26} />} title="Aucune opération" text="Aucune opération ne correspond à ces filtres. Les mois passés restent consultables avec les flèches." />
        )}
      </div>
    </>
  );
}

// ---------- Charges fixes ----------

export function RecurringScreen() {
  const recs = alive(data.value.recurring).sort((a, b) => a.currency.localeCompare(b.currency) || a.name.localeCompare(b.name));
  const t = today();
  return (
    <>
      <TopBar title="Charges fixes" sub="Ajoutées chaque mois comme « prévues »" back={() => goBack('/budget')}>
        <button class="icon-btn soft" aria-label="Nouvelle charge fixe" onClick={() => openRecurringForm()}>
          <Plus size={24} />
        </button>
      </TopBar>
      {recs.length ? (
        CURRENCIES.map((c) => {
          const l = recs.filter((r) => r.currency === c);
          if (!l.length) return null;
          const monthly = l.filter((r) => !isCurrentlyPaused(r) && (!r.endDate || r.endDate >= t)).reduce((s, r) => s + (r.amounts[r.amounts.length - 1]?.amount ?? 0) / r.frequency, 0);
          return (
            <div class="section">
              <div class="section-head">
                <h2>{c}</h2>
                <span class="small muted num">≈ {fmtMoney(Math.round(monthly), c)} / mois</span>
              </div>
              <div class="list">
                {l.map((r) => {
                  const paused = isCurrentlyPaused(r);
                  const ended = !!r.endDate && r.endDate < t;
                  const nd = !paused && !ended ? nextDueDate(r, t) : null;
                  const amount = r.amounts.slice().sort((a, b) => a.from.localeCompare(b.from)).pop()?.amount ?? 0;
                  return (
                    <button class="item" onClick={() => openRecurringForm(r)}>
                      <div class={`avatar ${paused || ended ? '' : 'blue'}`}>{paused ? <Pause size={20} /> : <Repeat size={20} />}</div>
                      <div class="main">
                        <div class="title">{r.name}</div>
                        <div class="meta">
                          {FREQ_LABEL[r.frequency]} · le {r.day} · {catName(r.categoryId)}
                        </div>
                        <div class="meta">{paused ? 'Suspendue' : ended ? `Terminée le ${fmtDate(r.endDate!)}` : nd ? `Prochaine : ${fmtDate(nd)}` : ''}</div>
                      </div>
                      <Money cents={amount} cur={r.currency} />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      ) : (
        <Empty icon={<Repeat size={26} />} title="Aucune charge fixe" text="Loyer, assurances, abonnements, Wi-Fi : définissez-les une fois, elles apparaîtront chaque mois comme dépenses prévues jusqu’à confirmation du paiement.">
          <button class="btn primary" onClick={() => openRecurringForm()}>
            Ajouter une charge fixe
          </button>
        </Empty>
      )}
    </>
  );
}

function RecurringForm({ initial, close, presetCur }: { initial?: Recurring; close: () => void; presetCur?: Currency }) {
  const isNew = !initial;
  const cm = currentMonth();
  const baseNow = initial ? initial.amounts.slice().sort((a, b) => a.from.localeCompare(b.from)).filter((a) => a.from <= cm).pop()?.amount ?? initial.amounts[0]?.amount : null;
  const [name, setName] = useState(initial?.name ?? '');
  const amt = useAmount(baseNow ?? null);
  const [cur, setCur] = useState<Currency>(initial?.currency ?? presetCur ?? data.value.settings.lastCurrency);
  const [cat, setCat] = useState<string | null>(initial?.categoryId ?? 'logement');
  const [day, setDay] = useState(String(initial?.day ?? 1));
  const [freq, setFreq] = useState<Frequency>(initial?.frequency ?? 1);
  const [start, setStart] = useState<ISODate | ''>(initial?.startDate ?? firstDay(cm));
  const [end, setEnd] = useState<ISODate | ''>(initial?.endDate ?? '');
  const [applyFrom, setApplyFrom] = useState<'this' | 'next'>('this');
  const [tried, setTried] = useState(false);
  const dayN = Math.min(31, Math.max(1, parseInt(day || '1', 10) || 1));
  const amountChanged = !isNew && amt.cents !== null && amt.cents !== baseNow;
  const ok = name.trim() && amt.cents && amt.cents > 0 && start && (!end || end >= start);
  const paused = initial ? isCurrentlyPaused(initial) : false;

  async function save() {
    setTried(true);
    if (!ok) return;
    let r: Recurring = initial
      ? { ...initial }
      : { id: uid(), name: '', currency: cur, categoryId: cat, day: dayN, frequency: freq, startDate: start as ISODate, amounts: [], overrides: {}, pauses: [], createdAt: nowStamp(), updatedAt: nowStamp() };
    r = { ...r, name: maskSensitive(name.trim()).text, currency: initial ? initial.currency : cur, categoryId: cat, day: dayN, frequency: freq, startDate: start as ISODate, endDate: end || undefined };
    // Nouvelle charge : un seul montant de base, valable dès la date de début.
    if (isNew) r.amounts = [{ from: '2000-01', amount: amt.cents! }];
    if (amountChanged) r = withBaseFrom(r, applyFrom === 'this' ? cm : addMonthKey(cm, 1), amt.cents!);
    await saveRecurring(r, isNew);
    close();
  }

  return (
    <SheetBody
      foot={
        <button class="btn primary big" onClick={save}>
          {isNew ? 'Créer la charge fixe' : 'Enregistrer'}
        </button>
      }
    >
      <Field label="Nom" error={tried && !name.trim() ? 'Indiquez un nom.' : null}>
        <input class="input" value={name} placeholder="Ex. Loyer, Wi-Fi, assurance maladie" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </Field>
      <Field label="Montant de base" error={tried && !amt.cents ? 'Indiquez un montant.' : null}>
        <AmountInput text={amt.text} setText={amt.setText} big />
      </Field>
      {amountChanged && (
        <div class="field">
          <span class="lab">Nouveau montant appliqué à partir de</span>
          <Seg value={applyFrom} onChange={setApplyFrom} options={[{ value: 'this', label: monthLabel(cm) }, { value: 'next', label: monthLabel(addMonthKey(cm, 1)) }]} />
          <span class="hint">Les mois précédents gardent leur montant. Les paiements déjà confirmés ne changent pas.</span>
        </div>
      )}
      {isNew ? (
        <div class="field">
          <span class="lab">Monnaie</span>
          <CurrencySeg value={cur} onChange={setCur} />
        </div>
      ) : (
        <p class="small muted">Monnaie : {initial!.currency}</p>
      )}
      <Field label="Catégorie">
        <CategorySelect value={cat} onChange={setCat} />
      </Field>
      <div class="grid2">
        <Field label="Jour du mois">
          <input class="input num" inputMode="numeric" value={day} onInput={(e) => setDay((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 2))} />
        </Field>
        <Field label="Fréquence">
          <select class="input" value={freq} onChange={(e) => setFreq(Number((e.target as HTMLSelectElement).value) as Frequency)}>
            {[1, 2, 3, 6, 12].map((f) => (
              <option value={f}>{FREQ_LABEL[f]}</option>
            ))}
          </select>
        </Field>
      </div>
      {dayN > 28 && <p class="tiny muted">Les mois plus courts, la charge tombera le dernier jour du mois.</p>}
      <Field label="Date de début" hint={freq > 1 ? 'Le premier mois de la répétition est celui de la date de début.' : undefined}>
        <DateInput value={start} onChange={setStart} />
      </Field>
      <Field label="Date de fin (facultative)" error={tried && end && start && end < start ? 'La fin doit être après le début.' : null}>
        <DateInput value={end} onChange={setEnd} allowEmpty />
      </Field>
      {end && (
        <button class="link-btn" onClick={() => setEnd('')}>
          Retirer la date de fin
        </button>
      )}
      {!isNew && (
        <div class="section">
          <div class="grid2">
            {paused ? (
              <button
                class="btn"
                onClick={async () => {
                  await resumeRecurring(initial!);
                  close();
                }}
              >
                <Play size={18} /> Reprendre
              </button>
            ) : (
              <button
                class="btn"
                onClick={async () => {
                  await pauseRecurring(initial!);
                  close();
                }}
              >
                <Pause size={18} /> Suspendre
              </button>
            )}
            <button
              class="btn"
              style={{ color: 'var(--danger)' }}
              onClick={async () => {
                if (await deleteRecurring(initial!)) close();
              }}
            >
              <Trash2 size={18} /> Supprimer
            </button>
          </div>
          <p class="tiny muted">« Suspendre » arrête les prochaines occurrences sans rien effacer. Les paiements déjà confirmés restent toujours dans l’historique.</p>
        </div>
      )}
    </SheetBody>
  );
}

export function openRecurringForm(initial?: Recurring, presetCur?: Currency) {
  const fresh = initial ? findRecurring(initial.id) ?? initial : undefined;
  openSheet(initial ? 'Charge fixe' : 'Nouvelle charge fixe', (close) => <RecurringForm initial={fresh} close={close} presetCur={presetCur} />);
}

