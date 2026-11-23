// Suggestion d'installation sur l'écran d'accueil (PWA).
import { signal } from '@preact/signals';

let deferred: any = null;

function detect() {
  const standalone = typeof window !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);
  const ios = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  const mobile = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return { standalone, ios, mobile, prompt: !!deferred, canSuggest: !standalone && (mobile || !!deferred) };
}

export const installState = signal(detect());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    installState.value = detect();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installState.value = { ...detect(), canSuggest: false };
  });
}

export async function promptInstall() {
  if (!deferred) return;
  deferred.prompt();
  await deferred.userChoice.catch(() => null);
  deferred = null;
  installState.value = detect();
}

export function isStandalone() {
  return installState.value.standalone;
}
