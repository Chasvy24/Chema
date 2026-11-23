import { useMemo, useState } from 'preact/hooks';
import { FileUp, ScanSearch, Check, Info } from 'lucide-preact';
import { data } from '../db/store';
import { createDetectedCharges } from '../db/actions';
import type { Frequency } from '../db/schema';
import { AmountInput, CurrencySeg, Empty, TopBar } from '../ui/kit';
import { currentMonth, fmtDate, fmtDateShort, monthShort, today } from '../lib/dates';
import { fmtMoney, parseAmount, type Currency } from '../lib/money';
import { coverage, detectRecurring, type Candidate } from '../lib/detect';
import { FREQ_LABEL } from '../lib/recurring';
import { go, goBack, route } from '../ui/router';
import { CategorySelect } from './tx';

interface Edit {
  on: boolean;
  name: string;
  amountText: string;
  frequency: Frequency;
  day: string;
  categoryId: string | null;
}

function CandidateCard({ c, e, set }: { c: Candidate; e: Edit; set: (p: Partial<Edit>) => void }) {
  const amt = { text: e.amountText, setText: (t: string) => set({ amountText: t }) };
  const cm = currentMonth();
  const thisMonth = c.matches.find((m) => m.month === cm);
  return (
    <div class="card flat" style={{ padding: 12, opacity: e.on ? 1 : 0.6 }}>
      <label class="row" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={e.on} onChange={(ev) => set({ on: (ev.target as HTMLInputElement).checked })} style={{ width: 24, height: 24, marginTop: 10, accentColor: 'var(--bordeaux)' }} aria-label={`Créer « ${e.name} »`} />
        <input class="input grow" style={{ minHeight: 44, fontSize: 16, fontWeight: 650 }} value={e.name} onInput={(ev) => set({ name: (ev.target as HTMLInputElement).value })} aria-label="Nom de la charge" />
      </label>
      <div class="row" style={{ marginTop: 8 }}>
        <div style={{ width: 130 }}>
          <AmountInput text={amt.text} setText={amt.setText} label="Montant de base" />
        </div>
        <span class="small muted">{c.currency}</span>
        <span class="grow" />
        {c.confidence === 'high' ? <span class="pill ok">Très régulier</span> : <span class="pill">À vérifier</span>}
      </div>
      {c.variable && (
        <p class="small" style={{ margin: '6px 0 0', color: 'var(--honey-ink)' }}>
          Montant variable : de {fmtMoney(c.min, c.currency)} à {fmtMoney(c.max, c.currency)}. La moyenne sert de base ; vous ajusterez le montant réel chaque mois.
        </p>
      )}
      <div class="grid2" style={{ marginTop: 8 }}>
        <select class="input" style={{ minHeight: 44, fontSize: 15 }} value={e.frequency} onChange={(ev) => set({ frequency: Number((ev.target as HTMLSelectElement).value) as Frequency })} aria-label="Fréquence">
          {[1, 2, 3, 6, 12].map((f) => (
            <option value={f}>{FREQ_LABEL[f]}</option>
          ))}
        </select>
        <label class="row" style={{ gap: 6 }}>
          <span class="small">le</span>
          <input class="input num" style={{ minHeight: 44, fontSize: 15, textAlign: 'center' }} inputMode="numeric" value={e.day} onInput={(ev) => set({ day: (ev.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 2) })} aria-label="Jour du mois" />
        </label>
      </div>
      <div style={{ marginTop: 8 }}>
        <CategorySelect value={e.categoryId} onChange={(v) => set({ categoryId: v })} />
      </div>
      <p class="tiny muted" style={{ margin: '8px 0 0' }}>
        Vue {c.matches.length} fois ({monthShort(c.firstMonth)} → {monthShort(c.lastMonth)}) : {c.matches.map((m) => fmtDateShort(m.date)).join(' · ')}
        {c.missing.length ? ` · ${c.missing.length} période(s) sans paiement trouvé` : ''}
      </p>
      <p class="tiny" style={{ margin: '3px 0 0', color: thisMonth ? 'var(--ok)' : 'var(--blue-ink)' }}>
        Ce mois-ci : {thisMonth ? `déjà payée (${fmtDate(thisMonth.date)})` : 'pas encore payée → apparaîtra comme « prévue »'}
      </p>
    </div>
  );
}

function toCents(t: string): number | null {
  const v = parseAmount(t);
  return v !== null && v !== 0 ? Math.abs(v) : null;
}

export function DetectScreen() {
  const [cur, setCur] = useState<Currency>((route.value.query.get('cur') as Currency) || data.value.settings.lastCurrency);
  // La clé remet l'analyse à zéro quand on change de monnaie.
  return <DetectBody key={cur} cur={cur} setCur={setCur} />;
}

function DetectBody({ cur, setCur }: { cur: Currency; setCur: (c: Currency) => void }) {
  const d = data.value;
  const cov = coverage(d.txs, cur);
  const cands = useMemo(() => detectRecurring(d.txs, d.recurring, cur, today()), []);
  const [edits, setEdits] = useState<Edit[]>(() =>
    cands.map((c): Edit => ({
      on: c.confidence === 'high' || !c.variable,
      name: c.name,
      amountText: (c.amount / 100).toFixed(2),
      frequency: c.frequency,
      day: String(c.day),
      categoryId: c.categoryId,
    })),
  );
  const [busy, setBusy] = useState(false);
  const chosen = cands.map((c, i) => ({ c, e: edits[i] })).filter((x) => x.e.on);
  const invalid = chosen.some((x) => !toCents(x.e.amountText) || !x.e.name.trim() || !(Number(x.e.day) >= 1 && Number(x.e.day) <= 31));

  async function create() {
    if (!chosen.length || invalid || busy) return;
    setBusy(true);
    try {
      await createDetectedCharges(chosen.map(({ c, e }) => ({ cand: c, name: e.name, amount: toCents(e.amountText)!, frequency: e.frequency, day: Number(e.day), categoryId: e.categoryId })));
      go('/budget/charges');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar title="Détection des charges" sub="Analyse faite sur ce téléphone" back={() => goBack('/budget/charges')} />
      <CurrencySeg value={cur} onChange={setCur} />
      {!cov || cov.months < 2 ? (
        <div class="section">
          <Empty
            icon={<FileUp size={26} />}
            title="Importez d’abord vos relevés"
            text={`Chema a besoin d’au moins 2 mois d’opérations ${cur} (idéalement 3 à 6) pour repérer les paiements qui reviennent. ${cov ? `Actuellement : ${cov.count} opération(s) sur ${cov.months} mois.` : 'Aucune opération pour l’instant.'}`}
          >
            <button class="btn primary" onClick={() => go('/budget/import')}>
              Importer un relevé CSV
            </button>
          </Empty>
        </div>
      ) : (
        <>
          <div class="callout blue">
            <Info size={16} style={{ verticalAlign: '-3px' }} /> Analyse de {cov.count} dépenses {cur} du {fmtDate(cov.from)} au {fmtDate(cov.to)} ({cov.months} mois). Chema cherche les paiements au même bénéficiaire, vers le même jour, avec un montant stable ou proche. Rien n’est créé sans votre validation.
          </div>
          {cands.length ? (
            <>
              <h2 style={{ fontSize: 18, margin: '16px 0 8px' }}>
                {cands.length} charge{cands.length > 1 ? 's' : ''} fixe{cands.length > 1 ? 's' : ''} trouvée{cands.length > 1 ? 's' : ''}
              </h2>
              <p class="small muted" style={{ marginTop: 0 }}>
                Vérifiez le nom, le montant, le jour et la catégorie. Décochez ce qui n’est pas une charge fixe.
              </p>
              <div class="stack">
                {cands.map((c, i) => (
                  <CandidateCard key={c.key} c={c} e={edits[i]} set={(p) => setEdits(edits.map((x, k) => (k === i ? { ...x, ...p } : x)))} />
                ))}
              </div>
              <div class="callout" style={{ marginTop: 14 }}>
                Les paiements déjà importés seront rattachés à leur charge fixe : les mois passés restent justes, sans double comptage. Les mois passés sans paiement retrouvé seront marqués « ignorés ».
              </div>
              <button class="btn primary big block" style={{ marginTop: 14 }} disabled={!chosen.length || invalid || busy} onClick={create}>
                <Check size={20} /> Créer {chosen.length} charge{chosen.length > 1 ? 's' : ''} fixe{chosen.length > 1 ? 's' : ''}
              </button>
              {invalid && <p class="error">Vérifiez le nom, le montant et le jour (1 à 31) des charges cochées.</p>}
            </>
          ) : (
            <div class="section">
              <Empty icon={<ScanSearch size={26} />} title="Aucune nouvelle charge fixe trouvée" text={`Aucun paiement ${cur} régulier qui ne soit pas déjà enregistré. Importez davantage de mois, ou ajoutez une charge à la main.`}>
                <button class="btn" onClick={() => go('/budget/import')}>
                  Importer un autre relevé
                </button>
              </Empty>
            </div>
          )}
        </>
      )}
      <p class="small muted" style={{ marginTop: 14 }}>
        Astuce : importez un relevé par compte (CHF ou MAD) couvrant plusieurs mois. Les achats fréquents (courses…), les retraits d’espèces et les abonnements arrêtés ne sont pas proposés.
      </p>
    </>
  );
}

