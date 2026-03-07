/**
 * lib/e2ee.ts
 *
 * End-to-end encryption using pure-JS @noble libraries.
 * No WebCrypto / crypto.subtle required — works on Android Hermes out of the box.
 *
 * Primitives:
 *   ECDH P-256    → @noble/curves/p256
 *   AES-256-GCM   → @noble/ciphers/aes
 *
 * Wire format:
 *   Public keys  : base64 of 65-byte uncompressed P-256 point (0x04 || x || y)
 *   Ciphertext   : "<iv_b64>.<ciphertext+tag_b64>"
 *   Shared secret: 32-byte x-coordinate of ECDH shared point = AES-256 key
 */

import { gcm } from '@noble/ciphers/aes.js';
import { p256 } from '@noble/curves/nist.js';
import * as ExpoCrypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const PRIVATE_KEY_STORE = 'privy_ecdh_private_key';
const PUBLIC_KEY_STORE  = 'privy_ecdh_public_key';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function randomBytes(n: number): Uint8Array {
  // expo-crypto.getRandomBytes works on Android, iOS, and web — no crypto.subtle needed.
  return ExpoCrypto.getRandomBytes(n);
}

// ─── Key generation ───────────────────────────────────────────────────────────

/**
 * Generate a fresh ECDH P-256 key pair and persist both halves.
 * Private key → SecureStore (base64 raw 32 bytes)
 * Public key  → SecureStore (base64 raw uncompressed 65 bytes)
 */
export async function generateKeyPair(): Promise<{ publicKeyB64: string }> {
  // Generate private key using expo-crypto — never touches global crypto object.
  // noble validates the scalar; retry on the rare out-of-range case.
  let privKeyBytes: Uint8Array;
  do {
    privKeyBytes = ExpoCrypto.getRandomBytes(32);
  } while (!p256.utils.isValidSecretKey(privKeyBytes));

  const pubKeyBytes = p256.getPublicKey(privKeyBytes, false); // 65 bytes uncompressed

  await SecureStore.setItemAsync(PRIVATE_KEY_STORE, uint8ToBase64(privKeyBytes));
  await SecureStore.setItemAsync(PUBLIC_KEY_STORE,  uint8ToBase64(pubKeyBytes));

  return { publicKeyB64: uint8ToBase64(pubKeyBytes) };
}

/** Return the stored public key, or generate a new pair. */
export async function getOrCreatePublicKey(): Promise<string> {
  // Migration: old format stored private key as JWK JSON — force re-gen.
  const storedPriv = await SecureStore.getItemAsync(PRIVATE_KEY_STORE);
  if (storedPriv?.trimStart().startsWith('{')) {
    await SecureStore.deleteItemAsync(PRIVATE_KEY_STORE);
    await SecureStore.deleteItemAsync(PUBLIC_KEY_STORE);
  }
  const stored = await SecureStore.getItemAsync(PUBLIC_KEY_STORE);
  if (stored) return stored;
  const { publicKeyB64 } = await generateKeyPair();
  return publicKeyB64;
}

/** Return the stored public key, or null if no key pair exists yet. */
export async function getStoredPublicKey(): Promise<string | null> {
  return SecureStore.getItemAsync(PUBLIC_KEY_STORE);
}

// ─── Key exchange ─────────────────────────────────────────────────────────────

/**
 * Derive a 32-byte AES key from our private key + peer's public key.
 * Returns the x-coordinate of the ECDH shared point (same value as WebCrypto).
 */
export async function deriveSharedKey(peerPublicKeyB64: string): Promise<Uint8Array> {
  const privB64 = await SecureStore.getItemAsync(PRIVATE_KEY_STORE);
  if (!privB64) throw new Error('No local ECDH private key – regenerate key pair');

  // shared point compressed = 33 bytes (0x02/03 || x); slice off prefix for raw x
  const shared = p256.getSharedSecret(
    base64ToUint8(privB64),
    base64ToUint8(peerPublicKeyB64),
    true,
  );
  return shared.slice(1); // 32-byte x = AES-256 key material
}

// ─── Encrypt / Decrypt ────────────────────────────────────────────────────────

/** Encrypt a UTF-8 string. Returns `<iv_base64>.<ciphertext_base64>`. */
export async function encryptMessage(
  aesKey: Uint8Array,
  plaintext: string,
): Promise<string> {
  const iv = randomBytes(12);
  const ct = gcm(aesKey, iv).encrypt(new TextEncoder().encode(plaintext));
  return `${uint8ToBase64(iv)}.${uint8ToBase64(ct)}`;
}

/** Decrypt a string produced by encryptMessage. */
export async function decryptMessage(
  aesKey: Uint8Array,
  payload: string,
): Promise<string> {
  const [ivB64, ctB64] = payload.split('.');
  const pt = gcm(aesKey, base64ToUint8(ivB64)).decrypt(base64ToUint8(ctB64));
  return new TextDecoder().decode(pt);
}

// ─── Key cache ────────────────────────────────────────────────────────────────

const _keyCache = new Map<string, Uint8Array>();

/**
 * Return (and cache) a shared AES key for a given peer.
 */
export async function getSharedKey(peerId: string, peerPublicKeyB64: string): Promise<Uint8Array> {
  const cached = _keyCache.get(peerId);
  if (cached) return cached;
  const key = await deriveSharedKey(peerPublicKeyB64);
  _keyCache.set(peerId, key);
  return key;
}

/** Clear cached key for a peer (e.g. after key rotation). */
export function evictKeyCache(peerId: string): void {
  _keyCache.delete(peerId);
}

// ─── Utility ─────────────────────────────────────────────────────────────────

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  return uint8ToBase64(bytes);
}

export function base64ToUint8Array(b64: string): Uint8Array {
  return base64ToUint8(b64);
}