import { useState } from 'preact/hooks';
import { PiggyBank, Plus, Minus, Pencil, Trash2, Trophy, Target } from 'lucide-preact';
import { data, uid, nowStamp } from '../db/store';
import { addMove, alive, deleteGoal, deleteMove, findGoal, saveGoal } from '../db/actions';
import type { Goal } from '../db/schema';
import { AmountInput, CurrencySeg, DateInput, Empty, Field, Money, SaveBar, Seg, SheetBody, TopBar, useAmount } from '../ui/kit';
import { fmtDate, today, type ISODate } from '../lib/dates';
import { fmtMoney, type Currency } from '../lib/money';
import { goalProgress, monthlyNeeded } from '../lib/savings';
import { go, goBack, openSheet } from '../ui/router';

export function GoalRow({ g, compact }: { g: Goal; compact?: boolean }) {
  const p = goalProgress(g, data.value.moves);
  const m = monthlyNeeded(g, p.current);
  return (
    <button class="item" onClick={() => go(`/epargne/${g.id}`)} style={compact ? { minHeight: 52, padding: '10px 14px' } : undefined}>
      <div class="main">
        <div class="row" style={{ justifyContent: 'space-between' }}>
          <span class="title">{g.name}</span>
          <span class="small num" style={{ fontWeight: 700, color: 'var(--honey-ink)' }}>
            {Math.round(p.pct * 100)} %
          </span>
        </div>
        <div style={{ margin: '6px 0 4px' }}>
          <SaveBar pct={p.pct} />
        </div>
        <div class="meta">
          <span class="num">{fmtMoney(p.current, g.currency, { decimals: false })}</span> / <span class="num">{fmtMoney(g.target, g.currency, { decimals: false })}</span>
          {g.targetDate ? ` · d’ici le ${fmtDate(g.targetDate)}` : ''}
          {!compact && m && !p.reached ? ` · ≈ ${fmtMoney(m.perMonth, g.currency, { decimals: false })}/mois` : ''}
        </div>
      </div>
    </button>
  );
}

export function SavingsScreen() {
  const [tab, setTab] = useState<'active' | 'done'>('active');
  const goals = alive(data.value.goals).sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
  const active = goals.filter((g) => !g.achievedAt);
  const done = goals.filter((g) => g.achievedAt);
  const list = tab === 'active' ? active : done;
  return (
    <>
      <TopBar title="Épargne" sub="Chaque objectif reste dans sa monnaie" back={() => goBack('/')}>
        <button class="icon-btn soft" aria-label="Nouvel objectif" onClick={() => openGoalForm()}>
          <Plus size={24} />
        </button>
      </TopBar>
      <Seg value={tab} onChange={setTab} options={[{ value: 'active', label: `En cours (${active.length})` }, { value: 'done', label: `Réalisés (${done.length})` }]} />
      <div class="section">
        {list.length ? (
          <div class="list">
            {list.map((g) => (
              <GoalRow g={g} />
            ))}
          </div>
        ) : tab === 'active' ? (
          <Empty icon={<PiggyBank size={26} />} title="Aucun objectif en cours" text="Créez un objectif (appartement au Maroc, formation, voyage, coussin de sécurité…) et suivez vos versements.">
            <button class="btn primary" onClick={() => openGoalForm()}>
              Créer un objectif
            </button>
          </Empty>
        ) : (
          <Empty icon={<Trophy size={26} />} title="Pas encore d’objectif réalisé" text="Un objectif atteint apparaîtra ici automatiquement." />
        )}
      </div>
      <p class="small muted" style={{ marginTop: 14 }}>
        Un versement vers un objectif apparaît dans le bilan du mois, mais ne réduit pas votre « restant à dépenser ». Les objectifs CHF et MAD ne sont jamais additionnés.
      </p>
    </>
  );
}

export function GoalDetail({ id }: { id: string }) {
  const g = findGoal(id);
  if (!g || g.deletedAt) {
    return (
      <>
        <TopBar title="Objectif" back={() => goBack('/epargne')} />
        <Empty icon={<Target size={26} />} title="Introuvable" text="Cet objectif a été supprimé." />
      </>
    );
  }
  const moves = data.value.moves.filter((m) => m.goalId === g.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const p = goalProgress(g, data.value.moves);
  const m = monthlyNeeded(g, p.current);
  return (
    <>
      <TopBar title={g.name} sub={`Objectif en ${g.currency}${g.achievedAt ? ' · réalisé' : ''}`} back={() => goBack('/epargne')}>
        <button class="icon-btn" aria-label="Modifier" onClick={() => openGoalForm(g)}>
          <Pencil size={22} />
        </button>
      </TopBar>
      <div class="card yellow">
        <div class="small" style={{ color: 'var(--honey-ink)', fontWeight: 700 }}>
          {Math.round(p.pct * 100)} % atteint
        </div>
        <div class="hero" style={{ fontSize: 32, margin: '2px 0 8px' }}>
          <Money cents={p.current} cur={g.currency} />
        </div>
        <SaveBar pct={p.pct} />
        <div class="kv" style={{ marginTop: 8 }}>
          <span>Montant visé</span>
          <b>
            <Money cents={g.target} cur={g.currency} />
          </b>
        </div>
        <div class="kv">
          <span>Reste à épargner</span>
          <b>
            <Money cents={p.remaining} cur={g.currency} />
          </b>
        </div>
        {g.targetDate && (
          <div class="kv">
            <span>Date cible</span>
            <b class="num">{fmtDate(g.targetDate)}</b>
          </div>
        )}
        {m && !p.reached && (
          <div class="callout" style={{ background: '#fff' }}>
            {m.late ? (
              <>La date cible est dépassée. Il manque {fmtMoney(m.perMonth, g.currency)}.</>
            ) : (
              <>
                Pour y arriver à temps : environ <b>{fmtMoney(m.perMonth, g.currency)} par mois</b> pendant {m.months} mois (estimation).
              </>
            )}
          </div>
        )}
        {p.reached && <div class="callout" style={{ background: '#fff' }}>🎉 Objectif atteint ! Il figure dans « Réalisés ».</div>}
      </div>
      <div class="grid2" style={{ marginTop: 12 }}>
        <button class="btn primary big" onClick={() => openMoveForm(g, 1)}>
          <Plus size={20} /> Verser
        </button>
        <button class="btn big" onClick={() => openMoveForm(g, -1)}>
          <Minus size={20} /> Retirer
        </button>
      </div>
      <div class="section">
        <h2 style={{ fontSize: 17, marginBottom: 8 }}>Historique</h2>
        {moves.length ? (
          <div class="list">
            {moves.map((mv) => (
              <div class="item">
                <div class="main">
                  <div class="title">{mv.amount >= 0 ? 'Versement' : 'Retrait'}</div>
                  <div class="meta">
                    {fmtDate(mv.date)}
                    {mv.note ? ` · ${mv.note}` : ''}
                  </div>
                </div>
                <Money cents={mv.amount} cur={g.currency} sign cls={mv.amount >= 0 ? 'amount-pos' : ''} />
                <button class="icon-btn" aria-label="Supprimer ce mouvement" onClick={() => deleteMove(mv)}>
                  <Trash2 size={18} color="var(--ink-3)" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p class="small muted">Aucun mouvement pour l’instant.</p>
        )}
      </div>
      <div class="section">
        <button
          class="btn block ghost"
          style={{ color: 'var(--danger)' }}
          onClick={async () => {
            if (await deleteGoal(g)) go('/epargne');
          }}
        >
          <Trash2 size={18} /> Supprimer l’objectif
        </button>
      </div>
    </>
  );
}

const EXAMPLES = ['Appartement au Maroc', 'Formations', 'Voyage', 'Coussin de sécurité'];

function GoalForm({ initial, close }: { initial?: Goal; close: () => void }) {
  const isNew = !initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [cur, setCur] = useState<Currency>(initial?.currency ?? 'CHF');
  const target = useAmount(initial?.target ?? null);
  const start = useAmount(null);
  const [date, setDate] = useState<ISODate | ''>(initial?.targetDate ?? '');
  const [tried, setTried] = useState(false);
  const ok = name.trim() && target.cents && target.cents > 0;
  return (
    <SheetBody
      foot={
        <button
          class="btn primary big"
          onClick={async () => {
            setTried(true);
            if (!ok) return;
            const g: Goal = {
              ...(initial ?? { id: uid(), order: alive(data.value.goals).length, createdAt: nowStamp(), updatedAt: nowStamp() }),
              name: name.trim(),
              currency: initial?.currency ?? cur,
              target: target.cents!,
              targetDate: date || undefined,
            } as Goal;
            await saveGoal(g, isNew, start.cents ?? 0);
            close();
            if (isNew) go(`/epargne/${g.id}`);
          }}
        >
          {isNew ? 'Créer l’objectif' : 'Enregistrer'}
        </button>
      }
    >
      <Field label="Nom" error={tried && !name.trim() ? 'Donnez un nom à l’objectif.' : null}>
        <input class="input" value={name} placeholder="Ex. Voyage" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </Field>
      {isNew && (
        <div class="chips" style={{ marginTop: 8 }}>
          {EXAMPLES.map((x) => (
            <button type="button" class="chip small" onClick={() => setName(x)}>
              {x}
            </button>
          ))}
        </div>
      )}
      {isNew ? (
        <div class="field">
          <span class="lab">Monnaie</span>
          <CurrencySeg value={cur} onChange={setCur} />
        </div>
      ) : (
        <p class="small muted">Monnaie : {initial!.currency} (non modifiable, aucune conversion).</p>
      )}
      <Field label={`Montant visé (${isNew ? cur : initial!.currency})`} error={tried && !target.cents ? 'Indiquez le montant visé.' : null}>
        <AmountInput text={target.text} setText={target.setText} big />
      </Field>
      {isNew && (
        <Field label="Déjà épargné (facultatif)">
          <AmountInput text={start.text} setText={start.setText} />
        </Field>
      )}
      <Field label="Date cible (facultative)" hint="Permet d’estimer le montant à épargner chaque mois.">
        <DateInput value={date} onChange={setDate} allowEmpty min={today()} />
      </Field>
      {date && (
        <button class="link-btn" onClick={() => setDate('')}>
          Retirer la date cible
        </button>
      )}
    </SheetBody>
  );
}

export function openGoalForm(initial?: Goal) {
  openSheet(initial ? 'Modifier l’objectif' : 'Nouvel objectif', (close) => <GoalForm initial={initial} close={close} />);
}

function MoveForm({ g, sign, close }: { g: Goal; sign: 1 | -1; close: () => void }) {
  const amt = useAmount(null);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const p = goalProgress(g, data.value.moves);
  const tooMuch = sign < 0 && amt.cents !== null && amt.cents > p.current;
  return (
    <SheetBody
      foot={
        <button
          class="btn primary big"
          disabled={!amt.cents || tooMuch}
          onClick={async () => {
            await addMove(g, sign * amt.cents!, date, note);
            close();
          }}
        >
          {sign > 0 ? 'Ajouter le versement' : 'Enregistrer le retrait'}
        </button>
      }
    >
      <p class="small muted" style={{ marginTop: 0 }}>
        {g.name} · actuellement {fmtMoney(p.current, g.currency)}
      </p>
      <Field label={`Montant (${g.currency})`}>
        <AmountInput text={amt.text} setText={amt.setText} big autoFocus />
      </Field>
      {tooMuch && <p class="error">Le retrait dépasse le montant épargné.</p>}
      <Field label="Date">
        <DateInput value={date} onChange={(v) => v && setDate(v)} />
      </Field>
      <Field label="Note (facultative)">
        <input class="input" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
      </Field>
    </SheetBody>
  );
}

export function openMoveForm(g: Goal, sign: 1 | -1) {
  openSheet(sign > 0 ? 'Versement' : 'Retrait', (close) => <MoveForm g={g} sign={sign} close={close} />);
}
