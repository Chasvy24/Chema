// Verrouillage de l'application par code, avec option biométrique (Face ID / empreinte)
// via une « clé d'accès » WebAuthn du téléphone, lorsqu'elle est disponible.
//
// Honnêteté : ce verrou empêche l'accès à l'interface (ex. téléphone prêté déverrouillé).
// Il NE chiffre PAS les données stockées dans le navigateur. La protection des données au repos
// repose sur le chiffrement du téléphone et son code de déverrouillage.

import { signal } from '@preact/signals';
import { data, commit, setDevice } from '../db/store';
import { hashPin, newSalt, PIN_ITERATIONS, randomBytes, toB64, fromB64 } from '../lib/crypto';

export const locked = signal(false);
export const docsUnlocked = signal(false);

export function lockConfig() {
  return data.value.device.lock;
}

export function lockEnabled(): boolean {
  return !!data.value.device.lock?.enabled;
}

export async function setPin(pin: string, scope: 'app' | 'docs', delayMin: number) {
  const salt = newSalt();
  const hash = await hashPin(pin, salt, PIN_ITERATIONS);
  const prev = data.value.device.lock;
  await commit([setDevice({ lock: { enabled: true, scope, salt, hash, iterations: PIN_ITERATIONS, length: pin.length, delayMin, webauthnId: prev?.webauthnId } })], { message: 'Code de verrouillage activé' });
}

export async function updateLockOptions(patch: { scope?: 'app' | 'docs'; delayMin?: number }) {
  const l = data.value.device.lock;
  if (!l) return;
  await commit([setDevice({ lock: { ...l, ...patch } })], { message: 'Réglage enregistré' });
}

export async function disableLock() {
  await commit([setDevice({ lock: undefined })], { message: 'Verrouillage désactivé' });
  locked.value = false;
}

export async function checkPin(pin: string): Promise<boolean> {
  const l = data.value.device.lock;
  if (!l) return true;
  return (await hashPin(pin, l.salt, l.iterations)) === l.hash;
}

export function unlock() {
  locked.value = false;
  docsUnlocked.value = true;
}

export function lockNow() {
  if (!lockEnabled()) return;
  docsUnlocked.value = false;
  if (data.value.device.lock!.scope === 'app') locked.value = true;
}

export function needsDocsUnlock(): boolean {
  const l = data.value.device.lock;
  return !!l?.enabled && l.scope === 'docs' && !docsUnlocked.value;
}

let hiddenAt = 0;
export function initAutoLock() {
  if (lockEnabled() && data.value.device.lock!.scope === 'app') locked.value = true;
  document.addEventListener('visibilitychange', () => {
    const l = data.value.device.lock;
    if (!l?.enabled) return;
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt >= l.delayMin * 60_000) lockNow();
  });
}

// ---------- Biométrie (WebAuthn) ----------

export async function biometricAvailable(): Promise<boolean> {
  try {
    if (!window.isSecureContext || !window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function enableBiometric(): Promise<boolean> {
  const l = data.value.device.lock;
  if (!l) return false;
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32) as BufferSource,
      rp: { name: 'Chema' },
      user: { id: randomBytes(16) as BufferSource, name: 'chema', displayName: 'Chema (déverrouillage)' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) return false;
  await commit([setDevice({ lock: { ...l, webauthnId: toB64(new Uint8Array(cred.rawId)) } })], { message: 'Déverrouillage biométrique activé' });
  return true;
}

export async function disableBiometric() {
  const l = data.value.device.lock;
  if (!l) return;
  await commit([setDevice({ lock: { ...l, webauthnId: undefined } })], { message: 'Déverrouillage biométrique désactivé' });
}

/** Demande au téléphone une vérification biométrique (ou son code) via la clé d'accès enregistrée. */
export async function unlockWithBiometric(): Promise<boolean> {
  const l = data.value.device.lock;
  if (!l?.webauthnId) return false;
  try {
    const res = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32) as BufferSource,
        allowCredentials: [{ type: 'public-key', id: fromB64(l.webauthnId) as BufferSource }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    if (!res) return false;
    const auth = new Uint8Array((res.response as AuthenticatorAssertionResponse).authenticatorData);
    const userVerified = (auth[32] & 0x04) !== 0;
    if (userVerified) unlock();
    return userVerified;
  } catch {
    return false;
  }
}
