import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const DEVICE_ID_KEY = 'privy_device_id';

async function generateSecureId(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes, (b: number) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Returns this device's persistent cryptographic identity.
 *
 * First call:  generates a 256-bit random value, stores it in the
 *              OS secure storage (Android Keystore / iOS Keychain).
 * Later calls: reads the stored value — same ID every time.
 *
 * This replaces hardware IDs (IMEI, Android ID, MAC address) which
 * can change, leak privacy, or be unavailable on some platforms.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (existing) return existing;

    const id = await generateSecureId();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
    return id;
  } catch {
    // SecureStore unavailable in rare edge cases — return ephemeral ID.
    return generateSecureId();
  }
}
