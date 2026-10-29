import { StyleSheet } from "react-native";

export const authStyles = (isDark) => {
  const colors = {
    background: isDark ? "#000000" : "#F0FDF4",
    card: isDark ? "#1E293B" : "#FFFFFF",
    text: isDark ? "#E5E7EB" : "#1F2937",
    secondaryText: isDark ? "#A1A1AA" : "#4B5563",
    inputBg: isDark ? "#2A2A2A" : "#F1F5F9",
    inputBorder: isDark ? "#334155" : "#D1D5DB",
    primary: "#0EA5A4",
    danger: isDark ? "#F87171" : "#DC2626",
    success: "#16A34A",
  };

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scrollContent: {
      flexGrow: 1,
      justifyContent: "center",
      paddingHorizontal: 24,
      paddingVertical: 40,
    },
    logo: { alignSelf: "center", marginBottom: 12 },
    title: {
      fontSize: 28,
      fontWeight: "700",
      color: colors.text,
      textAlign: "center",
    },
    subtitle: {
      fontSize: 15,
      color: colors.secondaryText,
      textAlign: "center",
      marginTop: 6,
      marginBottom: 28,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 20,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    label: { marginBottom: 6, fontWeight: "600", color: colors.secondaryText },
    inputRow: { position: "relative", marginBottom: 14 },
    input: {
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.inputBg,
      borderColor: colors.inputBorder,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    eyeButton: { position: "absolute", right: 10, top: 10, padding: 4 },
    button: {
      backgroundColor: colors.primary,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: "center",
      marginTop: 6,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
    error: { color: colors.danger, marginBottom: 10, fontSize: 14 },
    info: { color: colors.success, marginBottom: 10, fontSize: 14 },
    linkRow: { flexDirection: "row", justifyContent: "center", marginTop: 20 },
    linkText: { fontSize: 15, color: colors.secondaryText },
    link: { fontSize: 15, color: colors.primary, fontWeight: "700" },
    placeholder: { color: isDark ? "#64748B" : "#94A3B8" },
    icon: { color: colors.secondaryText },
  });
};
