import { useEffect } from 'preact/hooks';
import { Home, Wallet, CalendarClock, FolderLock, Plus, Camera, FilePlus2, ShieldCheck } from 'lucide-preact';
import { data, commit, setSettings } from './db/store';
import { alive } from './db/actions';
import { isOverdue } from './lib/deadlines';
import { route, go, openSheet } from './ui/router';
import { DialogHost, SheetBody, SheetHost, ToastHost } from './ui/kit';
import { HomeScreen } from './screens/home';
import { BudgetScreen, MonthScreen, RecurringScreen } from './screens/budget';
import { ImportScreen } from './screens/import';
import { DeadlineDetail, DeadlinesScreen, openDeadlineForm } from './screens/deadlines';
import { DocDetail, DocumentsScreen, openDocForm } from './screens/docs';
import { GoalDetail, SavingsScreen } from './screens/savings';
import { BackupSettings, BudgetsSettings, CategoriesSettings, HelpScreen, RemindersSettings, SecuritySettings, SettingsScreen, StorageSettings, TrashSettings } from './screens/settings';
import { SearchScreen } from './screens/search';
import { LockScreen } from './screens/lock';
import { openExpense, openReceipt } from './screens/tx';
import { installState } from './services/install';

function Screen() {
  const r = route.value;
  const [a, b] = r.parts;
  switch (a) {
    case undefined:
      return <HomeScreen />;
    case 'budget':
      if (b === 'mois') return <MonthScreen />;
      if (b === 'charges') return <RecurringScreen />;
      if (b === 'import') return <ImportScreen />;
      return <BudgetScreen />;
    case 'echeances':
      return b ? <DeadlineDetail id={b} /> : <DeadlinesScreen />;
    case 'documents':
      return b ? <DocDetail id={b} /> : <DocumentsScreen />;
    case 'epargne':
      return b ? <GoalDetail id={b} /> : <SavingsScreen />;
    case 'recherche':
      return <SearchScreen />;
    case 'reglages':
      switch (b) {
        case 'budgets':
          return <BudgetsSettings />;
        case 'categories':
          return <CategoriesSettings kind={r.query.get('kind') === 'doc' ? 'doc' : 'expense'} />;
        case 'rappels':
          return <RemindersSettings />;
        case 'securite':
          return <SecuritySettings />;
        case 'sauvegarde':
          return <BackupSettings />;
        case 'stockage':
          return <StorageSettings />;
        case 'corbeille':
          return <TrashSettings />;
        case 'aide':
          return <HelpScreen />;
        default:
          return <SettingsScreen />;
      }
    default:
      return <HomeScreen />;
  }
}

function AddMenu({ close }: { close: () => void }) {
  const big = { minHeight: 64, justifyContent: 'flex-start', fontSize: 17 } as const;
  return (
    <SheetBody>
      <div class="stack" style={{ paddingBottom: 8 }}>
        <button
          class="btn primary block"
          style={big}
          onClick={() => {
            close();
            setTimeout(() => openExpense(), 60);
          }}
        >
          <Wallet size={24} /> Dépense
          <span class="small" style={{ marginLeft: 'auto', opacity: 0.8, fontWeight: 500 }}>
            montant · monnaie · catégorie
          </span>
        </button>
        <label class="btn block" style={big}>
          <Camera size={24} /> Ticket (photo)
          <span class="small muted" style={{ marginLeft: 'auto', fontWeight: 500 }}>
            reste dans « Reçus »
          </span>
          <input
            type="file"
            accept="image/*"
            class="sr-only"
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (!f) return;
              close();
              setTimeout(() => openReceipt(f), 60);
            }}
          />
        </label>
        <button
          class="btn blue block"
          style={big}
          onClick={() => {
            close();
            setTimeout(() => openDeadlineForm(), 60);
          }}
        >
          <CalendarClock size={24} /> Échéance
          <span class="small" style={{ marginLeft: 'auto', fontWeight: 500 }}>
            facture, contrat, démarche…
          </span>
        </button>
        <button
          class="btn yellow block"
          style={big}
          onClick={() => {
            close();
            setTimeout(() => openDocForm(), 60);
          }}
        >
          <FilePlus2 size={24} /> Document
          <span class="small" style={{ marginLeft: 'auto', fontWeight: 500 }}>
            photo, PDF, capture
          </span>
        </button>
      </div>
    </SheetBody>
  );
}

function TabBar() {
  const a = route.value.parts[0];
  const late = alive(data.value.deadlines).filter((d) => isOverdue(d)).length;
  const tab = (path: string, key: string | undefined, label: string, Icon: any, badge?: number) => {
    const active = key === undefined ? a === undefined || a === 'reglages' || a === 'epargne' || a === 'recherche' : a === key;
    return (
      <button class="tab" aria-current={active ? 'page' : undefined} onClick={() => go(path)}>
        <span class="ico">
          <Icon size={22} />
        </span>
        {label}
        {badge ? (
          <span class="badge" aria-label={`${badge} en retard`}>
            {badge}
          </span>
        ) : null}
      </button>
    );
  };
  return (
    <nav class="tabbar" aria-label="Navigation principale">
      <div class="tabbar-inner">
        {tab('/', undefined, 'Accueil', Home)}
        {tab('/budget', 'budget', 'Budget', Wallet)}
        <button class="fab" aria-label="Ajouter (dépense, ticket, échéance, document)" onClick={() => openSheet('Ajouter', (close) => <AddMenu close={close} />)}>
          <Plus size={30} strokeWidth={2.4} />
        </button>
        {tab('/echeances', 'echeances', 'Échéances', CalendarClock, late)}
        {tab('/documents', 'documents', 'Documents', FolderLock)}
      </div>
    </nav>
  );
}

function Welcome({ close }: { close: () => void }) {
  const inst = installState.value;
  return (
    <SheetBody
      foot={
        <button
          class="btn primary big"
          onClick={async () => {
            await commit([setSettings({ welcomeDone: true })]);
            close();
            go('/reglages/budgets');
          }}
        >
          Fixer mes budgets
        </button>
      }
    >
      <p style={{ marginTop: 0 }}>
        Votre carnet personnel pour suivre vos budgets <b>CHF</b> et <b>MAD</b>, vos échéances, vos documents importants et vos objectifs d’épargne.
      </p>
      <div class="callout blue">
        <ShieldCheck size={16} style={{ verticalAlign: '-3px' }} /> <b>Tout reste sur ce téléphone.</b> Pas de compte, pas de serveur, pas de connexion bancaire. Pensez à faire des sauvegardes (Réglages › Sauvegarde).
      </div>
      {!inst.standalone && (
        <div class="callout">
          <b>Installez d’abord l’app sur l’écran d’accueil</b>, puis saisissez vos données dans l’app installée.
          {inst.ios ? ' Sur iPhone : dans Safari, bouton Partager › « Sur l’écran d’accueil ».' : ' Sur Android : menu du navigateur › « Installer l’application ».'}
        </div>
      )}
      <ul class="small" style={{ paddingLeft: 18 }}>
        <li>
          <b>+</b> en bas : dépense en 3 touches, ticket photo, échéance, document.
        </li>
        <li>Les budgets CHF et MAD ne sont jamais additionnés ni convertis.</li>
        <li>Aucun numéro de compte, de carte, de passeport ou d’AVS ne doit être enregistré.</li>
      </ul>
      <button
        class="btn block ghost"
        onClick={async () => {
          await commit([setSettings({ welcomeDone: true })]);
          close();
        }}
      >
        Plus tard
      </button>
    </SheetBody>
  );
}

export function App() {
  useEffect(() => {
    if (!data.value.settings.welcomeDone) setTimeout(() => openSheet('Bienvenue', (close) => <Welcome close={close} />), 300);
  }, []);
  return (
    <>
      <main class="app">
        <Screen />
      </main>
      <TabBar />
      <SheetHost />
      <DialogHost />
      <ToastHost />
      <LockScreen />
    </>
  );
}

