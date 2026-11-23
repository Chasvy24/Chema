// Chiffrement standard du navigateur (WebCrypto) : PBKDF2-SHA-256 + AES-GCM 256 bits.
// Disponible uniquement en contexte sécurisé (HTTPS ou localhost).

export const BACKUP_ITERATIONS = 600_000;
export const PIN_ITERATIONS = 150_000;

export function hasWebCrypto(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

export function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password) as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export interface EncryptedEnvelope {
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-GCM'; iv: string };
  payload: string; // base64
}

export async function encryptBytes(plain: Uint8Array, password: string, iterations = BACKUP_ITERATIONS): Promise<EncryptedEnvelope> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, iterations);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain as BufferSource));
  return { kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) }, cipher: { name: 'AES-GCM', iv: toB64(iv) }, payload: toB64(ct) };
}

export async function decryptBytes(env: EncryptedEnvelope, password: string): Promise<Uint8Array> {
  const key = await deriveKey(password, fromB64(env.kdf.salt), env.kdf.iterations);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.cipher.iv) as BufferSource }, key, fromB64(env.payload) as BufferSource));
  } catch {
    throw new Error('Mot de passe incorrect ou fichier endommagé.');
  }
}

/** Empreinte d'un code PIN (jamais stocké en clair). */
export async function hashPin(pin: string, saltB64: string, iterations = PIN_ITERATIONS): Promise<string> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin) as BufferSource, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64) as BufferSource, iterations }, base, 256);
  return toB64(new Uint8Array(bits));
}

export function newSalt(): string {
  return toB64(randomBytes(16));
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('Décompression non disponible sur ce navigateur.');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
