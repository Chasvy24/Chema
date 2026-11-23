import { useEffect, useState } from 'preact/hooks';
import { ArrowDown, ArrowUp, Bell, ChevronRight, CircleHelp, Database, FolderCog, HardDriveDownload, Lock, PiggyBank, Plus, Repeat, Tags, Trash2, Wallet, Pencil, RotateCcw, ShieldCheck, Upload, Fingerprint, CalendarPlus } from 'lucide-preact';
import { data, commit, setSettings, loadAll } from '../db/store';
import { addCategory, alive, categoriesOf, categoryUsage, deleteCategory, moveCategory, purgeTrash, renameCategory, restoreTrash, setBudget, trashItems, type TrashItem } from '../db/actions';
import { budgetEntryFor } from '../lib/budget';
import type { Category } from '../db/schema';
import { AmountInput, Field, Seg, SheetBody, Switch, TopBar, useAmount } from '../ui/kit';
import { currentMonth, fmtDate, monthLabel, today } from '../lib/dates';
import { CURRENCIES, fmtMoney, type Currency, parseAmount, centsToInput } from '../lib/money';
import { choose, confirmAction, confirmTyped, promptText, toast } from '../ui/feedback';
import { go, goBack, openSheet } from '../ui/router';
import { buildBackup, decodeBackup, readBackupFile, rebuildThumbs, restoreBackup, summarize } from '../db/backup';
import { fmtSize, resizeImage, shareOrDownload } from '../db/files';
import { clearAll } from '../db/idb';
import { exportICS, notifSupport, periodicSyncStatus, requestNotifications, testNotification } from '../services/reminders';
import { biometricAvailable, disableBiometric, disableLock, enableBiometric, lockConfig, setPin, updateLockOptions } from '../services/lock';
import { hasWebCrypto } from '../lib/crypto';
import { sortDeadlines } from '../lib/deadlines';
import { isStandalone } from '../services/install';

function MenuItem({ icon, title, sub, onClick }: { icon: any; title: string; sub?: string; onClick: () => void }) {
  return (
    <button class="item" onClick={onClick}>
      <div class="avatar">{icon}</div>
      <div class="main">
        <div class="title">{title}</div>
        {sub && <div class="meta">{sub}</div>}
      </div>
      <ChevronRight size={20} color="var(--ink-3)" />
    </button>
  );
}

export async function wipeEverything() {
  await clearAll();
  try {
    localStorage.clear();
  } catch {
    /* ignoré */
  }
  location.hash = '#/';
  location.reload();
}

export function SettingsScreen() {
  const s = data.value.settings;
  const b = (c: Currency) => budgetEntryFor(s, c, currentMonth());
  const lock = lockConfig();
  return (
    <>
      <TopBar title="Réglages" back={() => goBack('/')} />
      <div class="list">
        <MenuItem icon={<Wallet size={20} />} title="Budgets mensuels et plafonds" sub={CURRENCIES.map((c) => (b(c)?.amount ? fmtMoney(b(c)!.amount, c, { decimals: false }) : `${c} non fixé`)).join(' · ')} onClick={() => go('/reglages/budgets')} />
        <MenuItem icon={<Tags size={20} />} title="Catégories de dépenses" sub={`${categoriesOf('expense').length} catégories`} onClick={() => go('/reglages/categories?kind=expense')} />
        <MenuItem icon={<FolderCog size={20} />} title="Catégories de documents" sub={`${categoriesOf('doc').length} catégories`} onClick={() => go('/reglages/categories?kind=doc')} />
        <MenuItem icon={<Repeat size={20} />} title="Charges fixes" sub={`${alive(data.value.recurring).length} définie(s)`} onClick={() => go('/budget/charges')} />
        <MenuItem icon={<PiggyBank size={20} />} title="Objectifs d’épargne" onClick={() => go('/epargne')} />
      </div>
      <div class="list section">
        <MenuItem icon={<Bell size={20} />} title="Rappels et notifications" sub={`La veille à ${s.reminderTime}`} onClick={() => go('/reglages/rappels')} />
        <MenuItem icon={<Lock size={20} />} title="Verrouillage" sub={lock?.enabled ? `Activé (${lock.scope === 'app' ? 'toute l’app' : 'coffre'})${lock.webauthnId ? ' · biométrie' : ''}` : 'Désactivé'} onClick={() => go('/reglages/securite')} />
        <MenuItem icon={<HardDriveDownload size={20} />} title="Sauvegarde et restauration" sub={s.lastBackupAt ? `Dernière : ${fmtDate(s.lastBackupAt.slice(0, 10))}` : 'Aucune sauvegarde'} onClick={() => go('/reglages/sauvegarde')} />
        <MenuItem icon={<Database size={20} />} title="Stockage et confidentialité" onClick={() => go('/reglages/stockage')} />
        <MenuItem icon={<RotateCcw size={20} />} title="Corbeille" sub={`${trashItems().length} élément(s) restaurable(s)`} onClick={() => go('/reglages/corbeille')} />
        <MenuItem icon={<CircleHelp size={20} />} title="Aide et limites" onClick={() => go('/reglages/aide')} />
      </div>
      <div class="section">
        <button
          class="btn block ghost"
          style={{ color: 'var(--danger)' }}
          onClick={async () => {
            const ok = await confirmTyped('Effacer toutes les données ?', 'Dépenses, échéances, documents, objectifs et réglages seront définitivement supprimés de ce téléphone. Faites d’abord une sauvegarde si vous voulez les retrouver.', 'EFFACER', 'Tout effacer définitivement');
            if (ok) await wipeEverything();
          }}
        >
          <Trash2 size={18} /> Effacer toutes les données
        </button>
      </div>
      <p class="tiny muted" style={{ textAlign: 'center' }}>
        Chema · version 1.0 · données stockées uniquement sur cet appareil
      </p>
    </>
  );
}

// ---------- Budgets ----------

function BudgetBlock({ cur }: { cur: Currency }) {
  const s = data.value.settings;
  const entry = budgetEntryFor(s, cur, currentMonth());
  const amt = useAmount(entry?.amount ?? null);
  const cats = categoriesOf('expense');
  const [caps, setCaps] = useState<Record<string, string>>(() => Object.fromEntries(cats.map((c) => [c.id, entry?.caps[c.id] ? centsToInput(entry.caps[c.id]) : ''])));
  const save = async () => {
    const capCents: Record<string, number> = {};
    for (const [id, v] of Object.entries(caps)) {
      const n = parseAmount(v);
      if (n && n > 0) capCents[id] = Math.abs(n);
    }
    await setBudget(cur, amt.cents ?? 0, capCents);
  };
  return (
    <div class={`card ${cur === 'CHF' ? 'blue' : 'cream'}`} style={{ marginTop: 12 }}>
      <h2 style={{ fontSize: 20 }}>Budget {cur}</h2>
      <Field label={`Montant mensuel global (${cur})`} hint="Laissez vide ou 0 pour ne pas fixer de budget.">
        <AmountInput text={amt.text} setText={amt.setText} big />
      </Field>
      <details class="more">
        <summary>Plafonds par catégorie (facultatifs)</summary>
        {cats.map((c) => (
          <div class="row" style={{ marginTop: 8 }}>
            <span class="grow small" style={{ fontWeight: 600 }}>
              {c.name}
            </span>
            <input class="input num" style={{ width: 130, minHeight: 44, fontSize: 16, textAlign: 'right' }} inputMode="decimal" placeholder="—" value={caps[c.id] ?? ''} onInput={(e) => setCaps({ ...caps, [c.id]: (e.target as HTMLInputElement).value })} aria-label={`Plafond ${c.name}`} />
          </div>
        ))}
      </details>
      <button class="btn primary block" style={{ marginTop: 14 }} onClick={save}>
        Enregistrer le budget {cur}
      </button>
    </div>
  );
}

export function BudgetsSettings() {
  return (
    <>
      <TopBar title="Budgets" back={() => goBack('/reglages')} />
      <p class="small muted" style={{ marginTop: 0 }}>
        Les budgets CHF et MAD sont indépendants : jamais additionnés ni convertis. Un changement s’applique à partir de {monthLabel(currentMonth(), false)} ; les mois précédents gardent leur budget.
      </p>
      <BudgetBlock cur="CHF" />
      <BudgetBlock cur="MAD" />
      <div class="callout blue" style={{ marginTop: 14 }}>
        La barre devient <b style={{ color: 'var(--warn)' }}>orange à 80 %</b> du budget (dépenses + charges prévues) et <b style={{ color: 'var(--danger)' }}>rouge en cas de dépassement</b>.
      </div>
    </>
  );
}

// ---------- Catégories ----------

export function CategoriesSettings({ kind }: { kind: Category['kind'] }) {
  const cats = categoriesOf(kind);
  const label = kind === 'expense' ? 'dépenses' : 'documents';
  const del = async (c: Category) => {
    if (c.system) return toast('Cette catégorie est nécessaire au fonctionnement de l’application (vous pouvez la renommer).', { tone: 'warn' });
    const u = categoryUsage(c);
    const total = u.txs + u.recurring + u.deadlines + u.docs;
    if (!total) {
      if (await confirmAction(`Supprimer « ${c.name} » ?`, 'Elle n’est utilisée nulle part.', 'Supprimer', true)) await deleteCategory(c, null);
      return;
    }
    const others = cats.filter((x) => x.id !== c.id);
    const v = await choose(
      `« ${c.name} » est utilisée`,
      `${[u.txs && `${u.txs} opération(s)`, u.recurring && `${u.recurring} charge(s) fixe(s)`, u.deadlines && `${u.deadlines} échéance(s)`, u.docs && `${u.docs} document(s)`].filter(Boolean).join(', ')}. Dans quelle catégorie les reclasser avant la suppression ?`,
      others.map((o) => ({ value: o.id, label: `Reclasser dans « ${o.name} »`, tone: 'plain' as const })),
    );
    if (v) await deleteCategory(c, v);
  };
  return (
    <>
      <TopBar title={`Catégories de ${label}`} back={() => goBack('/reglages')}>
        <button
          class="icon-btn soft"
          aria-label="Ajouter une catégorie"
          onClick={async () => {
            const n = await promptText('Nouvelle catégorie', '', 'Nom de la catégorie');
            if (n && n.trim()) await addCategory(kind, n);
          }}
        >
          <Plus size={24} />
        </button>
      </TopBar>
      <div class="list">
        {cats.map((c, i) => (
          <div class="item">
            <div class="main">
              <div class="title">{c.name}</div>
              {c.system && <div class="meta">Catégorie système</div>}
            </div>
            <button class="icon-btn" aria-label={`Monter ${c.name}`} disabled={i === 0} style={{ opacity: i === 0 ? 0.3 : 1 }} onClick={() => moveCategory(c, -1)}>
              <ArrowUp size={20} />
            </button>
            <button class="icon-btn" aria-label={`Descendre ${c.name}`} disabled={i === cats.length - 1} style={{ opacity: i === cats.length - 1 ? 0.3 : 1 }} onClick={() => moveCategory(c, 1)}>
              <ArrowDown size={20} />
            </button>
            <button
              class="icon-btn"
              aria-label={`Renommer ${c.name}`}
              onClick={async () => {
                const n = await promptText('Renommer', `Nom actuel : ${c.name}`, 'Nouveau nom');
                if (n && n.trim()) await renameCategory(c, n);
              }}
            >
              <Pencil size={19} />
            </button>
            <button class="icon-btn" aria-label={`Supprimer ${c.name}`} onClick={() => del(c)} style={{ color: c.system ? 'var(--ink-3)' : 'var(--danger)' }}>
              <Trash2 size={19} />
            </button>
          </div>
        ))}
      </div>
      <p class="small muted">L’ordre choisi ici est celui des boutons de catégorie dans les formulaires.</p>
    </>
  );
}

// ---------- Rappels ----------

export function RemindersSettings() {
  const s = data.value.settings;
  const ns = notifSupport();
  const ps = periodicSyncStatus.value;
  const open = sortDeadlines(alive(data.value.deadlines).filter((d) => d.status !== 'done' && d.date >= today()));
  return (
    <>
      <TopBar title="Rappels" back={() => goBack('/reglages')} />
      <Field label="Heure du rappel (la veille de chaque échéance)">
        <input class="input num" type="time" value={s.reminderTime} onChange={(e) => commit([setSettings({ reminderTime: (e.target as HTMLInputElement).value || '18:00' })], { message: 'Heure des rappels enregistrée' })} />
      </Field>

      <h2 style={{ fontSize: 18, margin: '20px 0 8px' }}>Ce qui fonctionne sur ce téléphone</h2>
      <div class="list">
        <div class="item">
          <div class="avatar" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}>
            <ShieldCheck size={20} />
          </div>
          <div class="main" style={{ whiteSpace: 'normal' }}>
            <div class="title">Dans l’application : toujours</div>
            <div class="small muted">Échéances de demain surlignées, retards en rouge en haut de liste, « rappels manqués » affichés à l’ouverture.</div>
          </div>
        </div>
        <div class="item">
          <div class="avatar">
            <Bell size={20} />
          </div>
          <div class="main" style={{ whiteSpace: 'normal' }}>
            <div class="title">Notifications : seulement app ouverte</div>
            <div class="small muted">
              État : {ns.permission === 'granted' ? 'autorisées' : ns.permission === 'denied' ? 'refusées (à changer dans les réglages du téléphone)' : ns.permission === 'unsupported' ? (ns.ios && !ns.standalone ? 'indisponibles : installez d’abord l’app sur l’écran d’accueil' : 'indisponibles dans ce navigateur') : 'non demandées'}.
              {ps === 'registered' && ' Vérification périodique en arrière-plan demandée au navigateur (Android, non garantie).'}
            </div>
            <div class="row" style={{ marginTop: 8 }}>
              {ns.permission !== 'granted' && ns.permission !== 'denied' && (
                <button class="btn sm primary" onClick={requestNotifications}>
                  Autoriser
                </button>
              )}
              {ns.permission === 'granted' && (
                <button class="btn sm" onClick={testNotification}>
                  Tester
                </button>
              )}
            </div>
          </div>
        </div>
        <div class="item">
          <div class="avatar yellow">
            <CalendarPlus size={20} />
          </div>
          <div class="main" style={{ whiteSpace: 'normal' }}>
            <div class="title">Calendrier du téléphone : fiable</div>
            <div class="small muted">Exportez vos échéances (.ics) avec une alerte la veille à {s.reminderTime}. Le calendrier vous prévient même app fermée et hors ligne. À refaire si une date change (sinon doublons).</div>
            <button class="btn sm" style={{ marginTop: 8 }} onClick={() => exportICS(open)}>
              Exporter {open.length} échéance(s) à venir
            </button>
          </div>
        </div>
      </div>
      <div class="callout" style={{ marginTop: 14 }}>
        <b>Limite importante :</b> une application web installée ne peut pas programmer elle-même une notification à 18 h lorsque le téléphone l’a fermée. Sur iPhone, c’est impossible sans un serveur d’envoi (« Web Push ») ; sur Android, le navigateur décide seul de la fréquence des vérifications. Pour des notifications fiables sans calendrier, il faudrait soit une application native (iOS/Android), soit un petit serveur qui connaîtrait vos dates d’échéance (moins confidentiel). Rien de tout cela n’est activé.
      </div>
    </>
  );
}

// ---------- Sécurité ----------

function PinSetup({ close }: { close: () => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [scope, setScope] = useState<'app' | 'docs'>(lockConfig()?.scope ?? 'app');
  const [delay, setDelay] = useState(String(lockConfig()?.delayMin ?? 1));
  const valid = /^\d{4,6}$/.test(a) && a === b;
  return (
    <SheetBody
      foot={
        <button
          class="btn primary big"
          disabled={!valid}
          onClick={async () => {
            await setPin(a, scope, Number(delay));
            close();
          }}
        >
          Activer le code
        </button>
      }
    >
      <Field label="Nouveau code (4 à 6 chiffres)">
        <input class="input num" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={a} onInput={(e) => setA((e.target as HTMLInputElement).value.replace(/\D/g, ''))} />
      </Field>
      <Field label="Confirmez le code" error={b && a !== b ? 'Les deux codes sont différents.' : null}>
        <input class="input num" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={b} onInput={(e) => setB((e.target as HTMLInputElement).value.replace(/\D/g, ''))} />
      </Field>
      <div class="field">
        <span class="lab">Protéger</span>
        <Seg value={scope} onChange={setScope} options={[{ value: 'app', label: 'Toute l’application' }, { value: 'docs', label: 'Le coffre seulement' }]} />
      </div>
      <Field label="Verrouiller après">
        <select class="input" value={delay} onChange={(e) => setDelay((e.target as HTMLSelectElement).value)}>
          <option value="0">Immédiatement en quittant l’app</option>
          <option value="1">1 minute</option>
          <option value="5">5 minutes</option>
          <option value="15">15 minutes</option>
        </select>
      </Field>
      <div class="callout red">Il n’existe aucun moyen de récupérer un code oublié : il faudrait effacer les données et restaurer une sauvegarde.</div>
    </SheetBody>
  );
}

export function SecuritySettings() {
  const l = lockConfig();
  const [bio, setBio] = useState<boolean | null>(null);
  useEffect(() => {
    biometricAvailable().then(setBio);
  }, []);
  return (
    <>
      <TopBar title="Verrouillage" back={() => goBack('/reglages')} />
      <div class="callout blue" style={{ marginTop: 0 }}>
        Vos documents bénéficient d’abord de la protection du téléphone (code, Face ID, empreinte, chiffrement de l’appareil). Le code ci-dessous ajoute un verrou à l’ouverture de l’application.
      </div>
      {!l?.enabled ? (
        <button class="btn primary block big" style={{ marginTop: 14 }} disabled={!hasWebCrypto()} onClick={() => openSheet('Code de verrouillage', (c) => <PinSetup close={c} />)}>
          <Lock size={20} /> Activer un code
        </button>
      ) : (
        <>
          <div class="card flat" style={{ marginTop: 14 }}>
            <div class="kv">
              <span>Code</span>
              <b>Activé ({l.length} chiffres)</b>
            </div>
            <div class="field">
              <span class="lab">Protéger</span>
              <Seg value={l.scope} onChange={(v) => updateLockOptions({ scope: v })} options={[{ value: 'app', label: 'Toute l’application' }, { value: 'docs', label: 'Le coffre seulement' }]} />
            </div>
            <Field label="Verrouiller après">
              <select class="input" value={String(l.delayMin)} onChange={(e) => updateLockOptions({ delayMin: Number((e.target as HTMLSelectElement).value) })}>
                <option value="0">Immédiatement en quittant l’app</option>
                <option value="1">1 minute</option>
                <option value="5">5 minutes</option>
                <option value="15">15 minutes</option>
              </select>
            </Field>
            {bio ? (
              <Switch
                checked={!!l.webauthnId}
                onChange={async (v) => {
                  if (v) {
                    try {
                      await enableBiometric();
                    } catch (e) {
                      toast(`Biométrie non activée : ${(e as Error).message || 'refusée'}`, { tone: 'warn' });
                    }
                  } else await disableBiometric();
                }}
                label={
                  <>
                    <Fingerprint size={18} style={{ verticalAlign: '-3px' }} /> Déverrouiller avec Face ID / empreinte
                  </>
                }
                hint="Utilise une « clé d’accès » enregistrée par votre téléphone pour ce site. Le code reste nécessaire en secours."
              />
            ) : (
              <p class="small muted">
                {bio === false ? 'La biométrie n’est pas disponible pour cette application sur cet appareil (ou la page n’est pas en HTTPS). Le code fonctionne normalement.' : 'Vérification de la biométrie…'}
              </p>
            )}
          </div>
          <div class="grid2" style={{ marginTop: 10 }}>
            <button class="btn" onClick={() => openSheet('Changer le code', (c) => <PinSetup close={c} />)}>
              Changer le code
            </button>
            <button
              class="btn"
              style={{ color: 'var(--danger)' }}
              onClick={async () => {
                if (await confirmAction('Désactiver le verrouillage ?', 'L’application s’ouvrira sans code.', 'Désactiver', true)) await disableLock();
              }}
            >
              Désactiver
            </button>
          </div>
        </>
      )}
      <div class="callout" style={{ marginTop: 14 }}>
        <b>À savoir :</b> ce verrou empêche d’ouvrir l’interface (par exemple si quelqu’un utilise votre téléphone déverrouillé). Il ne chiffre pas les données enregistrées dans le navigateur : leur protection repose sur le verrouillage et le chiffrement du téléphone. La biométrie n’est proposée que si le téléphone la fournit réellement à l’application.
      </div>
    </>
  );
}

// ---------- Sauvegarde / restauration ----------

function ExportSheet({ close }: { close: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [files, setFiles] = useState(true);
  const [busy, setBusy] = useState(false);
  const encrypt = pw.length > 0;
  const crypto = hasWebCrypto();
  const ok = !encrypt || (pw.length >= 8 && pw === pw2);
  return (
    <SheetBody
      foot={
        <button
          class="btn primary big"
          disabled={!ok || busy}
          onClick={async () => {
            if (!encrypt) {
              const go2 = await confirmAction('Sauvegarde NON chiffrée', 'Ce fichier sera lisible par toute personne qui y a accès (montants, échéances, documents). Préférez un mot de passe, surtout si vous le stockez dans un cloud ou l’envoyez par e-mail.', 'Continuer sans chiffrement', true);
              if (!go2) return;
            }
            setBusy(true);
            try {
              const { blob, filename } = await buildBackup({ password: encrypt ? pw : undefined, includeFiles: files });
              const r = await shareOrDownload(blob, filename);
              if (r !== 'cancelled') {
                await commit([setSettings({ lastBackupAt: new Date().toISOString() })]);
                toast(`Sauvegarde créée (${fmtSize(blob.size)}). Rangez le fichier hors du téléphone.`, { duration: 6000 });
                close();
              }
            } catch (e) {
              toast(`Échec de la sauvegarde : ${(e as Error).message}`, { tone: 'error' });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Préparation…' : encrypt ? 'Créer la sauvegarde chiffrée' : 'Créer la sauvegarde'}
        </button>
      }
    >
      {crypto ? (
        <>
          <Field label="Mot de passe de la sauvegarde (recommandé)" hint="8 caractères minimum. Sans ce mot de passe, la sauvegarde ne pourra pas être restaurée : notez-le en lieu sûr.">
            <input class="input" type="password" autoComplete="new-password" value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
          </Field>
          {encrypt && (
            <Field label="Confirmez le mot de passe" error={pw2 && pw !== pw2 ? 'Les mots de passe diffèrent.' : pw.length > 0 && pw.length < 8 ? 'Au moins 8 caractères.' : null}>
              <input class="input" type="password" autoComplete="new-password" value={pw2} onInput={(e) => setPw2((e.target as HTMLInputElement).value)} />
            </Field>
          )}
          {encrypt ? (
            <div class="callout blue">Chiffrement AES-256 (clé dérivée du mot de passe). Le fichier est illisible sans le mot de passe.</div>
          ) : (
            <div class="callout red">Sans mot de passe, la sauvegarde n’est <b>pas chiffrée</b>.</div>
          )}
        </>
      ) : (
        <div class="callout red">Le chiffrement n’est pas disponible ici (la page doit être ouverte en HTTPS). Seule une sauvegarde non chiffrée est possible.</div>
      )}
      <Switch checked={files} onChange={setFiles} label="Inclure les photos et PDF du coffre" hint="Décochez pour une petite sauvegarde (données seulement)." />
      <p class="small muted">Le fichier est proposé au partage ou au téléchargement : choisissez « Enregistrer dans Fichiers », une clé USB ou votre ordinateur. Rien n’est envoyé automatiquement.</p>
    </SheetBody>
  );
}

export function BackupSettings() {
  const s = data.value.settings;
  const [busy, setBusy] = useState(false);
  async function restore(file: File) {
    try {
      setBusy(true);
      const { encrypted, raw } = await readBackupFile(file);
      let pw: string | undefined;
      if (encrypted) {
        pw = (await promptText('Sauvegarde chiffrée', 'Saisissez le mot de passe choisi lors de la sauvegarde.', 'Mot de passe', 'password')) ?? undefined;
        if (!pw) return;
      }
      const plain = await decodeBackup(raw, pw);
      const sum = summarize(plain);
      const ok = await choose(
        'Remplacer les données actuelles ?',
        `Sauvegarde du ${fmtDate(sum.createdAt.slice(0, 10))}. Toutes les données actuelles de cette application seront remplacées.`,
        [{ value: 'yes', label: 'Restaurer cette sauvegarde', tone: 'danger' }],
        { details: [`${sum.counts.txs} opérations`, `${sum.counts.deadlines} échéances`, `${sum.counts.docs} documents (${sum.counts.files} fichiers)`, `${sum.counts.goals} objectifs`, `${sum.counts.recurring} charges fixes`] },
      );
      if (!ok) return;
      await restoreBackup(plain);
      await loadAll();
      rebuildThumbs(resizeImage);
      toast('Sauvegarde restaurée.', { duration: 5000 });
      go('/');
    } catch (e) {
      toast((e as Error).message || 'Restauration impossible.', { tone: 'error', duration: 7000 });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <TopBar title="Sauvegarde" back={() => goBack('/reglages')} />
      <div class="card yellow">
        <div class="small" style={{ fontWeight: 700, color: 'var(--honey-ink)' }}>
          Dernière sauvegarde
        </div>
        <div class="hero" style={{ fontSize: 22 }}>{s.lastBackupAt ? fmtDate(s.lastBackupAt.slice(0, 10)) : 'Jamais'}</div>
        <p class="small" style={{ margin: '6px 0 0' }}>
          Vos données n’existent que sur ce téléphone. Une sauvegarde régulière (par exemple chaque mois) est le seul moyen de les retrouver en cas de perte, de vol ou de changement de téléphone.
        </p>
      </div>
      <button class="btn primary block big" style={{ marginTop: 14 }} onClick={() => openSheet('Nouvelle sauvegarde', (c) => <ExportSheet close={c} />)}>
        <HardDriveDownload size={20} /> Exporter une sauvegarde
      </button>
      <label class={`btn block big ${busy ? 'disabled' : ''}`} style={{ marginTop: 10 }}>
        <Upload size={20} /> {busy ? 'Restauration…' : 'Restaurer depuis un fichier'}
        <input type="file" accept=".json,application/json" class="sr-only" disabled={busy} onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (f) restore(f); }} />
      </label>
      <div class="prose section small">
        <h3>Changer de téléphone</h3>
        <p>1. Sur l’ancien téléphone : exportez une sauvegarde (avec mot de passe) et enregistrez-la (Fichiers/iCloud Drive, Google Drive, ordinateur…). 2. Sur le nouveau : ouvrez l’adresse de l’application, installez-la sur l’écran d’accueil, puis « Restaurer depuis un fichier ».</p>
        <h3>Perte ou vol du téléphone</h3>
        <p>Sans sauvegarde, les données sont perdues : il n’y a ni compte ni copie sur un serveur. Les personnes qui trouveraient le téléphone devraient d’abord le déverrouiller.</p>
        <h3>Le verrouillage n’est pas sauvegardé</h3>
        <p>Le code et la biométrie sont propres à chaque téléphone : à réactiver après une restauration.</p>
      </div>
    </>
  );
}

// ---------- Stockage ----------

export function StorageSettings() {
  const [est, setEst] = useState<{ usage?: number; quota?: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    navigator.storage?.estimate?.().then(setEst).catch(() => null);
    navigator.storage?.persisted?.().then(setPersisted).catch(() => null);
  }, []);
  return (
    <>
      <TopBar title="Stockage" back={() => goBack('/reglages')} />
      <div class="card flat">
        <div class="kv">
          <span>Espace utilisé</span>
          <b>{est?.usage !== undefined ? fmtSize(est.usage) : '—'}</b>
        </div>
        <div class="kv">
          <span>Espace autorisé (estimation)</span>
          <b>{est?.quota ? fmtSize(est.quota) : '—'}</b>
        </div>
        <div class="kv">
          <span>Protection contre l’effacement automatique</span>
          <b>{persisted === null ? 'Inconnue' : persisted ? 'Activée' : 'Non accordée'}</b>
        </div>
        <div class="kv">
          <span>Mode</span>
          <b>{isStandalone() ? 'App installée' : 'Navigateur'}</b>
        </div>
        {persisted === false && (
          <button
            class="btn sm"
            style={{ marginTop: 10 }}
            onClick={async () => {
              const ok = await navigator.storage?.persist?.();
              setPersisted(!!ok);
              toast(ok ? 'Le navigateur protège désormais ces données.' : 'Le navigateur a refusé (souvent accordé après installation et usage régulier).', { tone: ok ? 'ok' : 'warn', duration: 6000 });
            }}
          >
            Demander la protection
          </button>
        )}
      </div>
      <div class="prose section small">
        <h3>Où sont mes données ?</h3>
        <p>Toutes les informations (dépenses, échéances, objectifs, réglages) et les fichiers du coffre sont enregistrés dans la base de données locale du navigateur (IndexedDB), sur ce téléphone uniquement. Aucun compte, aucun serveur, aucune synchronisation. L’hébergeur de la page ne fournit que le code de l’application : il ne voit pas vos données.</p>
        <h3>Ce qui efface les données</h3>
        <ul>
          <li>Supprimer l’icône de l’app de l’écran d’accueil (sur iPhone, cela efface aussi ses données).</li>
          <li>Effacer les données de navigation / du site dans les réglages du navigateur.</li>
          <li>Réinitialiser ou perdre le téléphone.</li>
          <li>Sur iPhone, Safari peut effacer les données d’un site non installé inutilisé pendant 7 jours : installez l’app sur l’écran d’accueil.</li>
        </ul>
        <h3>Navigateur et app installée</h3>
        <p>Sur iPhone, l’app installée et Safari ont des espaces séparés : saisissez vos données dans l’app installée. Changer d’adresse (URL) d’hébergement repart aussi d’un espace vide : utilisez une sauvegarde pour transférer.</p>
        <h3>Données interdites</h3>
        <p>Aucun numéro de compte, de carte bancaire, de passeport ou d’AVS ne doit être enregistré. L’application masque les numéros qu’elle reconnaît dans les textes et les imports CSV, et propose de masquer les images, mais elle ne peut pas tout détecter : restez vigilante.</p>
      </div>
    </>
  );
}

// ---------- Corbeille ----------

export function TrashSettings() {
  const items = trashItems();
  return (
    <>
      <TopBar title="Corbeille" back={() => goBack('/reglages')}>
        {items.length > 0 && (
          <button
            class="icon-btn soft"
            aria-label="Vider la corbeille"
            onClick={async () => {
              if (await confirmAction('Vider la corbeille ?', `${items.length} élément(s) et leurs fichiers seront supprimés définitivement.`, 'Vider', true)) {
                const n = await purgeTrash(null);
                toast(`${n} élément(s) supprimé(s) définitivement.`);
              }
            }}
          >
            <Trash2 size={22} />
          </button>
        )}
      </TopBar>
      <p class="small muted" style={{ marginTop: 0 }}>
        Les éléments supprimés restent restaurables 30 jours, puis sont effacés définitivement.
      </p>
      {items.length ? (
        <div class="list">
          {items.map((it: TrashItem) => (
            <div class="item">
              <div class="main">
                <div class="title">{it.label}</div>
                <div class="meta">
                  {it.detail} · supprimé le {fmtDate(it.deletedAt.slice(0, 10))}
                </div>
              </div>
              <button class="btn sm" onClick={() => restoreTrash(it)}>
                Restaurer
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p class="small">La corbeille est vide.</p>
      )}
    </>
  );
}

// ---------- Aide ----------

export function HelpScreen() {
  return (
    <>
      <TopBar title="Aide et limites" back={() => goBack('/reglages')} />
      <div class="prose">
        <div class="callout blue" style={{ marginTop: 0 }}>
          <b>« Restant » n’est pas le solde de votre compte bancaire.</b> C’est votre budget mensuel fixé, moins les dépenses enregistrées, moins les charges fixes prévues et pas encore payées. Une charge marquée « payée » devient une dépense confirmée et n’est comptée qu’une fois.
        </div>
        <h3>Ajouter rapidement</h3>
        <p>Bouton + : dépense (montant, monnaie, catégorie — date du jour par défaut), ticket photo, échéance ou document.</p>
        <h3>CHF et MAD</h3>
        <p>Deux budgets indépendants, jamais additionnés ni convertis. Chaque dépense appartient au budget de sa monnaie de paiement. Les objectifs d’épargne restent aussi dans leur monnaie.</p>
        <h3>Charges fixes</h3>
        <p>Définies une fois, elles apparaissent chaque mois comme « prévues ». Touchez-en une pour la marquer payée (en ajustant le montant réel si la facture varie), l’ignorer ce mois-ci, ou modifier ses paramètres.</p>
        <p>
          <b>Détection automatique :</b> importez 2 à 6 mois de relevés (PDF ou CSV — plusieurs PDF mensuels peuvent être choisis d’un coup), puis Budget › Charges fixes › icône loupe. Chema repère sur le téléphone les paiements qui reviennent (même bénéficiaire, même période du mois, montant stable ou proche) et vous les propose ; vous validez ou corrigez chacun. Les paiements déjà importés sont rattachés, sans double comptage.
        </p>
        <h3>Échéances</h3>
        <p>Retards en rouge en haut de liste, échéances de demain surlignées en jaune. Terminer une échéance récurrente crée automatiquement la suivante. Pour un contrat, la date rappelée est la date limite de résiliation (fin − préavis).</p>
        <h3>Annuler une erreur</h3>
        <p>Après chaque action, le message en bas propose « Annuler ». Les éléments supprimés restent 30 jours dans Réglages › Corbeille.</p>
        <h3>Limites connues</h3>
        <ul>
          <li>Notifications : pas de rappel garanti quand l’app est fermée (voir Réglages › Rappels) ; l’export calendrier est la solution fiable.</li>
          <li>Pas de lecture automatique des tickets sur la plupart des téléphones (aucune photo n’est envoyée à un service externe).</li>
          <li>Le verrou de l’app ne chiffre pas les données ; la sauvegarde avec mot de passe, elle, est chiffrée.</li>
          <li>Pas de synchronisation entre appareils : utilisez sauvegarde et restauration.</li>
        </ul>
      </div>
    </>
  );
}
