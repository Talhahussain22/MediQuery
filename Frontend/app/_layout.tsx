import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";
import { useEffect, useState } from "react";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { loadSavedApiBase } from "@/config";
import { AuthProvider, useAuth } from "@/context/AuthContext";

function RootNavigator() {
  const { session, loading } = useAuth();
  const [configReady, setConfigReady] = useState(false);

  useEffect(() => {
    loadSavedApiBase().finally(() => setConfigReady(true));
  }, []);

  if (loading || !configReady) return null;

  return (
    <Stack>
      {/* Signed in: the app. Signed out: only the auth screens are reachable. */}
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="modal"
          options={{ presentation: "modal", title: "Modal" }}
        />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <RootNavigator />
        <StatusBar style="auto" />
      </ThemeProvider>
    </AuthProvider>
  );
}
