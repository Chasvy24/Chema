import type { Currency } from '../lib/money';
import type { ISODate, MonthKey } from '../lib/dates';

export type ID = string;

export interface Category {
  id: ID;
  kind: 'expense' | 'doc';
  name: string;
  order: number;
  /** Catégorie système (ne peut pas être supprimée) : reçus, identité, banque */
  system?: 'receipts' | 'identity' | 'bank';
  deletedAt?: string;
}

export type TxKind = 'expense' | 'refund' | 'income';

export interface Tx {
  id: ID;
  kind: TxKind;
  /** Date réelle de l'opération */
  date: ISODate;
  /** Mois budgétaire si différent du mois de la date (paiement d'une charge fixe, remboursement imputé au mois de la dépense) */
  month?: MonthKey;
  amount: number; // centimes, toujours positif
  currency: Currency;
  categoryId: ID | null;
  label: string;
  note?: string;
  /** Pour un remboursement : la dépense corrigée */
  refundOf?: ID;
  /** Paiement d'une occurrence de charge fixe : `${recurringId}@${YYYY-MM}` */
  occurrence?: string;
  deadlineId?: ID;
  docIds: ID[];
  receiptDocId?: ID;
  source: 'quick' | 'manual' | 'receipt' | 'csv' | 'recurring' | 'deadline';
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export type Frequency = 1 | 2 | 3 | 6 | 12; // pas en mois

export interface Recurring {
  id: ID;
  name: string;
  currency: Currency;
  categoryId: ID | null;
  day: number; // 1..31
  frequency: Frequency;
  startDate: ISODate;
  endDate?: ISODate;
  /** Historique du montant de base : chaque entrée s'applique à partir de son mois */
  amounts: Array<{ from: MonthKey; amount: number }>;
  /** Ajustements ponctuels par mois (montant réel d'un mois, mois ignoré) */
  overrides: Record<MonthKey, { amount?: number; skipped?: boolean }>;
  pauses: Array<{ from: ISODate; to?: ISODate }>;
  note?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export type DeadlineType = 'bill' | 'contract' | 'admin' | 'expiry';
export type DeadlineStatus = 'todo' | 'doing' | 'done';
export type DeadlineFreq = 'none' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';

export interface ContractInfo {
  endDate: ISODate;
  noticeValue: number;
  noticeUnit: 'months' | 'days';
  /** true si la date limite a été corrigée à la main */
  manual: boolean;
}

export interface Deadline {
  id: ID;
  title: string;
  date: ISODate;
  type: DeadlineType;
  note?: string;
  amount?: number;
  currency?: Currency;
  /** Montant variable (facture) : à saisir au paiement */
  variable?: boolean;
  categoryId?: ID | null;
  status: DeadlineStatus;
  docIds: ID[];
  frequency: DeadlineFreq;
  contract?: ContractInfo;
  /** Échéance « Fin de validité » créée automatiquement depuis ce document */
  sourceDocId?: ID;
  /** Date initiale avant report */
  originalDate?: ISODate;
  completedAt?: string;
  /** Échéance suivante créée lors de la clôture (récurrence) */
  nextId?: ID;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export type Country = 'CH' | 'MA' | 'both';

export interface Doc {
  id: ID;
  title: string;
  country: Country;
  categoryId: ID;
  expiryDate?: ISODate;
  note?: string;
  keywords?: string;
  fileId?: ID;
  fileName?: string;
  mime?: string;
  size?: number;
  /** Image masquée dans l'application avant enregistrement */
  masked?: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Goal {
  id: ID;
  name: string;
  currency: Currency;
  target: number;
  targetDate?: ISODate;
  achievedAt?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Move {
  id: ID;
  goalId: ID;
  date: ISODate;
  /** positif = versement, négatif = retrait */
  amount: number;
  note?: string;
  createdAt: string;
}

export interface BudgetEntry {
  from: MonthKey;
  amount: number;
  caps: Record<ID, number>;
}

export interface Settings {
  id: 'main';
  budgets: Record<Currency, BudgetEntry[]>;
  reminderTime: string; // 'HH:MM'
  notificationsWanted: boolean;
  lastCurrency: Currency;
  /** Correspondances apprises libellé → catégorie (import CSV, corrections) */
  labelRules: Record<string, ID>;
  lastVisitAt?: number;
  lastBackupAt?: string;
  welcomeDone?: boolean;
  createdAt: string;
}

/** Réglages propres à cet appareil (non inclus dans les sauvegardes) */
export interface DeviceSettings {
  id: 'device';
  lock?: {
    enabled: boolean;
    scope: 'app' | 'docs';
    salt: string;
    hash: string;
    iterations: number;
    length: number; // nombre de chiffres du code
    delayMin: number; // verrouillage après N minutes en arrière-plan
    webauthnId?: string; // identifiant de la clé d'accès (biométrie du téléphone)
  };
  notifLog: Record<string, number>; // `${deadlineId}@${date}` → timestamp
}

export interface FileRec {
  id: ID;
  blob: Blob;
  mime: string;
  name: string;
  size: number;
  thumb?: Blob;
}

export interface Data {
  settings: Settings;
  device: DeviceSettings;
  categories: Category[];
  txs: Tx[];
  recurring: Recurring[];
  deadlines: Deadline[];
  docs: Doc[];
  goals: Goal[];
  moves: Move[];
}

export type CollName = 'categories' | 'txs' | 'recurring' | 'deadlines' | 'docs' | 'goals' | 'moves';
export const COLLECTIONS: CollName[] = ['categories', 'txs', 'recurring', 'deadlines', 'docs', 'goals', 'moves'];
