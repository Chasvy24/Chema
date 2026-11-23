// Navigation par ancre (#/budget…) + pile de feuilles (formulaires en bas d'écran).
// Le bouton « retour » d'Android ferme d'abord la feuille ouverte.
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';

export interface Route {
  path: string;
  parts: string[];
  query: URLSearchParams;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, q] = raw.split('?');
  return { path: path || '/', parts: path.split('/').filter(Boolean), query: new URLSearchParams(q ?? '') };
}

export const route = signal<Route>(parse(typeof location !== 'undefined' ? location.hash : ''));

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    route.value = parse(location.hash);
    window.scrollTo(0, 0);
  });
}

let pendingNav: (() => void) | null = null;

/** Navigue vers un écran ; attend d'abord la fermeture des feuilles ouvertes (retour d'historique). */
export function go(path: string) {
  closeAllSheets();
  const nav = () => {
    if (location.hash !== '#' + path) location.hash = path;
  };
  if (ignorePop > 0) {
    pendingNav = nav;
    setTimeout(flushNav, 400); // sécurité si l'événement « popstate » n'arrive pas
  } else nav();
}

function flushNav() {
  const n = pendingNav;
  pendingNav = null;
  if (n) n();
}

export function goBack(fallback: string) {
  if (history.state && history.state.depth > 0) history.back();
  else go(fallback);
}

// ---------- Feuilles ----------

export interface SheetSpec {
  id: number;
  title: string;
  full?: boolean;
  render: (close: () => void) => ComponentChildren;
}

export const sheets = signal<SheetSpec[]>([]);
let sheetId = 1;
let ignorePop = 0;

export function openSheet(title: string, render: SheetSpec['render'], opts: { full?: boolean } = {}): () => void {
  const spec: SheetSpec = { id: sheetId++, title, render, full: opts.full };
  sheets.value = [...sheets.value, spec];
  try {
    history.pushState({ sheet: spec.id }, '');
  } catch {
    /* ignore */
  }
  return () => closeSheet(spec.id);
}

export function closeSheet(id?: number, viaPop = false) {
  const list = sheets.value;
  if (!list.length) return;
  const target = id ?? list[list.length - 1].id;
  if (!list.some((s) => s.id === target)) return;
  sheets.value = list.filter((s) => s.id !== target);
  if (!viaPop && history.state && history.state.sheet) {
    ignorePop++;
    history.back();
  }
}

export function closeAllSheets() {
  const n = sheets.value.length;
  if (!n) return;
  sheets.value = [];
  if (history.state && history.state.sheet) {
    ignorePop++;
    history.go(-n);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignorePop > 0) {
      ignorePop--;
      if (ignorePop === 0) flushNav();
      return;
    }
    if (sheets.value.length) closeSheet(undefined, true);
  });
}
