// Messages de retour (toasts) et boîtes de confirmation, pilotés par des signaux.
import { signal } from '@preact/signals';

export interface Toast {
  id: number;
  message: string;
  tone: 'ok' | 'info' | 'warn' | 'error';
  action?: { label: string; run: () => void };
  duration: number;
}

export const toasts = signal<Toast[]>([]);
let nextId = 1;

export function toast(message: string, opts: { tone?: Toast['tone']; action?: Toast['action']; duration?: number } = {}) {
  const t: Toast = { id: nextId++, message, tone: opts.tone ?? 'ok', action: opts.action, duration: opts.duration ?? (opts.action ? 7000 : 3500) };
  toasts.value = [...toasts.value.slice(-2), t];
  setTimeout(() => dismissToast(t.id), t.duration);
  return t.id;
}

export function dismissToast(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export interface DialogOption {
  value: string;
  label: string;
  tone?: 'primary' | 'danger' | 'plain';
}

export interface DialogState {
  id: number;
  title: string;
  message?: string;
  details?: string[];
  options: DialogOption[];
  input?: { label: string; type?: string; placeholder?: string; mustEqual?: string };
  resolve: (v: string | null, input?: string) => void;
}

export const dialog = signal<DialogState | null>(null);
let dialogId = 1;

/** Choix parmi plusieurs options ; renvoie la valeur choisie ou null si annulé. */
export function choose(title: string, message: string | undefined, options: DialogOption[], extra: { details?: string[] } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    dialog.value = {
      id: dialogId++,
      title,
      message,
      details: extra.details,
      options,
      resolve: (v) => {
        dialog.value = null;
        resolve(v);
      },
    };
  });
}

export async function confirmAction(title: string, message: string, confirmLabel = 'Confirmer', danger = false): Promise<boolean> {
  const v = await choose(title, message, [{ value: 'yes', label: confirmLabel, tone: danger ? 'danger' : 'primary' }]);
  return v === 'yes';
}

/** Confirmation renforcée : il faut saisir un mot (ex. EFFACER). */
export function confirmTyped(title: string, message: string, word: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.value = {
      id: dialogId++,
      title,
      message,
      options: [{ value: 'yes', label: confirmLabel, tone: 'danger' }],
      input: { label: `Tapez ${word} pour confirmer`, mustEqual: word },
      resolve: (v) => {
        dialog.value = null;
        resolve(v === 'yes');
      },
    };
  });
}

export function promptText(title: string, message: string, label: string, type = 'text', placeholder = ''): Promise<string | null> {
  return new Promise((resolve) => {
    dialog.value = {
      id: dialogId++,
      title,
      message,
      options: [{ value: 'ok', label: 'Valider', tone: 'primary' }],
      input: { label, type, placeholder },
      resolve: (v, input) => {
        dialog.value = null;
        resolve(v === 'ok' ? input ?? '' : null);
      },
    };
  });
}
