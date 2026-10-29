import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSecureJSON, setSecureJSON } from "@/lib/secureStorage";

// Health data (age, height, weight, gender) is kept in SecureStore, one entry
// per signed-in user so profiles don't leak between accounts on a shared device.
const LEGACY_KEY = "USER_PROFILE_V1";
const keyFor = (userId) => `profile_${userId}`;

export async function loadProfile(userId) {
  const saved = await getSecureJSON(keyFor(userId));
  if (saved) return saved;

  // One-time move of the pre-auth profile out of plain AsyncStorage.
  const legacy = await AsyncStorage.getItem(LEGACY_KEY);
  if (!legacy) return null;
  await AsyncStorage.removeItem(LEGACY_KEY);
  try {
    const profile = JSON.parse(legacy);
    await setSecureJSON(keyFor(userId), profile);
    return profile;
  } catch {
    return null;
  }
}

export function saveProfile(userId, profile) {
  return setSecureJSON(keyFor(userId), profile);
}
