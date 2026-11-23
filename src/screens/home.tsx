import { AlertTriangle, BellRing, CalendarClock, ChevronRight, PiggyBank, Search, Settings, X, Download, HardDriveDownload } from 'lucide-preact';
import { data } from '../db/store';
import { alive } from '../db/actions';
import { BudgetBar, BigMoney, Empty } from '../ui/kit';
import { currentMonth, diffDays, monthLabel, today } from '../lib/dates';
import { fmtMoney, type Currency } from '../lib/money';
import { isOverdue, sortDeadlines } from '../lib/deadlines';
import { go } from '../ui/router';
import { useStats } from './budget';
import { DeadlineRow, openDeadlineForm, startComplete } from './deadlines';
import { GoalRow, openGoalForm } from './savings';
import { dismissMissed, missedNow } from '../services/reminders';
import { installState, promptInstall } from '../services/install';

function BudgetCard({ cur }: { cur: Currency }) {
  const s = useStats(cur, currentMonth());
  return (
    <button class={`card tap budget-card ${cur === 'CHF' ? 'blue' : 'cream mad'}`} onClick={() => go(`/budget?cur=${cur}`)} aria-label={`Budget ${cur}`}>
      <div class="cur">
        <span>{cur}</span>
        <ChevronRight size={16} />
      </div>
      {s.remaining === null ? (
        <>
          <div class="big" style={{ fontSize: 17, margin: '8px 0 6px' }}>
            Budget à fixer
          </div>
          <div class="label">Dépensé : {fmtMoney(s.confirmed, cur)}</div>
          <div class="label">Prévu : {fmtMoney(s.planned, cur)}</div>
        </>
      ) : (
        <>
          <div class="label">Reste selon budget</div>
          <div class={`big ${s.remaining < 0 ? 'neg' : ''}`}>
            <BigMoney cents={s.remaining} cur={cur} />
          </div>
          <BudgetBar confirmed={Math.max(0, s.confirmed)} planned={s.planned} budget={s.budget} level={s.level} />
          {s.level === 'warn' && <div class="level-note warn">80 % atteint</div>}
          {s.level === 'over' && <div class="level-note over">Dépassé</div>}
          <div style={{ marginTop: 6 }}>
            <div class="kv">
              <span>Budget</span>
              <b class="num">{fmtMoney(s.budget!, cur, { decimals: false })}</b>
            </div>
            <div class="kv">
              <span>
                <i class="dot" style={{ background: s.level === 'over' ? 'var(--danger-fill)' : s.level === 'warn' ? 'var(--warn-fill)' : 'var(--steel)' }} />
                Dépensé
              </span>
              <b class="num">{fmtMoney(s.confirmed, cur, { decimals: false })}</b>
            </div>
            <div class="kv">
              <span>
                <i class="dot" style={{ background: 'var(--steel-light)' }} />
                Prévu
              </span>
              <b class="num">{fmtMoney(s.planned, cur, { decimals: false })}</b>
            </div>
          </div>
        </>
      )}
    </button>
  );
}

export function HomeScreen() {
  const d = data.value;
  const t = today();
  const open = alive(d.deadlines).filter((x) => x.status !== 'done');
  const overdue = open.filter((x) => isOverdue(x));
  const upcoming = sortDeadlines(open).slice(0, Math.max(3, Math.min(5, overdue.length + 3)));
  const goals = alive(d.goals)
    .filter((g) => !g.achievedAt)
    .sort((a, b) => a.order - b.order);
  const missed = missedNow();
  const noBudget = !d.settings.budgets.CHF.length && !d.settings.budgets.MAD.length;
  const hasData = d.txs.length + d.docs.length > 0;
  const backupAge = d.settings.lastBackupAt ? diffDays(d.settings.lastBackupAt.slice(0, 10), t) : null;
  const backupDue = hasData && (backupAge === null ? diffDays(d.settings.createdAt.slice(0, 10), t) >= 7 : backupAge >= 30);
  const inst = installState.value;
  return (
    <>
      <header class="topbar">
        <h1>
          {monthLabel(currentMonth())}
          <span class="sub">Chema · budgets CHF et MAD</span>
        </h1>
        <button class="icon-btn soft" aria-label="Rechercher" onClick={() => go('/recherche')}>
          <Search size={22} />
        </button>
        <button class="icon-btn soft" aria-label="Réglages" onClick={() => go('/reglages')}>
          <Settings size={22} />
        </button>
      </header>

      {inst.canSuggest && (
        <div class="banner" style={{ marginBottom: 10 }}>
          <Download size={20} />
          <span class="grow">
            <b>Installez l’app sur l’écran d’accueil</b> pour l’ouvrir hors ligne et mieux protéger vos données.{' '}
            {inst.ios ? 'Dans Safari : bouton Partager › « Sur l’écran d’accueil ».' : ''}
            {inst.prompt && (
              <button class="btn sm primary" style={{ marginTop: 6 }} onClick={promptInstall}>
                Installer
              </button>
            )}
          </span>
        </div>
      )}

      {overdue.length > 0 && (
        <button class="banner red" style={{ marginBottom: 10 }} onClick={() => go('/echeances?f=late')}>
          <AlertTriangle size={20} />
          <span class="grow">
            <b>
              {overdue.length} échéance{overdue.length > 1 ? 's' : ''} dépassée{overdue.length > 1 ? 's' : ''}
            </b>{' '}
            et non terminée{overdue.length > 1 ? 's' : ''} : {overdue.slice(0, 2).map((x) => x.title).join(', ')}
            {overdue.length > 2 ? '…' : ''}
          </span>
        </button>
      )}

      {missed.length > 0 && (
        <div class="banner yellow" style={{ marginBottom: 10 }}>
          <BellRing size={20} />
          <span class="grow">
            <b>Rappels manqués depuis votre dernière visite :</b> {missed.map((x) => x.title).join(', ')}.
          </span>
          <button class="icon-btn" style={{ width: 32, height: 32, color: 'inherit' }} aria-label="Masquer" onClick={dismissMissed}>
            <X size={18} />
          </button>
        </div>
      )}

      {backupDue && (
        <button class="banner" style={{ marginBottom: 10 }} onClick={() => go('/reglages/sauvegarde')}>
          <HardDriveDownload size={20} />
          <span class="grow">
            {backupAge === null ? 'Aucune sauvegarde encore.' : `Dernière sauvegarde il y a ${backupAge} jours.`} Vos données ne sont que sur ce téléphone : <b>faire une sauvegarde</b>.
          </span>
        </button>
      )}

      {noBudget && (
        <button class="banner yellow" style={{ marginBottom: 10 }} onClick={() => go('/reglages/budgets')}>
          <PiggyBank size={20} />
          <span class="grow">
            <b>Pour commencer :</b> fixez vos budgets mensuels CHF et MAD.
          </span>
        </button>
      )}

      <div class="grid2">
        <BudgetCard cur="CHF" />
        <BudgetCard cur="MAD" />
      </div>

      <section class="section">
        <div class="section-head">
          <h2>À venir</h2>
          <button class="link-btn" onClick={() => go('/echeances')}>
            Tout voir
          </button>
        </div>
        {upcoming.length ? (
          <div class="list">
            {upcoming.map((x) => (
              <DeadlineRow d={x} onCheck={startComplete} />
            ))}
          </div>
        ) : (
          <Empty icon={<CalendarClock size={26} />} title="Aucune échéance" text="Factures, résiliations, impôts, documents qui expirent : ajoutez-les pour ne rien oublier.">
            <button class="btn sm primary" onClick={() => openDeadlineForm()}>
              Ajouter une échéance
            </button>
          </Empty>
        )}
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Épargne</h2>
          <button class="link-btn" onClick={() => go('/epargne')}>
            {goals.length ? 'Tout voir' : 'Ouvrir'}
          </button>
        </div>
        {goals.length ? (
          <div class="list">
            {goals.slice(0, 3).map((g) => (
              <GoalRow g={g} compact />
            ))}
          </div>
        ) : (
          <Empty icon={<PiggyBank size={26} />} title="Aucun objectif" text="Appartement au Maroc, formation, voyage… Suivez chaque objectif dans sa monnaie.">
            <button class="btn sm primary" onClick={() => openGoalForm()}>
              Créer un objectif
            </button>
          </Empty>
        )}
      </section>
    </>
  );
}
