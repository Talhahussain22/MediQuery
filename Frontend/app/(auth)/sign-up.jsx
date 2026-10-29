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

export default function SignUp() {
  const s = authStyles(useColorScheme() === "dark");
  const { signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    setInfo("");
    if (!name.trim() || !email.trim() || !password) {
      setError("Fill in all fields.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    const { data, error } = await signUp(email, password, name);
    setBusy(false);
    if (error) {
      setError(error.message);
    } else if (!data.session) {
      // Email confirmation is on: no session until the link is clicked.
      setInfo("Check your inbox and confirm your email, then sign in.");
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
        <Ionicons name="medkit" size={56} color="#0EA5A4" style={s.logo} />
        <Text style={s.title}>Create account</Text>
        <Text style={s.subtitle}>Join MediQuery</Text>

        <View style={s.card}>
          <AuthInput
            s={s}
            label="Full name"
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
          />
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
            placeholder="At least 8 characters"
            autoComplete="new-password"
            textContentType="newPassword"
          />
          <AuthInput
            s={s}
            label="Confirm password"
            secure
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Repeat password"
            autoComplete="new-password"
            textContentType="newPassword"
            onSubmitEditing={submit}
          />

          {!!error && <Text style={s.error}>{error}</Text>}
          {!!info && <Text style={s.info}>{info}</Text>}

          <Pressable
            style={[s.button, busy && s.buttonDisabled]}
            onPress={submit}
            disabled={busy}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>Sign Up</Text>}
          </Pressable>
        </View>

        <View style={s.linkRow}>
          <Text style={s.linkText}>Already have an account? </Text>
          <Link href="/sign-in" replace>
            <Text style={s.link}>Sign in</Text>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
