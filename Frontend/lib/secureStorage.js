import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// SecureStore warns above ~2KB per value and a Supabase session (access +
// refresh token + user JSON) is usually larger, so values are split into
// chunks: `${key}.n` holds the chunk count and `${key}.0..n-1` the pieces.
const CHUNK_SIZE = 1800;

const OPTIONS = {
  // Readable after the first unlock so tokens can refresh while the app is
  // backgrounded; never synced to iCloud or other devices.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

// SecureStore has no web implementation; fall back to localStorage there.
const isWeb = Platform.OS === "web";

async function rawGet(key) {
  if (isWeb) return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  return SecureStore.getItemAsync(key, OPTIONS);
}

async function rawSet(key, value) {
  if (isWeb) return localStorage.setItem(key, value);
  return SecureStore.setItemAsync(key, value, OPTIONS);
}

async function rawDelete(key) {
  if (isWeb) return localStorage.removeItem(key);
  return SecureStore.deleteItemAsync(key, OPTIONS);
}

async function chunkCount(key) {
  const n = parseInt(await rawGet(`${key}.n`), 10);
  return Number.isFinite(n) ? n : 0;
}

// Storage adapter with the getItem/setItem/removeItem shape supabase-js expects.
export const secureStorage = {
  async getItem(key) {
    try {
      const count = await chunkCount(key);
      if (!count) return null;
      const parts = await Promise.all(
        Array.from({ length: count }, (_, i) => rawGet(`${key}.${i}`)),
      );
      // A missing chunk means a write was interrupted; treat it as signed out.
      if (parts.some((p) => p == null)) return null;
      return parts.join("");
    } catch (e) {
      console.warn("secureStorage.getItem failed", e);
      return null;
    }
  },

  async setItem(key, value) {
    const previous = await chunkCount(key);
    const chunks = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    await Promise.all(chunks.map((c, i) => rawSet(`${key}.${i}`, c)));
    await rawSet(`${key}.n`, String(chunks.length));
    for (let i = chunks.length; i < previous; i++) await rawDelete(`${key}.${i}`);
  },

  async removeItem(key) {
    const count = await chunkCount(key);
    await Promise.all(
      Array.from({ length: count }, (_, i) => rawDelete(`${key}.${i}`)),
    );
    await rawDelete(`${key}.n`);
  },
};

export async function getSecureJSON(key) {
  const raw = await secureStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setSecureJSON(key, value) {
  return secureStorage.setItem(key, JSON.stringify(value));
}
