// Rappels — ce qui est fiable et ce qui ne l'est pas :
//  1. Dans l'application (toujours) : échéances de demain mises en évidence, retards en rouge,
//     et « rappels manqués » affichés à la prochaine ouverture.
//  2. Notification système quand l'application est ouverte (ou vient d'être mise en arrière-plan) :
//     un minuteur vérifie toutes les 30 s. Ne fonctionne PAS quand l'application est fermée.
//  3. Android/Chrome, application installée : « synchronisation périodique » demandée au navigateur,
//     qui décide seul de la fréquence (souvent 1×/jour au mieux). Non garanti. Inexistant sur iPhone.
//  4. Export calendrier (.ics) : rappels gérés par l'app Calendrier du téléphone, fiables même
//     application fermée et hors ligne, mais non mis à jour automatiquement si l'échéance change.

import { signal } from '@preact/signals';
import { data, commit, setDevice, setSettings } from '../db/store';
import { alive } from '../db/actions';
import type { Deadline } from '../db/schema';
import { missedReminders, notifKey, reminderAt } from '../lib/deadlines';
import { deadlinesToICS } from '../lib/ics';
import { addDays, fmtDate, today } from '../lib/dates';
import { toast } from '../ui/feedback';
import { downloadFile } from '../db/files';

export const missed = signal<string[]>([]);
export const swReg = signal<ServiceWorkerRegistration | null>(null);
export const periodicSyncStatus = signal<'unsupported' | 'registered' | 'denied' | 'unknown'>('unknown');

export function missedNow(): Deadline[] {
  const ids = new Set(missed.value);
  return alive(data.value.deadlines).filter((d) => ids.has(d.id) && d.status !== 'done');
}

export function dismissMissed() {
  missed.value = [];
}

export function notifSupport(): { supported: boolean; permission: NotificationPermission | 'unsupported'; standalone: boolean; ios: boolean } {
  const supported = typeof Notification !== 'undefined';
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return { supported, permission: supported ? Notification.permission : 'unsupported', standalone, ios };
}

export async function requestNotifications(): Promise<boolean> {
  const s = notifSupport();
  if (!s.supported) {
    toast(s.ios && !s.standalone ? 'Sur iPhone, installez d’abord l’app sur l’écran d’accueil pour autoriser les notifications.' : 'Les notifications ne sont pas disponibles dans ce navigateur.', { tone: 'warn', duration: 6000 });
    return false;
  }
  const p = await Notification.requestPermission();
  await commit([setSettings({ notificationsWanted: p === 'granted' })]);
  if (p === 'granted') {
    await registerPeriodicSync();
    toast('Notifications autorisées (quand l’app est ouverte — voir les limites).', { tone: 'ok' });
    return true;
  }
  toast('Notifications refusées. Les rappels restent visibles dans l’application.', { tone: 'warn' });
  return false;
}

async function show(title: string, body: string, tag: string, url: string) {
  const reg = swReg.value ?? (await navigator.serviceWorker?.getRegistration?.());
  if (reg) await reg.showNotification(title, { body, tag, icon: './icons/icon-192.png', badge: './icons/badge-96.png', data: { url } } as NotificationOptions);
  else new Notification(title, { body, tag });
}

export async function testNotification() {
  try {
    await show('Chema', 'Ceci est une notification de test.', 'test', '#/');
    toast('Notification de test envoyée.');
  } catch (e) {
    toast(`Impossible d’afficher une notification : ${(e as Error).message}`, { tone: 'error' });
  }
}

/** Vérifie les rappels arrivés à échéance pendant que l'application est ouverte. */
async function checkDue() {
  const d = data.value;
  if (!d) return;
  const now = Date.now();
  const t = today();
  const log = { ...d.device.notifLog };
  const due = alive(d.deadlines).filter((x) => x.status !== 'done' && x.date >= t && reminderAt(x, d.settings.reminderTime) <= now && !log[notifKey(x)]);
  if (!due.length) return;
  const canNotify = d.settings.notificationsWanted && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  for (const x of due) {
    log[notifKey(x)] = now;
    const when = x.date === t ? 'Aujourd’hui' : x.date === addDays(t, 1) ? 'Demain' : fmtDate(x.date);
    if (canNotify) {
      try {
        await show(`${when} : ${x.title}`, 'Échéance à ne pas oublier.', x.id, `#/echeances/${x.id}`);
      } catch {
        /* le message dans l'app suffit */
      }
    }
    toast(`Rappel — ${when.toLowerCase()} : ${x.title}`, { tone: 'info', duration: 8000 });
  }
  await commit([setDevice({ notifLog: log })]);
}

let timer: number | undefined;

export async function initReminders() {
  const d = data.value;
  missed.value = missedReminders(alive(d.deadlines), d.settings.reminderTime, d.settings.lastVisitAt, Date.now(), d.device.notifLog).map((x) => x.id);
  await commit([setSettings({ lastVisitAt: Date.now() })]);
  // Nettoyage du journal des notifications (> 60 jours)
  const cutoff = Date.now() - 60 * 86400000;
  const log = Object.fromEntries(Object.entries(d.device.notifLog).filter(([, v]) => v > cutoff));
  if (Object.keys(log).length !== Object.keys(d.device.notifLog).length) await commit([setDevice({ notifLog: log })]);
  clearInterval(timer);
  timer = window.setInterval(checkDue, 30_000);
  setTimeout(checkDue, 3000);
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      await commit([setSettings({ lastVisitAt: Date.now() })]);
    } else {
      const cur = data.value;
      const newly = missedReminders(alive(cur.deadlines), cur.settings.reminderTime, cur.settings.lastVisitAt, Date.now(), cur.device.notifLog).map((x) => x.id);
      if (newly.length) missed.value = Array.from(new Set([...missed.value, ...newly]));
      checkDue();
    }
  });
}

export async function registerSW() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    swReg.value = reg;
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Nouvelle version disponible.', { tone: 'info', duration: 15000, action: { label: 'Recharger', run: () => location.reload() } });
        }
      });
    });
    if (data.value?.settings.notificationsWanted) registerPeriodicSync();
  } catch {
    /* hors ligne/HTTP : l'app fonctionne quand même pendant la session */
  }
}

export async function registerPeriodicSync() {
  try {
    const reg = swReg.value ?? (await navigator.serviceWorker.ready);
    const ps = (reg as any).periodicSync;
    if (!ps) {
      periodicSyncStatus.value = 'unsupported';
      return;
    }
    const perm = await (navigator as any).permissions?.query({ name: 'periodic-background-sync' }).catch(() => null);
    if (perm && perm.state !== 'granted') {
      periodicSyncStatus.value = 'denied';
      return;
    }
    await ps.register('echeances', { minInterval: 12 * 60 * 60 * 1000 });
    periodicSyncStatus.value = 'registered';
  } catch {
    periodicSyncStatus.value = 'unsupported';
  }
}

export async function exportICS(list: Deadline[]) {
  if (!list.length) {
    toast('Aucune échéance à venir à exporter.', { tone: 'info' });
    return;
  }
  const ics = deadlinesToICS(list, data.value.settings.reminderTime);
  const name = list.length === 1 ? `echeance-${list[0].date}.ics` : `echeances-${today()}.ics`;
  downloadFile(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), name);
  toast(
    list.length === 1
      ? 'Fichier calendrier créé : ouvrez-le pour l’ajouter à votre calendrier (rappel la veille).'
      : `${list.length} échéances exportées : ouvrez le fichier pour les ajouter à votre calendrier. Réexporter crée des doublons.`,
    { tone: 'info', duration: 8000 },
  );
}
