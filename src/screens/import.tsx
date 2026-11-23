import { useMemo, useState } from 'preact/hooks';
import { FileUp, ShieldCheck, AlertTriangle, Check, Repeat, Copy, ScanSearch } from 'lucide-preact';
import { data, commit, put, setSettings, type Change } from '../db/store';
import { categoriesOf, makeTx } from '../db/actions';
import { coverage, detectRecurring } from '../lib/detect';
import { today } from '../lib/dates';
import { CurrencySeg, Seg, TopBar, Money } from '../ui/kit';
import { analyzeColumns, decodeBytes, detectDelimiter, detectHeaderRow, extractRows, findDuplicate, guessMapping, matchOccurrence, parseCSV, type ColumnMapping, type ParsedRow } from '../lib/csv';
import { suggestCategory, labelKey } from '../lib/categorize';
import { occurrencesForMonth, paidIndex, type Occurrence } from '../lib/recurring';
import { fmtDate, monthOf } from '../lib/dates';
import { fmtMoney, type Currency } from '../lib/money';
import type { Tx } from '../db/schema';
import { go, goBack } from '../ui/router';
import { toast } from '../ui/feedback';

type Step = 'file' | 'map' | 'review' | 'confirm' | 'done';

interface Review {
  row: ParsedRow & { date: string; amount: number };
  include: boolean;
  kind: 'expense' | 'refund' | 'income';
  categoryId: string | null;
  dup: Tx | null;
  occ: Occurrence | null;
  linkOcc: boolean;
}

interface Summary {
  expenses: number;
  refunds: number;
  incomes: number;
  paidCharges: number;
  dupSkipped: number;
  dupAdded: number;
  unchecked: number;
  unreadable: number;
  masked: number;
}

const REFUND_RE = /(rembours|retour|gutschrift|r[üu]ckerstattung|refund|storno|annulation|avoir|cr[ée]dit note|restitution)/i;

function Steps({ step }: { step: Step }) {
  const order: Step[] = ['file', 'map', 'review', 'confirm', 'done'];
  const i = order.indexOf(step);
  return (
    <div class="steps" aria-label={`Étape ${i + 1} sur 5`}>
      {order.map((_, k) => (
        <span class={k <= i ? 'on' : ''} />
      ))}
    </div>
  );
}

export function ImportScreen() {
  const [step, setStep] = useState<Step>('file');
  const [cur, setCur] = useState<Currency>(data.value.settings.lastCurrency);
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [delim, setDelim] = useState(';');
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState<ColumnMapping | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => (text ? parseCSV(text, delim) : []), [text, delim]);
  const header = headerRow >= 0 ? rows[headerRow] ?? null : null;
  const cols = useMemo(() => analyzeColumns(header, rows.slice(headerRow + 1)), [rows, headerRow]);
  const parsed = useMemo(() => (map && rows.length ? extractRows(rows, headerRow, map) : []), [rows, headerRow, map]);
  const okRows = parsed.filter((p) => p.ok);
  const badRows = parsed.filter((p) => !p.ok);

  async function onFile(f: File) {
    if (f.size > 15 * 1024 * 1024) return toast('Fichier trop volumineux pour un relevé (15 Mo max).', { tone: 'error' });
    const t = decodeBytes(await f.arrayBuffer());
    const d = detectDelimiter(t);
    const r = parseCSV(t, d);
    if (r.length < 2) return toast('Ce fichier ne ressemble pas à un relevé CSV lisible.', { tone: 'error' });
    const h = detectHeaderRow(r);
    setText(t);
    setFileName(f.name);
    setDelim(d);
    setHeaderRow(h);
    setMap(guessMapping(analyzeColumns(h >= 0 ? r[h] : null, r.slice(h + 1))));
    setStep('map');
  }

  function changeHeader(h: number) {
    const nh = Math.max(-1, Math.min(rows.length - 2, h));
    setHeaderRow(nh);
    setMap(guessMapping(analyzeColumns(nh >= 0 ? rows[nh] : null, rows.slice(nh + 1))));
  }

  function buildReviews() {
    const d = data.value;
    const paid = paidIndex(d.txs);
    const occCache = new Map<string, Occurrence[]>();
    const occFor = (m: string) => {
      if (!occCache.has(m)) occCache.set(m, occurrencesForMonth(d.recurring.filter((r) => r.currency === cur), paid, m));
      return occCache.get(m)!;
    };
    const used = new Set<string>();
    const list: Review[] = okRows.map((p) => {
      const row = p as Review['row'];
      const credit = !!p.credit;
      const kind: Review['kind'] = credit ? (REFUND_RE.test(p.label) ? 'refund' : 'income') : 'expense';
      const dup = findDuplicate(row, cur, d.txs);
      let occ: Occurrence | null = null;
      if (!credit) {
        const m = monthOf(row.date);
        occ = matchOccurrence(row, [...occFor(m), ...occFor(monthOf(addDaysSafe(row.date, -10))), ...occFor(monthOf(addDaysSafe(row.date, 10)))].filter((o) => !used.has(o.key)));
        if (occ) used.add(occ.key);
      }
      const categoryId = occ ? occ.rec.categoryId : suggestCategory(p.label, d.categories, d.settings.labelRules);
      return { row, include: !dup, kind, categoryId: kind === 'income' ? null : categoryId, dup, occ, linkOcc: !!occ && !dup };
    });
    setReviews(list);
    setStep('review');
  }

  function patch(i: number, p: Partial<Review>) {
    setReviews(reviews.map((r, k) => (k === i ? { ...r, ...p } : r)));
  }

  const toImport = reviews.filter((r) => r.include);

  async function doImport() {
    setBusy(true);
    try {
      const changes: Change[] = [];
      const rules = { ...data.value.settings.labelRules };
      let s: Summary = { expenses: 0, refunds: 0, incomes: 0, paidCharges: 0, dupSkipped: 0, dupAdded: 0, unchecked: 0, unreadable: badRows.length, masked: 0 };
      for (const r of reviews) {
        if (r.row.maskedCount) s.masked += r.row.maskedCount;
        if (!r.include) {
          if (r.dup) s.dupSkipped++;
          else s.unchecked++;
          continue;
        }
        if (r.dup) s.dupAdded++;
        const link = r.kind === 'expense' && r.linkOcc && r.occ;
        const t = makeTx({
          kind: r.kind,
          amount: r.row.amount,
          currency: cur,
          categoryId: r.categoryId,
          label: r.row.label,
          date: r.row.date,
          month: link ? r.occ!.month : undefined,
          occurrence: link ? r.occ!.key : undefined,
          source: 'csv',
        });
        changes.push(put('txs', t));
        if (r.kind === 'expense') {
          s.expenses++;
          if (link) s.paidCharges++;
          const k = labelKey(r.row.label);
          if (k && r.categoryId) rules[k] = r.categoryId;
        } else if (r.kind === 'refund') s.refunds++;
        else s.incomes++;
      }
      changes.push(setSettings({ labelRules: rules, lastCurrency: cur }));
      const n = s.expenses + s.refunds + s.incomes;
      await commit(changes, { message: `${n} opération${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''} dans le budget ${cur}`, undo: true });
      setSummary(s);
      // Le contenu brut du fichier n'est pas conservé.
      setText(null);
      setReviews([]);
      setStep('done');
    } finally {
      setBusy(false);
    }
  }

  const colOptions = (allowNone = false) => (
    <>
      {allowNone && <option value={-1}>Aucune</option>}
      {cols.map((c) => (
        <option value={c.index} disabled={c.sensitive}>
          {c.name}
          {c.sensitive ? ' (numéros — non importée)' : ''}
        </option>
      ))}
    </>
  );

  const set = (p: Partial<ColumnMapping>) => setMap({ ...map!, ...p });
  const cats = categoriesOf('expense');
  const dupCount = reviews.filter((r) => r.dup).length;

  return (
    <>
      <TopBar title="Importer un relevé" sub={fileName || 'Fichier CSV de votre banque'} back={() => goBack('/budget')} />
      <Steps step={step} />

      {step === 'file' && (
        <>
          <div class="callout blue">
            <ShieldCheck size={18} style={{ verticalAlign: '-3px' }} /> Téléchargez vous-même le relevé au format CSV depuis votre e-banking, puis choisissez-le ici. Aucune connexion à votre banque, aucun mot de passe demandé. Le fichier est lu sur le téléphone puis oublié : seules les opérations validées sont enregistrées.
          </div>
          <div class="field">
            <span class="lab">Monnaie du compte</span>
            <CurrencySeg value={cur} onChange={setCur} />
            <span class="hint">Toutes les opérations iront dans le budget {cur}. Un relevé = une monnaie.</span>
          </div>
          <label class="btn primary big block" style={{ marginTop: 18 }}>
            <FileUp size={20} /> Choisir le fichier CSV
            <input type="file" accept=".csv,text/csv,text/plain,application/vnd.ms-excel" class="sr-only" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onFile(f); }} />
          </label>
          <p class="small muted">Formats acceptés : séparateurs « ; » « , » ou tabulation ; dates 31.12.2026, 31/12/2026, 2026-12-31… ; montants 1’234.50, 1 234,50, -12.50… Les colonnes contenant des numéros de compte ou de carte ne sont jamais importées.</p>
        </>
      )}

      {step === 'map' && map && (
        <>
          <h2 style={{ fontSize: 18, margin: '4px 0 8px' }}>Aperçu et colonnes</h2>
          <div class="table-wrap" style={{ maxHeight: 230 }}>
            <table>
              <tbody>
                {rows.slice(Math.max(0, headerRow), Math.max(0, headerRow) + 8).map((r, i) => (
                  <tr class={i === 0 && headerRow >= 0 ? 'hl' : ''}>
                    {r.map((c, k) => (
                      <td>{cols[k]?.sensitive && !(i === 0 && headerRow >= 0) ? '•••• masqué' : c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="row" style={{ marginTop: 10 }}>
            <span class="grow small">
              Ligne d’en-tête : <b>{headerRow >= 0 ? `ligne ${headerRow + 1}` : 'aucune'}</b>
            </span>
            <button class="btn sm" onClick={() => changeHeader(headerRow - 1)} aria-label="En-tête plus haut">
              −
            </button>
            <button class="btn sm" onClick={() => changeHeader(headerRow + 1)} aria-label="En-tête plus bas">
              +
            </button>
          </div>
          {cols.some((c) => c.sensitive) && (
            <div class="callout red">
              Colonne(s) avec numéros de compte ou de carte détectée(s) : <b>{cols.filter((c) => c.sensitive).map((c) => c.name).join(', ')}</b>. Elles ne seront ni importées ni conservées.
            </div>
          )}
          <div class="grid2">
            <label class="field">
              <span class="lab">Date</span>
              <select class="input" value={map.date} onChange={(e) => set({ date: +(e.target as HTMLSelectElement).value })}>
                {colOptions()}
              </select>
            </label>
            <label class="field">
              <span class="lab">Format des dates</span>
              <select class="input" value={map.dateOrder} onChange={(e) => set({ dateOrder: (e.target as HTMLSelectElement).value as ColumnMapping['dateOrder'] })}>
                <option value="auto">Automatique</option>
                <option value="dmy">jj.mm.aaaa</option>
                <option value="mdy">mm/jj/aaaa</option>
                <option value="ymd">aaaa-mm-jj</option>
              </select>
            </label>
          </div>
          <div class="grid2">
            <label class="field">
              <span class="lab">Libellé</span>
              <select class="input" value={map.label} onChange={(e) => set({ label: +(e.target as HTMLSelectElement).value })}>
                {colOptions()}
              </select>
            </label>
            <label class="field">
              <span class="lab">Libellé (suite)</span>
              <select class="input" value={map.label2} onChange={(e) => set({ label2: +(e.target as HTMLSelectElement).value })}>
                {colOptions(true)}
              </select>
            </label>
          </div>
          <div class="field">
            <span class="lab">Montants</span>
            <Seg value={map.mode} onChange={(m) => set({ mode: m })} options={[{ value: 'single', label: 'Une colonne' }, { value: 'split', label: 'Débit / Crédit' }]} />
          </div>
          {map.mode === 'single' ? (
            <>
              <label class="field">
                <span class="lab">Colonne du montant</span>
                <select class="input" value={map.amount} onChange={(e) => set({ amount: +(e.target as HTMLSelectElement).value })}>
                  {colOptions()}
                </select>
              </label>
              <div class="field">
                <span class="lab">Dans ce fichier, les dépenses sont…</span>
                <Seg value={map.sign} onChange={(v) => set({ sign: v })} options={[{ value: 'negative', label: 'négatives (−)' }, { value: 'positive', label: 'positives' }]} />
              </div>
            </>
          ) : (
            <div class="grid2">
              <label class="field">
                <span class="lab">Débit (dépenses)</span>
                <select class="input" value={map.debit} onChange={(e) => set({ debit: +(e.target as HTMLSelectElement).value })}>
                  {colOptions(true)}
                </select>
              </label>
              <label class="field">
                <span class="lab">Crédit (entrées)</span>
                <select class="input" value={map.credit} onChange={(e) => set({ credit: +(e.target as HTMLSelectElement).value })}>
                  {colOptions(true)}
                </select>
              </label>
            </div>
          )}
          <label class="field">
            <span class="lab">Séparateur</span>
            <select class="input" value={delim} onChange={(e) => setDelim((e.target as HTMLSelectElement).value)}>
              <option value=";">Point-virgule ( ; )</option>
              <option value=",">Virgule ( , )</option>
              <option value={'\t'}>Tabulation</option>
              <option value="|">Barre ( | )</option>
            </select>
          </label>
          <div class={`callout ${okRows.length ? 'blue' : 'red'}`}>
            <b>{okRows.length}</b> opération(s) lisible(s){badRows.length ? `, ${badRows.length} ligne(s) non interprétable(s)` : ''}.
            {okRows[0] && (
              <>
                <br />
                Exemple : {fmtDate(okRows[0].date!)} · {okRows[0].label} · {okRows[0].credit ? '+' : '−'}
                {fmtMoney(okRows[0].amount!, cur)}
              </>
            )}
          </div>
          <div class="row" style={{ marginTop: 14 }}>
            <button class="btn" onClick={() => { setText(null); setStep('file'); }}>
              Autre fichier
            </button>
            <button class="btn primary grow" disabled={!okRows.length} onClick={buildReviews}>
              Vérifier les opérations
            </button>
          </div>
        </>
      )}

      {step === 'review' && (
        <>
          <p class="small" style={{ marginTop: 0 }}>
            Vérifiez chaque ligne : catégorie proposée (modifiable), entrées d’argent, doublons possibles. Rien n’est enregistré avant la confirmation.
          </p>
          {dupCount > 0 && (
            <div class="banner warn" style={{ marginBottom: 10 }}>
              <Copy size={18} />
              <span>
                <b>{dupCount} doublon(s) possible(s)</b> : décoché(s) par défaut. Cochez « Ajouter quand même » si ce sont bien des opérations différentes. Aucune opération existante n’est supprimée.
              </span>
            </div>
          )}
          <div class="stack">
            {reviews.map((r, i) => (
              <div class="card flat" style={{ padding: 12, opacity: r.include ? 1 : 0.65, borderColor: r.dup ? 'var(--warn-light)' : undefined }}>
                <label class="row" style={{ alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={r.include} onChange={(e) => patch(i, { include: (e.target as HTMLInputElement).checked })} style={{ width: 22, height: 22, marginTop: 2, accentColor: 'var(--bordeaux)' }} aria-label={r.dup ? 'Ajouter quand même' : 'Importer cette ligne'} />
                  <span class="grow" style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 650, display: 'block', overflowWrap: 'anywhere' }}>{r.row.label}</span>
                    <span class="small muted num">
                      {fmtDate(r.row.date)} · ligne {r.row.line}
                    </span>
                  </span>
                  <Money cents={r.row.amount} cur={cur} sign={!!r.row.credit} cls={r.row.credit ? 'amount-pos' : ''} />
                </label>
                {r.dup && (
                  <p class="small" style={{ color: 'var(--warn)', margin: '6px 0 0' }}>
                    <AlertTriangle size={14} style={{ verticalAlign: '-2px' }} /> Ressemble à « {r.dup.label} » du {fmtDate(r.dup.date)} ({fmtMoney(r.dup.amount, r.dup.currency)}). {r.include ? 'Sera ajoutée quand même.' : 'Cochez pour ajouter quand même.'}
                  </p>
                )}
                {r.row.credit ? (
                  <div style={{ marginTop: 8 }}>
                    <Seg value={r.kind} onChange={(k) => patch(i, { kind: k, categoryId: k === 'refund' ? r.categoryId ?? suggestCategory(r.row.label, data.value.categories, data.value.settings.labelRules) : null })} options={[{ value: 'refund', label: 'Remboursement' }, { value: 'income', label: 'Autre entrée' }]} />
                  </div>
                ) : null}
                {r.kind !== 'income' && (
                  <select class="input" style={{ minHeight: 42, fontSize: 15, marginTop: 8 }} value={r.categoryId ?? ''} onChange={(e) => patch(i, { categoryId: (e.target as HTMLSelectElement).value || null })} aria-label="Catégorie">
                    <option value="">— Catégorie à choisir —</option>
                    {cats.map((c) => (
                      <option value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
                {r.occ && r.kind === 'expense' && (
                  <label class="check" style={{ paddingBottom: 0 }}>
                    <input type="checkbox" checked={r.linkOcc} onChange={(e) => patch(i, { linkOcc: (e.target as HTMLInputElement).checked })} />
                    <span class="small">
                      <Repeat size={14} style={{ verticalAlign: '-2px' }} /> Correspond à la charge fixe « {r.occ.rec.name} » ({fmtMoney(r.occ.amount, cur)} prévue le {fmtDate(r.occ.dueDate)}) : la marquer comme payée, sans double comptage.
                    </span>
                  </label>
                )}
              </div>
            ))}
          </div>
          {badRows.length > 0 && (
            <div class="section">
              <h2 style={{ fontSize: 17, marginBottom: 6 }}>Lignes non interprétables ({badRows.length})</h2>
              <div class="list">
                {badRows.slice(0, 50).map((b) => (
                  <div class="item" style={{ minHeight: 0 }}>
                    <div class="main">
                      <div class="small" style={{ fontWeight: 650 }}>
                        Ligne {b.line} : {b.error}
                      </div>
                      <div class="meta">{b.label || '—'}</div>
                    </div>
                  </div>
                ))}
              </div>
              <p class="tiny muted">Elles seront ignorées. Si elles sont nombreuses, revenez à l’étape précédente pour corriger les colonnes ou le format des dates.</p>
            </div>
          )}
          <div class="row" style={{ marginTop: 14 }}>
            <button class="btn" onClick={() => setStep('map')}>
              Retour
            </button>
            <button class="btn primary grow" disabled={!toImport.length || toImport.some((r) => r.kind !== 'income' && !r.categoryId)} onClick={() => setStep('confirm')}>
              Continuer ({toImport.length})
            </button>
          </div>
          {toImport.some((r) => r.kind !== 'income' && !r.categoryId) && <p class="error">Choisissez une catégorie pour chaque ligne cochée.</p>}
        </>
      )}

      {step === 'confirm' && (
        <>
          <div class="card">
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>Confirmer l’import</h2>
            <div class="kv">
              <span>Dépenses</span>
              <b>{toImport.filter((r) => r.kind === 'expense').length}</b>
            </div>
            <div class="kv">
              <span>dont charges fixes marquées payées</span>
              <b>{toImport.filter((r) => r.kind === 'expense' && r.linkOcc && r.occ).length}</b>
            </div>
            <div class="kv">
              <span>Remboursements</span>
              <b>{toImport.filter((r) => r.kind === 'refund').length}</b>
            </div>
            <div class="kv">
              <span>Autres entrées</span>
              <b>{toImport.filter((r) => r.kind === 'income').length}</b>
            </div>
            <div class="kv">
              <span>Lignes ignorées</span>
              <b>{reviews.length - toImport.length + badRows.length}</b>
            </div>
            <p class="small muted" style={{ marginBottom: 0 }}>
              Budget concerné : <b>{cur}</b>. Vous pourrez annuler juste après l’import.
            </p>
          </div>
          <div class="row" style={{ marginTop: 14 }}>
            <button class="btn" onClick={() => setStep('review')}>
              Retour
            </button>
            <button class="btn primary grow big" disabled={busy} onClick={doImport}>
              Importer {toImport.length} opération{toImport.length > 1 ? 's' : ''}
            </button>
          </div>
        </>
      )}

      {step === 'done' && summary && (
        <>
          <div class="card">
            <div class="row" style={{ color: 'var(--ok)', fontWeight: 700 }}>
              <Check size={22} /> Import terminé
            </div>
            <h3 style={{ fontSize: 16, margin: '12px 0 4px' }}>Importées</h3>
            <div class="kv"><span>Dépenses</span><b>{summary.expenses}</b></div>
            <div class="kv"><span>dont charges fixes payées</span><b>{summary.paidCharges}</b></div>
            <div class="kv"><span>Remboursements</span><b>{summary.refunds}</b></div>
            <div class="kv"><span>Autres entrées</span><b>{summary.incomes}</b></div>
            {summary.dupAdded > 0 && <div class="kv"><span>Doublons ajoutés quand même</span><b>{summary.dupAdded}</b></div>}
            <h3 style={{ fontSize: 16, margin: '12px 0 4px' }}>Ignorées</h3>
            <div class="kv"><span>Doublons non ajoutés</span><b>{summary.dupSkipped}</b></div>
            <div class="kv"><span>Lignes décochées</span><b>{summary.unchecked}</b></div>
            <div class="kv"><span>Lignes non interprétables</span><b>{summary.unreadable}</b></div>
            {summary.masked > 0 && <p class="small" style={{ marginBottom: 0 }}>{summary.masked} numéro(s) de compte/carte trouvé(s) dans les libellés ont été masqués.</p>}
            <p class="small muted" style={{ marginBottom: 0 }}>Le fichier CSV n’a pas été conservé dans l’application. Vous pouvez le supprimer de votre téléphone.</p>
          </div>
          {(() => {
            const cov = coverage(data.value.txs, cur);
            const n = cov && cov.months >= 2 ? detectRecurring(data.value.txs, data.value.recurring, cur, today()).length : 0;
            return n > 0 ? (
              <button class="banner yellow" style={{ marginTop: 12 }} onClick={() => go(`/budget/detecter?cur=${cur}`)}>
                <ScanSearch size={20} />
                <span class="grow">
                  <b>{n} charge{n > 1 ? 's' : ''} fixe{n > 1 ? 's' : ''} possible{n > 1 ? 's' : ''}</b> repérée{n > 1 ? 's' : ''} dans vos opérations {cur}. Les vérifier et les enregistrer ›
                </span>
              </button>
            ) : cov && cov.months < 2 ? (
              <p class="small muted" style={{ marginTop: 12 }}>Importez au moins 2 mois de relevés pour que Chema détecte vos charges fixes.</p>
            ) : null;
          })()}
          <div class="row" style={{ marginTop: 14 }}>
            <button class="btn" onClick={() => { setSummary(null); setStep('file'); }}>
              Autre relevé
            </button>
            <button class="btn primary grow" onClick={() => go(`/budget/mois?cur=${cur}`)}>
              Voir les opérations
            </button>
          </div>
        </>
      )}
    </>
  );
}

function addDaysSafe(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n, 12);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
