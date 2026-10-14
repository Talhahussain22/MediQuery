import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

const PORT = 5000;
const STORAGE_KEY = "API_BASE_OVERRIDE";

// Release builds bake in EXPO_PUBLIC_API_BASE at build time; in dev, reuse the
// host Metro is served from, which is the PC running the backend.
function defaultApiBase() {
  if (process.env.EXPO_PUBLIC_API_BASE) return process.env.EXPO_PUBLIC_API_BASE;
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return `http://${host || "10.0.2.2"}:${PORT}`;
}

// Mutable so the server address can be changed from the Profile screen when
// the backend PC gets a new IP; read config.API_BASE at request time.
const config = { API_BASE: defaultApiBase() };

export function normalizeApiBase(input) {
  let url = input.trim().replace(/\/+$/, "");
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (!/:\d+$/.test(url) && url.startsWith("http://")) url = `${url}:${PORT}`;
  return url;
}

export async function loadSavedApiBase() {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) config.API_BASE = saved;
  } catch {}
}

export async function setApiBase(url) {
  config.API_BASE = url || defaultApiBase();
  if (url) await AsyncStorage.setItem(STORAGE_KEY, url);
  else await AsyncStorage.removeItem(STORAGE_KEY);
}

export default config;
