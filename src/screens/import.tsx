// Import de relevés : on choisit le(s) fichier(s), Chema lit tout seul les opérations
// et les affiche prêtes à ajouter. Les réglages de colonnes ne servent qu'en cas de problème.

import { useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { FileUp, ShieldCheck, AlertTriangle, Check, Repeat, ScanSearch, BadgeCheck, Wrench, ChevronDown } from 'lucide-preact';
import { data, commit, put, setSettings, type Change } from '../db/store';
import { categoriesOf, makeTx } from '../db/actions';
import { coverage, detectRecurring } from '../lib/detect';
import { CurrencySeg, Seg, TopBar, Money } from '../ui/kit';
import { analyzeColumns, decodeBytes, detectDelimiter, extractRows, findDuplicate, guessMapping, matchOccurrence, parseCSV, type ColumnInfo, type ColumnMapping, type ExtractOptions, type ParsedRow } from '../lib/csv';
import { autoMap } from '../lib/autoimport';
import { suggestCategory, labelKey } from '../lib/categorize';
import { occurrencesForMonth, paidIndex, type Occurrence } from '../lib/recurring';
import { addDays, fmtDate, monthOf, today } from '../lib/dates';
import { fmtMoney, type Currency } from '../lib/money';
import type { Tx } from '../db/schema';
import { go, goBack } from '../ui/router';
import { choose, promptText, toast } from '../ui/feedback';
import { buildTable, groupLines, yearHint, type LineMeta, type PdfTextItem } from '../lib/pdftable';
import { readPdfText } from '../services/pdf';

type Step = 'file' | 'review' | 'fix' | 'done';

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
  unchecked: number;
}

interface Source {
  rows: string[][];
  pdf: boolean;
  meta?: LineMeta[];
  year?: number;
  delim?: string;
  text?: string;
  name: string;
}

const REFUND_RE = /(rembours|retour|gutschrift|r[üu]ckerstattung|refund|storno|annulation|avoir|cr[ée]dit note|restitution)/i;

/** « Colonne 3 » ou « 3 · Débit » : le numéro aide à retrouver la colonne dans l'aperçu. */
function colTitle(c: ColumnInfo): string {
  return /^Colonne \d+$/.test(c.name) ? c.name : `${c.index + 1} · ${c.name}`;
}

function ColSelect({ cols, label, value, onChange, options }: { cols: ColumnInfo[]; label: string; value: number; onChange: (v: number) => void; options: ComponentChildren }) {
  const c = cols.find((x) => x.index === value);
  return (
    <label class="field">
      <span class="lab">{label}</span>
      <select class="input" value={value} onChange={(e) => onChange(+(e.target as HTMLSelectElement).value)}>
        {options}
      </select>
      {c && (
        <span class="hint">
          Contenu : <b style={{ color: 'var(--ink)' }}>{c.sample || '(vide)'}</b>
        </span>
      )}
    </label>
  );
}

function Steps({ step }: { step: Step }) {
  const i = step === 'file' ? 0 : step === 'done' ? 2 : 1;
  return (
    <div class="steps" aria-label={`Étape ${i + 1} sur 3`}>
      {[0, 1, 2].map((k) => (
        <span class={k <= i ? 'on' : ''} />
      ))}
    </div>
  );
}

function addDaysSafe(iso: string, n: number) {
  return addDays(iso, n);
}

export function ImportScreen() {
  const [step, setStep] = useState<Step>('file');
  const [cur, setCur] = useState<Currency>(data.value.settings.lastCurrency);
  const [src, setSrc] = useState<Source | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState<ColumnMapping | null>(null);
  const [checked, setChecked] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [unread, setUnread] = useState<ParsedRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState('');

  const rows = useMemo(() => (src ? (src.pdf ? src.rows : parseCSV(src.text ?? '', src.delim ?? ';')) : []), [src]);
  const opts: ExtractOptions = src?.pdf ? { pdf: true, yearHint: src.year, lineMeta: src.meta } : {};
  const cols = useMemo(() => analyzeColumns(headerRow >= 0 ? rows[headerRow] ?? null : null, rows.slice(headerRow + 1)), [rows, headerRow]);
  const fixParsed = useMemo(() => (step === 'fix' && map ? extractRows(rows, headerRow, map, opts) : []), [step, rows, headerRow, map]);

  // ---------- Lecture ----------

  function buildReviews(parsed: ParsedRow[]) {
    const d = data.value;
    const paid = paidIndex(d.txs);
    const occCache = new Map<string, Occurrence[]>();
    const occFor = (m: string) => {
      if (!occCache.has(m)) occCache.set(m, occurrencesForMonth(d.recurring.filter((r) => r.currency === cur), paid, m));
      return occCache.get(m)!;
    };
    const used = new Set<string>();
    const list: Review[] = parsed
      .filter((p) => p.ok)
      .map((p) => {
        const row = p as Review['row'];
        const credit = !!p.credit;
        const kind: Review['kind'] = credit ? (REFUND_RE.test(p.label) ? 'refund' : 'income') : 'expense';
        const dup = findDuplicate(row, cur, d.txs);
        let occ: Occurrence | null = null;
        if (!credit) {
          occ = matchOccurrence(row, [...occFor(monthOf(row.date)), ...occFor(monthOf(addDaysSafe(row.date, -10))), ...occFor(monthOf(addDaysSafe(row.date, 10)))].filter((o) => !used.has(o.key)));
          if (occ) used.add(occ.key);
        }
        const categoryId = occ ? occ.rec.categoryId : suggestCategory(p.label, d.categories, d.settings.labelRules) ?? (kind === 'expense' ? 'divers' : null);
        return { row, include: !dup, kind, categoryId: kind === 'income' ? null : categoryId, dup, occ, linkOcc: !!occ && !dup };
      });
    setReviews(list);
    setUnread(parsed.filter((p) => !p.ok && !p.ignored));
  }

  function readSource(s: Source) {
    const r = s.pdf ? s.rows : parseCSV(s.text ?? '', s.delim ?? ';');
    const o: ExtractOptions = s.pdf ? { pdf: true, yearHint: s.year, lineMeta: s.meta } : {};
    const res = autoMap(r, o);
    setSrc(s);
    setHeaderRow(res.headerRow);
    setMap(res.map);
    setChecked(res.checked);
    buildReviews(res.parsed);
    setStep('review');
  }

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (pdfs.length) {
      if (pdfs.length !== files.length) toast('Seuls les PDF ont été lus (un import = un seul type de fichier).', { tone: 'warn' });
      return onPdfs(pdfs);
    }
    return onCsv(files[0]);
  }

  async function onPdfs(files: File[]) {
    if (files.some((f) => f.size > 25 * 1024 * 1024)) return toast('PDF trop volumineux (25 Mo max par fichier).', { tone: 'error' });
    const items: PdfTextItem[] = [];
    let pages = 0;
    try {
      for (const [i, f] of [...files].sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true })).entries()) {
        setReading(files.length > 1 ? `Lecture du relevé ${i + 1} sur ${files.length}…` : 'Lecture du relevé…');
        const res = await readPdfText(f, (retry) => promptText(retry ? 'Mot de passe incorrect' : 'Relevé protégé', `« ${f.name} » est protégé par un mot de passe (souvent fourni par la banque). Il sert uniquement à ouvrir le fichier sur ce téléphone et n’est pas enregistré.`, 'Mot de passe du PDF', 'password'), pages);
        items.push(...res.items);
        pages += res.pages;
      }
      setReading('Recherche des opérations…');
      await new Promise((r) => setTimeout(r, 30));
      const table = buildTable(groupLines(items));
      readSource({ rows: table.rows, meta: table.meta, pdf: true, year: yearHint(items, new Date().getFullYear()), name: files.length > 1 ? `${files.length} relevés PDF` : files[0].name });
    } catch (e) {
      toast((e as Error).message, { tone: 'error', duration: 9000 });
    } finally {
      setReading('');
    }
  }

  async function onCsv(f: File) {
    if (f.size > 15 * 1024 * 1024) return toast('Fichier trop volumineux pour un relevé (15 Mo max).', { tone: 'error' });
    const t = decodeBytes(await f.arrayBuffer());
    const d = detectDelimiter(t);
    if (parseCSV(t, d).length < 2) return toast('Ce fichier ne ressemble pas à un relevé lisible.', { tone: 'error' });
    readSource({ rows: [], text: t, delim: d, pdf: false, name: f.name });
  }

  function restart() {
    setSrc(null);
    setReviews([]);
    setUnread([]);
    setStep('file');
  }

  // ---------- Ajout ----------

  const patch = (i: number, p: Partial<Review>) => setReviews(reviews.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const toImport = reviews.filter((r) => r.include);
  const nExp = toImport.filter((r) => r.kind === 'expense').length;
  const nIn = toImport.length - nExp;

  async function doImport() {
    if (!toImport.length || busy) return;
    if (toImport.some((r) => r.kind !== 'income' && !r.categoryId)) return toast('Choisissez une catégorie pour chaque dépense cochée.', { tone: 'warn' });
    const ok = await choose(`Ajouter au budget ${cur} ?`, undefined, [{ value: 'yes', label: `Ajouter ${toImport.length} opération${toImport.length > 1 ? 's' : ''}`, tone: 'primary' }], {
      details: [`${nExp} dépense${nExp > 1 ? 's' : ''}`, `${nIn} entrée${nIn > 1 ? 's' : ''} d’argent (ne réduisent pas le budget)`, 'Vous pourrez annuler juste après.'],
    });
    if (!ok) return;
    setBusy(true);
    try {
      const changes: Change[] = [];
      const rules = { ...data.value.settings.labelRules };
      const s: Summary = { expenses: 0, refunds: 0, incomes: 0, paidCharges: 0, dupSkipped: 0, unchecked: 0 };
      for (const r of reviews) {
        if (!r.include) {
          if (r.dup) s.dupSkipped++;
          else s.unchecked++;
          continue;
        }
        const link = r.kind === 'expense' && r.linkOcc && r.occ;
        changes.push(
          put(
            'txs',
            makeTx({
              kind: r.kind,
              amount: r.row.amount,
              currency: cur,
              categoryId: r.categoryId,
              label: r.row.label,
              date: r.row.date,
              month: link ? r.occ!.month : undefined,
              occurrence: link ? r.occ!.key : undefined,
              source: 'csv',
            }),
          ),
        );
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
      await commit(changes, { message: `${n} opération${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''} au budget ${cur}`, undo: true });
      setSummary(s);
      // Le contenu du fichier n'est pas conservé.
      setSrc(null);
      setReviews([]);
      setStep('done');
    } finally {
      setBusy(false);
    }
  }

  // ---------- Affichage ----------

  const cats = categoriesOf('expense');
  const dates = reviews.map((r) => r.row.date).sort();
  const expenseIdx = reviews.map((r, i) => [r, i] as const).filter(([r]) => !r.row.credit && !r.dup);
  const incomeIdx = reviews.map((r, i) => [r, i] as const).filter(([r]) => r.row.credit && !r.dup);
  const dupIdx = reviews.map((r, i) => [r, i] as const).filter(([r]) => r.dup);

  const rowCard = (r: Review, i: number) => (
    <div class="item" style={{ alignItems: 'flex-start', opacity: r.include ? 1 : 0.55 }}>
      <input type="checkbox" checked={r.include} onChange={(e) => patch(i, { include: (e.target as HTMLInputElement).checked })} style={{ width: 22, height: 22, marginTop: 3, accentColor: 'var(--bordeaux)', flex: 'none' }} aria-label={`Ajouter « ${r.row.label} »`} />
      <div class="main">
        <div class="title wrap2" style={{ fontWeight: 600 }}>
          {r.row.label}
        </div>
        <div class="meta num">{fmtDate(r.row.date)}</div>
        {r.dup && (
          <div class="tiny" style={{ color: 'var(--warn)', marginTop: 2, whiteSpace: 'normal' }}>
            Déjà enregistrée : « {r.dup.label} » du {fmtDate(r.dup.date)}. Cochez pour l’ajouter quand même.
          </div>
        )}
        {r.row.credit ? (
          <select class="input" style={{ minHeight: 38, fontSize: 14, marginTop: 6, padding: '6px 32px 6px 10px' }} value={r.kind} onChange={(e) => patch(i, { kind: (e.target as HTMLSelectElement).value as Review['kind'], categoryId: (e.target as HTMLSelectElement).value === 'refund' ? r.categoryId ?? suggestCategory(r.row.label, data.value.categories, data.value.settings.labelRules) ?? 'divers' : null })} aria-label="Type d’entrée">
            <option value="income">Entrée d’argent (salaire, virement…)</option>
            <option value="refund">Remboursement d’une dépense</option>
          </select>
        ) : null}
        {r.kind !== 'income' && (
          <select class="input" style={{ minHeight: 38, fontSize: 14, marginTop: 6, padding: '6px 32px 6px 10px' }} value={r.categoryId ?? ''} onChange={(e) => patch(i, { categoryId: (e.target as HTMLSelectElement).value || null })} aria-label="Catégorie">
            <option value="">— Catégorie —</option>
            {cats.map((c) => (
              <option value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        {r.occ && r.kind === 'expense' && (
          <label class="tiny row" style={{ marginTop: 6, gap: 6, whiteSpace: 'normal', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={r.linkOcc} onChange={(e) => patch(i, { linkOcc: (e.target as HTMLInputElement).checked })} style={{ accentColor: 'var(--bordeaux)' }} />
            <span>
              <Repeat size={12} style={{ verticalAlign: '-1px' }} /> Paiement de la charge fixe « {r.occ.rec.name} »
            </span>
          </label>
        )}
      </div>
      <div class="end">
        <Money cents={r.row.amount} cur={cur} sign={!!r.row.credit} cls={r.row.credit ? 'amount-pos' : ''} />
      </div>
    </div>
  );

  const colOptions = (allowNone = false) => (
    <>
      {allowNone && <option value={-1}>Aucune</option>}
      {cols.map((c) => (
        <option value={c.index} disabled={c.sensitive}>
          {colTitle(c)}
          {c.sensitive ? ' (numéros — non importée)' : c.sample ? ` — ex. ${c.sample}` : ' — vide'}
        </option>
      ))}
    </>
  );
  const set = (p: Partial<ColumnMapping>) => setMap({ ...map!, ...p });
  const fixOk = fixParsed.filter((p) => p.ok);

  return (
    <>
      <TopBar title="Importer un relevé" sub={src?.name || 'PDF ou CSV de votre banque'} back={() => goBack('/budget')} />
      <Steps step={step} />

      {step === 'file' && (
        <>
          <p style={{ marginTop: 4 }}>Choisissez vos relevés : Chema trouve vos dépenses et vos entrées tout seul.</p>
          <div class="field">
            <span class="lab">Compte</span>
            <CurrencySeg value={cur} onChange={setCur} />
          </div>
          <label class={`btn primary big block ${reading ? 'disabled' : ''}`} style={{ marginTop: 18 }}>
            <FileUp size={20} /> {reading || 'Choisir mes relevés (PDF)'}
            <input
              type="file"
              multiple
              disabled={!!reading}
              accept=".pdf,.csv,application/pdf,text/csv,text/plain,application/vnd.ms-excel"
              class="sr-only"
              onChange={(e) => {
                const input = e.target as HTMLInputElement;
                onFiles(input.files).finally(() => (input.value = ''));
              }}
            />
          </label>
          <p class="small muted">Vous pouvez sélectionner plusieurs relevés mensuels d’un coup. Les fichiers CSV fonctionnent aussi.</p>
          <div class="callout blue">
            <ShieldCheck size={16} style={{ verticalAlign: '-3px' }} /> Le relevé est lu sur votre téléphone puis oublié. Rien n’est envoyé, aucune connexion à votre banque, et les numéros de compte ou de carte ne sont jamais enregistrés.
          </div>
        </>
      )}

      {step === 'review' && (
        <>
          {reviews.length ? (
            <div class="card" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--bordeaux)' }}>
                {expenseIdx.length} dépense{expenseIdx.length > 1 ? 's' : ''} et {incomeIdx.length} entrée{incomeIdx.length > 1 ? 's' : ''} trouvée{expenseIdx.length + incomeIdx.length > 1 ? 's' : ''}
              </div>
              <div class="small muted">
                {dates.length ? `Du ${fmtDate(dates[0])} au ${fmtDate(dates[dates.length - 1])} · ` : ''}compte {cur}
              </div>
              {checked && (
                <div class="small row" style={{ color: 'var(--ok)', marginTop: 6, fontWeight: 600 }}>
                  <BadgeCheck size={16} /> Montants vérifiés avec le solde du relevé
                </div>
              )}
              {dupIdx.length > 0 && (
                <div class="small" style={{ marginTop: 6 }}>
                  {dupIdx.length} opération{dupIdx.length > 1 ? 's' : ''} déjà enregistrée{dupIdx.length > 1 ? 's' : ''} : non ajoutée{dupIdx.length > 1 ? 's' : ''}.
                </div>
              )}
              <p class="small muted" style={{ margin: '8px 0 0' }}>
                Vérifiez les catégories proposées et décochez ce que vous ne voulez pas ajouter.
              </p>
            </div>
          ) : (
            <div class="card" style={{ marginBottom: 12, borderColor: 'var(--danger-light)' }}>
              <div class="row" style={{ color: 'var(--danger)', fontWeight: 700 }}>
                <AlertTriangle size={20} /> Aucune opération trouvée dans ce relevé
              </div>
              <p class="small" style={{ marginBottom: 0 }}>
                Le format de ce relevé n’a pas été reconnu. Essayez « Corriger la lecture » ci-dessous, ou l’export CSV de votre banque. Si le PDF est une photo/scan, il ne peut pas être lu.
              </p>
            </div>
          )}

          {expenseIdx.length > 0 && (
            <div class="section">
              <h2 style={{ fontSize: 18, marginBottom: 8 }}>Dépenses ({expenseIdx.length})</h2>
              <div class="list">{expenseIdx.map(([r, i]) => rowCard(r, i))}</div>
            </div>
          )}
          {incomeIdx.length > 0 && (
            <div class="section">
              <h2 style={{ fontSize: 18, marginBottom: 8 }}>Entrées d’argent ({incomeIdx.length})</h2>
              <div class="list">{incomeIdx.map(([r, i]) => rowCard(r, i))}</div>
            </div>
          )}
          {dupIdx.length > 0 && (
            <details class="more section">
              <summary>
                <ChevronDown size={18} /> Déjà enregistrées ({dupIdx.length})
              </summary>
              <div class="list" style={{ marginTop: 6 }}>
                {dupIdx.map(([r, i]) => rowCard(r, i))}
              </div>
            </details>
          )}
          {unread.length > 0 && (
            <details class="more section">
              <summary>
                <ChevronDown size={18} /> {unread.length} ligne{unread.length > 1 ? 's' : ''} non lue{unread.length > 1 ? 's' : ''}
              </summary>
              <div class="list" style={{ marginTop: 6 }}>
                {unread.slice(0, 50).map((b) => (
                  <div class="item" style={{ minHeight: 0 }}>
                    <div class="main">
                      <div class="small" style={{ fontWeight: 650, whiteSpace: 'normal' }}>{b.error}</div>
                      <div class="meta">{b.label || '—'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div class="section" style={{ position: 'sticky', bottom: 'calc(var(--tabbar-h) + var(--safe-bottom) + 10px)', zIndex: 5 }}>
            <button class="btn primary big block" style={{ boxShadow: 'var(--shadow)' }} disabled={!toImport.length || busy} onClick={doImport}>
              <Check size={20} /> Ajouter {toImport.length} opération{toImport.length > 1 ? 's' : ''}
            </button>
          </div>
          <div class="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
            <button class="link-btn" onClick={restart}>
              Autre fichier
            </button>
            <button class="link-btn" onClick={() => setStep('fix')}>
              <Wrench size={15} /> Montants ou dates faux ? Corriger la lecture
            </button>
          </div>
        </>
      )}

      {step === 'fix' && map && (
        <>
          <h2 style={{ fontSize: 18, margin: '4px 0 6px' }}>Corriger la lecture</h2>
          <p class="small muted" style={{ marginTop: 0 }}>
            Seulement si les opérations trouvées sont fausses. Indiquez quelle colonne contient quoi : chaque choix montre un exemple de son contenu.
          </p>
          <div class="table-wrap" style={{ maxHeight: 220 }}>
            <table>
              <thead>
                <tr class="hl">
                  {cols.map((c) => (
                    <th>{colTitle(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(headerRow + 1, headerRow + 9).map((r) => (
                  <tr>
                    {cols.map((c) => (
                      <td>{c.sensitive && r[c.index] ? '•••• masqué' : r[c.index] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ColSelect cols={cols} label="Date" value={map.date} onChange={(v) => set({ date: v })} options={colOptions()} />
          <ColSelect cols={cols} label="Libellé (texte de l’opération)" value={map.label} onChange={(v) => set({ label: v })} options={colOptions()} />
          <div class="field">
            <span class="lab">Montants</span>
            <Seg value={map.mode} onChange={(m) => set({ mode: m })} options={[{ value: 'split', label: '2 colonnes (Débit / Crédit)' }, { value: 'single', label: '1 colonne' }]} />
          </div>
          {map.mode === 'single' ? (
            <>
              <ColSelect cols={cols} label="Montant (pas le solde)" value={map.amount} onChange={(v) => set({ amount: v })} options={colOptions()} />
              <div class="field">
                <span class="lab">Les dépenses sont…</span>
                <Seg value={map.sign} onChange={(v) => set({ sign: v })} options={[{ value: 'negative', label: 'avec un − devant' }, { value: 'positive', label: 'sans signe' }]} />
              </div>
            </>
          ) : (
            <>
              <ColSelect cols={cols} label="Débit (argent qui sort)" value={map.debit} onChange={(v) => set({ debit: v })} options={colOptions(true)} />
              <ColSelect cols={cols} label="Crédit (argent qui entre)" value={map.credit} onChange={(v) => set({ credit: v })} options={colOptions(true)} />
            </>
          )}
          <div class="row" style={{ marginTop: 10 }}>
            <span class="grow small">
              Ligne des titres : <b>{headerRow >= 0 ? `ligne ${headerRow + 1}` : 'aucune'}</b>
            </span>
            <button
              class="btn sm"
              aria-label="Ligne des titres plus haut"
              onClick={() => {
                const h = Math.max(-1, headerRow - 1);
                setHeaderRow(h);
                setMap(guessMapping(analyzeColumns(h >= 0 ? rows[h] : null, rows.slice(h + 1)), rows.slice(h + 1)));
              }}
            >
              −
            </button>
            <button
              class="btn sm"
              aria-label="Ligne des titres plus bas"
              onClick={() => {
                const h = Math.min(rows.length - 2, headerRow + 1);
                setHeaderRow(h);
                setMap(guessMapping(analyzeColumns(h >= 0 ? rows[h] : null, rows.slice(h + 1)), rows.slice(h + 1)));
              }}
            >
              +
            </button>
          </div>
          <div class={`callout ${fixOk.length ? 'blue' : 'red'}`}>
            <b>{fixOk.length}</b> opération(s) lue(s) avec ces réglages.
            {fixOk[0] && (
              <>
                <br />
                Exemple : {fmtDate(fixOk[0].date!)} · {fixOk[0].label} · {fixOk[0].credit ? '+' : '−'}
                {fmtMoney(fixOk[0].amount!, cur)}
              </>
            )}
          </div>
          <div class="row" style={{ marginTop: 14 }}>
            <button class="btn" onClick={() => setStep('review')}>
              Annuler
            </button>
            <button
              class="btn primary grow"
              disabled={!fixOk.length}
              onClick={() => {
                setChecked(false);
                buildReviews(fixParsed);
                setStep('review');
              }}
            >
              Appliquer
            </button>
          </div>
        </>
      )}

      {step === 'done' && summary && (
        <>
          <div class="card">
            <div class="row" style={{ color: 'var(--ok)', fontWeight: 700, fontSize: 18 }}>
              <Check size={24} /> C’est ajouté
            </div>
            <div class="kv" style={{ marginTop: 10 }}>
              <span>Dépenses</span>
              <b>{summary.expenses}</b>
            </div>
            {summary.paidCharges > 0 && (
              <div class="kv">
                <span>dont charges fixes payées</span>
                <b>{summary.paidCharges}</b>
              </div>
            )}
            <div class="kv">
              <span>Entrées d’argent</span>
              <b>{summary.incomes}</b>
            </div>
            {summary.refunds > 0 && (
              <div class="kv">
                <span>Remboursements</span>
                <b>{summary.refunds}</b>
              </div>
            )}
            {summary.dupSkipped + summary.unchecked > 0 && (
              <div class="kv">
                <span>Non ajoutées (déjà enregistrées ou décochées)</span>
                <b>{summary.dupSkipped + summary.unchecked}</b>
              </div>
            )}
            <p class="small muted" style={{ marginBottom: 0 }}>
              Le fichier n’a pas été conservé. Le message en bas permet d’annuler l’ajout.
            </p>
          </div>
          {(() => {
            const cov = coverage(data.value.txs, cur);
            const n = cov && cov.months >= 2 ? detectRecurring(data.value.txs, data.value.recurring, cur, today()).length : 0;
            return n > 0 ? (
              <button class="banner yellow" style={{ marginTop: 12 }} onClick={() => go(`/budget/detecter?cur=${cur}`)}>
                <ScanSearch size={20} />
                <span class="grow">
                  <b>
                    {n} charge{n > 1 ? 's' : ''} fixe{n > 1 ? 's' : ''} possible{n > 1 ? 's' : ''}
                  </b>{' '}
                  repérée{n > 1 ? 's' : ''} dans vos opérations {cur}. Les vérifier et les enregistrer ›
                </span>
              </button>
            ) : cov && cov.months < 2 ? (
              <p class="small muted" style={{ marginTop: 12 }}>
                Ajoutez au moins 2 mois de relevés pour que Chema repère vos charges fixes.
              </p>
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
