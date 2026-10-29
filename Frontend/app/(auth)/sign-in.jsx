import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useColorScheme,
} from "react-native";
import { Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { authStyles } from "@/assets/styles/auth.styles";
import AuthInput from "@/components/auth-input";
import { useAuth } from "@/context/AuthContext";

export default function SignIn() {
  const s = authStyles(useColorScheme() === "dark");
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError("");
    const { error } = await signIn(email, password);
    // On success the auth guard in the root layout switches to the tabs.
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
        <Ionicons name="medkit" size={56} color="#0EA5A4" style={s.logo} />
        <Text style={s.title}>Welcome back</Text>
        <Text style={s.subtitle}>Sign in to MediQuery</Text>

        <View style={s.card}>
          <AuthInput
            s={s}
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
          />
          <AuthInput
            s={s}
            label="Password"
            secure
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            autoComplete="current-password"
            textContentType="password"
            onSubmitEditing={submit}
          />

          {!!error && <Text style={s.error}>{error}</Text>}

          <Pressable
            style={[s.button, busy && s.buttonDisabled]}
            onPress={submit}
            disabled={busy}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Sign In</Text>}
          </Pressable>
        </View>

        <View style={s.linkRow}>
          <Text style={s.linkText}>No account? </Text>
          <Link href="/sign-up" replace>
            <Text style={s.link}>Sign up</Text>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
