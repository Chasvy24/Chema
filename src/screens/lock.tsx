import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { Fingerprint, Lock, Delete } from 'lucide-preact';
import { data } from '../db/store';
import { checkPin, locked, unlock, unlockWithBiometric } from '../services/lock';
import { confirmTyped } from '../ui/feedback';
import { wipeEverything } from './settings';

export const lockOverlay = signal(false);

export function openLockOverlay() {
  lockOverlay.value = true;
}

export function LockScreen() {
  const show = locked.value || lockOverlay.value;
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [fails, setFails] = useState(0);
  const [waitUntil, setWaitUntil] = useState(0);
  const [, tick] = useState(0);
  const l = data.value?.device.lock;
  const len = l?.length ?? 6;

  useEffect(() => {
    if (show && l?.webauthnId) setTimeout(() => tryBio(), 300);
    if (!show) {
      setPin('');
      setError('');
    }
  }, [show]);

  useEffect(() => {
    if (waitUntil <= Date.now()) return;
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [waitUntil]);

  if (!show || !l) return null;

  async function tryBio() {
    if (await unlockWithBiometric()) {
      lockOverlay.value = false;
    }
  }

  async function press(k: string) {
    if (Date.now() < waitUntil) return;
    const next = (pin + k).slice(0, len);
    setPin(next);
    setError('');
    if (next.length === len) {
      if (await checkPin(next)) {
        unlock();
        lockOverlay.value = false;
        setFails(0);
      } else {
        const f = fails + 1;
        setFails(f);
        setPin('');
        if (f >= 5) {
          setWaitUntil(Date.now() + 30_000 * (f - 4));
          setError('Trop d’essais. Patientez avant de réessayer.');
        } else setError('Code incorrect.');
      }
    }
  }

  const wait = Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000));
  return (
    <div class="lock-screen" role="dialog" aria-modal="true" aria-label="Application verrouillée">
      <div class="avatar" style={{ width: 64, height: 64, borderRadius: 20 }}>
        <Lock size={30} />
      </div>
      <h1 style={{ fontSize: 24, marginTop: 14 }}>{locked.value ? 'Chema' : 'Coffre verrouillé'}</h1>
      <p class="muted small" style={{ margin: '4px 0 0' }}>
        Saisissez votre code ({len} chiffres)
      </p>
      <div class="pin-dots" aria-hidden="true">
        {Array.from({ length: len }, (_, i) => (
          <i class={i < pin.length ? 'on' : ''} />
        ))}
      </div>
      <div style={{ minHeight: 22 }} class="error" role="alert">
        {wait > 0 ? `${error} (${wait} s)` : error}
      </div>
      <div class="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button onClick={() => press(k)} aria-label={k}>
            {k}
          </button>
        ))}
        {l.webauthnId ? (
          <button class="plain" onClick={tryBio} aria-label="Déverrouiller avec la biométrie du téléphone">
            <Fingerprint size={28} />
          </button>
        ) : lockOverlay.value && !locked.value ? (
          <button class="plain" onClick={() => (lockOverlay.value = false)}>
            Fermer
          </button>
        ) : (
          <span />
        )}
        <button onClick={() => press('0')} aria-label="0">
          0
        </button>
        <button class="plain" onClick={() => setPin(pin.slice(0, -1))} aria-label="Effacer">
          <Delete size={26} />
        </button>
      </div>
      <button
        class="link-btn"
        style={{ marginTop: 18 }}
        onClick={async () => {
          const ok = await confirmTyped(
            'Code oublié',
            'Le code ne peut pas être récupéré. La seule solution est d’effacer toutes les données de cette application sur ce téléphone, puis de restaurer votre dernière sauvegarde.',
            'EFFACER',
            'Effacer toutes les données',
          );
          if (ok) await wipeEverything();
        }}
      >
        Code oublié ?
      </button>
    </div>
  );
}
