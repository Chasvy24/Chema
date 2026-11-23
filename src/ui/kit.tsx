import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, X, CalendarDays, ArrowLeft, Search } from 'lucide-preact';
import { fmtDate, today, addDays, type ISODate, monthLabel, addMonthKey, type MonthKey } from '../lib/dates';
import { fmtMoney, fmtNumber, parseAmount, centsToInput, type Currency } from '../lib/money';
import { sheets, closeSheet } from './router';
import { dialog, toasts, dismissToast } from './feedback';
import { detectSensitive, describeHits } from '../lib/sensitive';

// ---------- Montants ----------

export function Money({ cents, cur, sign, cls, decimals }: { cents: number; cur: Currency; sign?: boolean; cls?: string; decimals?: boolean }) {
  return <span class={`num ${cls ?? ''}`}>{fmtMoney(cents, cur, { sign, decimals })}</span>;
}

export function BigMoney({ cents, cur }: { cents: number; cur: Currency }) {
  const neg = cents < 0;
  const s = fmtNumber(cents);
  const [int, dec] = s.split('.');
  return (
    <span class="num">
      {int}
      <small style={{ fontSize: '0.6em' }}>.{dec}</small>
      <small style={{ fontSize: '0.5em', marginLeft: 4, fontFamily: 'var(--font-body)', fontWeight: 700, color: neg ? 'inherit' : 'var(--ink-2)' }}>{cur}</small>
    </span>
  );
}

// ---------- Barre de progression ----------

export function BudgetBar({ confirmed, planned, budget, level, thin }: { confirmed: number; planned: number; budget: number | null; level: string; thin?: boolean }) {
  const total = Math.max(budget ?? 0, confirmed + planned, 1);
  const a = Math.max(0, (confirmed / total) * 100);
  const b = Math.max(0, (planned / total) * 100);
  const pct = budget ? Math.round(((confirmed + planned) / budget) * 100) : null;
  return (
    <div
      class={`bar ${thin ? 'thin' : ''} ${level === 'warn' ? 'warn' : level === 'over' ? 'over' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? 0}
      aria-label={pct !== null ? `${pct} % du budget utilisé ou prévu` : 'Aucun budget défini'}
    >
      <span class="a" style={{ width: `${a}%` }} />
      <span class="b" style={{ width: `${b}%` }} />
    </div>
  );
}

export function SaveBar({ pct }: { pct: number }) {
  return (
    <div class="bar save" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
      <span class="a" style={{ width: `${Math.min(100, pct * 100)}%` }} />
    </div>
  );
}

// ---------- En-tête d'écran ----------

export function TopBar({ title, sub, back, children }: { title: string; sub?: string; back?: () => void; children?: ComponentChildren }) {
  return (
    <header class="topbar">
      {back && (
        <button class="icon-btn" onClick={back} aria-label="Retour">
          <ArrowLeft size={24} />
        </button>
      )}
      <h1>
        {title}
        {sub && <span class="sub">{sub}</span>}
      </h1>
      {children}
    </header>
  );
}

export function SectionHead({ title, action }: { title: string; action?: ComponentChildren }) {
  return (
    <div class="section-head">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export function Empty({ icon, title, text, children }: { icon: ComponentChildren; title: string; text: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <div class="em-ico">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}

// ---------- Navigation par mois ----------

export function MonthNav({ month, onChange, max }: { month: MonthKey; onChange: (m: MonthKey) => void; max?: MonthKey }) {
  const canNext = !max || month < max;
  return (
    <div class="month-nav">
      <button class="icon-btn" onClick={() => onChange(addMonthKey(month, -1))} aria-label="Mois précédent">
        <ChevronLeft size={24} />
      </button>
      <div class="label">{monthLabel(month)}</div>
      <button class="icon-btn" onClick={() => canNext && onChange(addMonthKey(month, 1))} disabled={!canNext} aria-label="Mois suivant" style={{ opacity: canNext ? 1 : 0.3 }}>
        <ChevronRight size={24} />
      </button>
    </div>
  );
}

// ---------- Champs ----------

export function Field({ label, hint, error, children }: { label: string; hint?: ComponentChildren; error?: string | null; children: ComponentChildren }) {
  return (
    <label class="field">
      <span class="lab">{label}</span>
      {children}
      {error && <span class="error">{error}</span>}
      {hint && <span class="hint">{hint}</span>}
    </label>
  );
}

/** Affiche la date en jj.mm.aaaa et ouvre le sélecteur natif du téléphone. */
export function DateInput({ value, onChange, min, max, allowEmpty, label }: { value: ISODate | ''; onChange: (v: ISODate | '') => void; min?: string; max?: string; allowEmpty?: boolean; label?: string }) {
  return (
    <div class="date-field">
      <div class="input shown" aria-hidden="true">
        <span class="num" style={{ color: value ? 'var(--ink)' : 'var(--ink-3)' }}>{value ? fmtDate(value) : 'jj.mm.aaaa'}</span>
        <CalendarDays size={20} color="var(--bordeaux)" />
      </div>
      <input
        type="date"
        aria-label={label ?? 'Date'}
        value={value}
        min={min}
        max={max}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          if (v || allowEmpty) onChange(v);
        }}
        onChange={(e) => {
          const v = (e.target as HTMLInputElement).value;
          if (v || allowEmpty) onChange(v);
        }}
      />
    </div>
  );
}

export function DateQuick({ value, onChange }: { value: ISODate; onChange: (v: ISODate) => void }) {
  const t = today();
  const y = addDays(t, -1);
  return (
    <div class="chips" style={{ marginTop: 8 }}>
      <button type="button" class="chip small" aria-pressed={value === t} onClick={() => onChange(t)}>
        Aujourd’hui
      </button>
      <button type="button" class="chip small" aria-pressed={value === y} onClick={() => onChange(y)}>
        Hier
      </button>
    </div>
  );
}

export function useAmount(initial?: number | null) {
  const [text, setText] = useState(initial !== undefined && initial !== null ? centsToInput(initial) : '');
  const cents = parseAmount(text);
  return { text, setText, cents: cents !== null ? Math.abs(cents) : null, raw: cents };
}

export function AmountInput({ text, setText, big, autoFocus, label, placeholder }: { text: string; setText: (s: string) => void; big?: boolean; autoFocus?: boolean; label?: string; placeholder?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) setTimeout(() => ref.current?.focus(), 250);
  }, []);
  const invalid = text !== '' && parseAmount(text) === null;
  return (
    <input
      ref={ref}
      class={`input ${big ? 'amount' : ''} ${invalid ? 'invalid' : ''} num`}
      inputMode="decimal"
      enterKeyHint="done"
      autoComplete="off"
      aria-label={label ?? 'Montant'}
      placeholder={placeholder ?? '0.00'}
      value={text}
      onInput={(e) => setText((e.target as HTMLInputElement).value.replace(/[^\d.,'’ \-]/g, ''))}
    />
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label?: string }) {
  return (
    <div class="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CurrencySeg({ value, onChange }: { value: Currency; onChange: (c: Currency) => void }) {
  return <Seg label="Monnaie" value={value} onChange={onChange} options={[{ value: 'CHF', label: 'CHF · Suisse' }, { value: 'MAD', label: 'MAD · Maroc' }]} />;
}

export function Chips<T extends string | null>({ value, options, onChange, scroll, small }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; scroll?: boolean; small?: boolean }) {
  return (
    <div class={`chips ${scroll ? 'scroll' : ''}`}>
      {options.map((o) => (
        <button type="button" class={`chip ${small ? 'small' : ''}`} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ComponentChildren; hint?: ComponentChildren }) {
  return (
    <label class="toggle-row">
      <span class="grow">
        <span style={{ fontWeight: 600 }}>{label}</span>
        {hint && <span class="hint small muted" style={{ display: 'block' }}>{hint}</span>}
      </span>
      <span class="switch">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
        <span />
      </span>
    </label>
  );
}

export function TextInput(props: JSX.HTMLAttributes<HTMLInputElement> & { value: string; onValue: (v: string) => void }) {
  const { onValue, ...rest } = props;
  return <input class="input" {...rest} onInput={(e) => onValue((e.target as HTMLInputElement).value)} />;
}

/** Avertit si un texte semble contenir un numéro sensible (compte, carte, AVS, passeport). */
export function SensitiveWarning({ text }: { text: string }) {
  const hits = detectSensitive(text);
  if (!hits.length) return null;
  return (
    <div class="callout red" role="alert">
      Ce texte semble contenir un <b>{describeHits(hits)}</b>. Ces numéros ne doivent pas être enregistrés : il sera remplacé par « [numéro masqué] » à l’enregistrement.
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, []);
  return (
    <div class="searchbox">
      <Search size={20} />
      <input ref={ref} class="input" type="search" enterKeyHint="search" placeholder={placeholder} aria-label={placeholder} value={value} onInput={(e) => onChange((e.target as HTMLInputElement).value)} />
    </div>
  );
}

// ---------- Hôtes globaux : feuilles, dialogues, messages ----------

export function SheetHost() {
  const list = sheets.value;
  useEffect(() => {
    document.body.style.overflow = list.length ? 'hidden' : '';
  }, [list.length]);
  return (
    <>
      {list.map((s, i) => (
        <div key={s.id}>
          {i === list.length - 1 && <div class="overlay" onClick={() => closeSheet(s.id)} />}
          <section class={`sheet ${s.full ? 'full' : ''}`} role="dialog" aria-modal="true" aria-label={s.title} style={{ display: i === list.length - 1 ? undefined : 'none' }}>
            <div class="sheet-head">
              <h2>{s.title}</h2>
              <button class="icon-btn" onClick={() => closeSheet(s.id)} aria-label="Fermer">
                <X size={24} />
              </button>
            </div>
            {s.render(() => closeSheet(s.id))}
          </section>
        </div>
      ))}
    </>
  );
}

/** Corps + pied de feuille (bouton principal en bas, accessible au pouce). */
export function SheetBody({ children, foot }: { children: ComponentChildren; foot?: ComponentChildren }) {
  return (
    <>
      <div class="sheet-body">{children}</div>
      {foot && <div class="sheet-foot">{foot}</div>}
    </>
  );
}

export function DialogHost() {
  const d = dialog.value;
  if (!d) return null;
  // Une clé par dialogue : chaque ouverture repart d'un champ vide, sans effet différé.
  return <DialogBox key={d.id} d={d} />;
}

function DialogBox({ d }: { d: NonNullable<typeof dialog.value> }) {
  const [input, setInput] = useState('');
  const blocked = d.input?.mustEqual ? input.trim().toUpperCase() !== d.input.mustEqual : false;
  return (
    <>
      <div class="overlay top" onClick={() => d.resolve(null)} />
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title">{d.title}</h2>
        {d.message && <p>{d.message}</p>}
        {d.details && d.details.length > 0 && (
          <ul>
            {d.details.map((x) => (
              <li>{x}</li>
            ))}
          </ul>
        )}
        {d.input && (
          <label class="field">
            <span class="lab">{d.input.label}</span>
            <input class="input" type={d.input.type ?? 'text'} placeholder={d.input.placeholder} value={input} autoFocus autoComplete="off" onInput={(e) => setInput((e.target as HTMLInputElement).value)} />
          </label>
        )}
        <div class="btns">
          {d.options.map((o) => (
            <button class={`btn block ${o.tone === 'danger' ? 'danger' : o.tone === 'primary' ? 'primary' : ''}`} disabled={blocked} onClick={() => d.resolve(o.value, input)}>
              {o.label}
            </button>
          ))}
          <button class="btn block ghost" onClick={() => d.resolve(null)}>
            Annuler
          </button>
        </div>
      </div>
    </>
  );
}

export function ToastHost() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((t) => (
        <div class={`toast ${t.tone}`} key={t.id}>
          <span class="msg" onClick={() => dismissToast(t.id)} title="Toucher pour fermer">
            {t.message}
          </span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
