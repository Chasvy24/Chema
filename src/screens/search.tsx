import { useState } from 'preact/hooks';
import { CalendarClock, FileText, PiggyBank, Repeat, Search, Wallet } from 'lucide-preact';
import { data } from '../db/store';
import { alive, catName } from '../db/actions';
import { Empty, Money, SearchBox, TopBar } from '../ui/kit';
import { fmtDate } from '../lib/dates';
import { normalize } from '../lib/categorize';
import { go, goBack } from '../ui/router';
import { openTx } from './tx';
import { openRecurringForm } from './budget';
import { needsDocsUnlock } from '../services/lock';

export function SearchScreen() {
  const [q, setQ] = useState('');
  const d = data.value;
  const words = normalize(q).split(' ').filter(Boolean);
  const match = (s: string) => words.length > 0 && words.every((w) => normalize(s).includes(w));
  const txs = words.length ? alive(d.txs).filter((t) => match(`${t.label} ${t.note ?? ''} ${catName(t.categoryId)}`)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30) : [];
  const dls = words.length ? alive(d.deadlines).filter((x) => match(`${x.title} ${x.note ?? ''}`)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30) : [];
  const docsLocked = needsDocsUnlock();
  const docs = words.length && !docsLocked ? alive(d.docs).filter((x) => match(`${x.title} ${x.note ?? ''} ${x.keywords ?? ''} ${catName(x.categoryId)}`)).slice(0, 30) : [];
  const goals = words.length ? alive(d.goals).filter((g) => match(g.name)) : [];
  const recs = words.length ? alive(d.recurring).filter((r) => match(r.name)) : [];
  const total = txs.length + dls.length + docs.length + goals.length + recs.length;
  return (
    <>
      <TopBar title="Recherche" back={() => goBack('/')} />
      <SearchBox value={q} onChange={setQ} placeholder="Dépense, échéance, document…" autoFocus />
      {!words.length ? (
        <p class="small muted" style={{ marginTop: 12 }}>
          Recherchez par titre ou libellé dans vos dépenses, échéances, documents, objectifs et charges fixes.
        </p>
      ) : total === 0 ? (
        <div class="section">
          <Empty icon={<Search size={26} />} title="Aucun résultat" text={`Rien ne correspond à « ${q} ».`} />
        </div>
      ) : (
        <>
          {dls.length > 0 && (
            <div class="section">
              <h2 style={{ fontSize: 17, marginBottom: 6 }}>Échéances</h2>
              <div class="list">
                {dls.map((x) => (
                  <button class="item" onClick={() => go(`/echeances/${x.id}`)}>
                    <div class="avatar blue">
                      <CalendarClock size={20} />
                    </div>
                    <div class="main">
                      <div class="title">{x.title}</div>
                      <div class="meta">
                        {fmtDate(x.date)} · {x.status === 'done' ? 'terminée' : 'à faire'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {docs.length > 0 && (
            <div class="section">
              <h2 style={{ fontSize: 17, marginBottom: 6 }}>Documents</h2>
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
            </div>
          )}
          {docsLocked && <p class="small muted">Le coffre est verrouillé : les documents ne sont pas inclus dans la recherche.</p>}
          {txs.length > 0 && (
            <div class="section">
              <h2 style={{ fontSize: 17, marginBottom: 6 }}>Opérations</h2>
              <div class="list">
                {txs.map((t) => (
                  <button class="item" onClick={() => openTx(t.id)}>
                    <div class="avatar">
                      <Wallet size={20} />
                    </div>
                    <div class="main">
                      <div class="title">{t.label}</div>
                      <div class="meta">
                        {fmtDate(t.date)} · {catName(t.categoryId)}
                      </div>
                    </div>
                    <Money cents={t.amount} cur={t.currency} sign={t.kind !== 'expense'} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {recs.length > 0 && (
            <div class="section">
              <h2 style={{ fontSize: 17, marginBottom: 6 }}>Charges fixes</h2>
              <div class="list">
                {recs.map((r) => (
                  <button class="item" onClick={() => openRecurringForm(r)}>
                    <div class="avatar blue">
                      <Repeat size={20} />
                    </div>
                    <div class="main">
                      <div class="title">{r.name}</div>
                      <div class="meta">{r.currency}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {goals.length > 0 && (
            <div class="section">
              <h2 style={{ fontSize: 17, marginBottom: 6 }}>Objectifs</h2>
              <div class="list">
                {goals.map((g) => (
                  <button class="item" onClick={() => go(`/epargne/${g.id}`)}>
                    <div class="avatar yellow">
                      <PiggyBank size={20} />
                    </div>
                    <div class="main">
                      <div class="title">{g.name}</div>
                      <div class="meta">{g.currency}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
