import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  ScrollView,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  useColorScheme,
  Modal,
  TouchableWithoutFeedback,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { BlurView } from "expo-blur";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Profile_Card from "@/components/profile_card";
import config, { normalizeApiBase, setApiBase } from "@/config";

function ServerSettings({ s, isDark }) {
  const [address, setAddress] = useState(config.API_BASE);
  const [status, setStatus] = useState("");

  const test = async (url) => {
    setStatus("Testing...");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`${url}/suggestions?q=a`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("Connected ✓");
      return true;
    } catch {
      setStatus("Could not connect. Check the address and that the server is running.");
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  const save = async () => {
    const url = normalizeApiBase(address);
    if (!url) return;
    setAddress(url);
    if (await test(url)) await setApiBase(url);
  };

  return (
    <View style={s.settingsCard}>
      <Text style={s.settingsTitle}>Server address</Text>
      <Text style={s.settingsHint}>
        The PC running the MediQuery backend, e.g. 192.168.0.104:5000
      </Text>
      <TextInput
        style={s.input}
        value={address}
        onChangeText={setAddress}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="http://192.168.0.104:5000"
        placeholderTextColor={isDark ? "#64748B" : "#94A3B8"}
      />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
        <Pressable
          style={[s.button, s.secondaryButton, { flex: 1 }]}
          onPress={() => test(normalizeApiBase(address))}
        >
          <Text style={s.secondaryButtonText}>Test</Text>
        </Pressable>
        <Pressable style={[s.button, s.editButton, { flex: 1, maxWidth: undefined }]} onPress={save}>
          <Text style={s.buttonText}>Save</Text>
        </Pressable>
      </View>
      {!!status && (
        <Text
          style={[
            s.settingsHint,
            { marginTop: 6, color: status.startsWith("Connected") ? "#16A34A" : status === "Testing..." ? undefined : "#DC2626" },
          ]}
        >
          {status}
        </Text>
      )}
    </View>
  );
}

const PROFILE_KEY = "USER_PROFILE_V1";
const genderOptions = ["male", "female", "other"];

const DEFAULT_PROFILE = {
  name: "Guest",
  age: 25,
  height: 160,
  weight: 70,
  gender: "other",
};

export default function Profile() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const dynamicStyles = styles(isDark);
  const [profileData, setProfileData] = useState(DEFAULT_PROFILE);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const isFirstLoad = useRef(true);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const saved = await AsyncStorage.getItem(PROFILE_KEY);
        if (saved) setProfileData(JSON.parse(saved));
      } catch (err) {
        console.error("Error loading user profile:", err);
      }
    };

    loadProfile();
  }, []);

  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      return;
    }

    const saveProfile = async () => {
      try {
        await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profileData));
      } catch (err) {
        console.error("Error saving profile:", err);
      }
    };

    saveProfile();
  }, [profileData]);

  const handleChange = useCallback((field, value) => {
    setProfileData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const saveProfile = () => {
    setEditModalVisible(false);
    Alert.alert("Success", "Profile saved successfully!");
  };

  return (
    <View style={[dynamicStyles.container]}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: 16,
          paddingTop: 20,
        }}
      >
        <Text style={dynamicStyles.header}>Profile</Text>

        <Profile_Card {...profileData} visible />

        <Pressable
          style={[dynamicStyles.button, dynamicStyles.editButton]}
          onPress={() => setEditModalVisible(true)}
        >
          <Text style={dynamicStyles.buttonText}>Edit Profile</Text>
        </Pressable>

        <ServerSettings s={dynamicStyles} isDark={isDark} />
      </ScrollView>

      {/* Edit Modal */}
        <Modal
          visible={editModalVisible}
          animationType="fade"
          transparent
          statusBarTranslucent
          onRequestClose={() => setEditModalVisible(false)}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <KeyboardAvoidingView
              style={dynamicStyles.modalOverlay}
              behavior={Platform.OS === "ios" ? "padding" : "height"}
            >
              <BlurView
                intensity={80}
                tint={isDark ? "dark" : "light"}
                style={dynamicStyles.blur}
              />

              <ScrollView
                style={dynamicStyles.modalContent}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={dynamicStyles.modalTitle}>Edit Profile</Text>

                <Text style={dynamicStyles.label}>Name</Text>
                <TextInput
                  style={dynamicStyles.input}
                  value={profileData.name}
                  onChangeText={(t) => handleChange("name", t)}
                />

                <Text style={dynamicStyles.label}>Age (yr)</Text>
                <TextInput
                  style={dynamicStyles.input}
                  value={String(profileData.age)}
                  keyboardType="numeric"
                  onChangeText={(t) => handleChange("age", parseInt(t) || 0)}
                />

                <Text style={dynamicStyles.label}>Height (cm)</Text>
                <TextInput
                  style={dynamicStyles.input}
                  value={String(profileData.height)}
                  keyboardType="numeric"
                  onChangeText={(t) =>
                    handleChange("height", parseFloat(t) || 0)
                  }
                />

                <Text style={dynamicStyles.label}>Weight (kg)</Text>
                <TextInput
                  style={dynamicStyles.input}
                  value={String(profileData.weight)}
                  keyboardType="numeric"
                  onChangeText={(t) =>
                    handleChange("weight", parseFloat(t) || 0)
                  }
                />

                <Text style={dynamicStyles.label}>Gender</Text>
                <View style={dynamicStyles.genderContainer}>
                  {genderOptions.map((option) => {
                    const selected = profileData.gender === option;
                    return (
                      <Pressable
                        key={option}
                        style={[
                          dynamicStyles.genderButton,
                          selected && dynamicStyles.genderSelected,
                        ]}
                        onPress={() => handleChange("gender", option)}
                      >
                        <Text
                          style={[
                            dynamicStyles.genderText,
                            selected && dynamicStyles.genderTextSelected,
                          ]}
                        >
                          {option.charAt(0).toUpperCase() + option.slice(1)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Pressable
                  style={[dynamicStyles.button, dynamicStyles.saveButton]}
                  onPress={saveProfile}
                >
                  <Text style={dynamicStyles.buttonText}>Save Changes</Text>
                </Pressable>

                <Pressable
                  style={[dynamicStyles.button, dynamicStyles.cancelButton]}
                  onPress={() => setEditModalVisible(false)}
                >
                  <Text style={dynamicStyles.buttonText}>Cancel</Text>
                </Pressable>
              </ScrollView>
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </Modal>
    </View>
  );
}

const styles = (isDark) => {
  const colors = {
    background: isDark ? "#000000" : "#F0FDF4",
    text: isDark ? "#E5E7EB" : "#1F2937",
    secondaryText: isDark ? "#A1A1AA" : "#4B5563",
    inputBg: isDark ? "#2A2A2A" : "#F1F5F9",
    inputBorder: isDark ? "#334155" : "#D1D5DB",
    buttonPrimary: "#0EA5A4",
    buttonSecondary: isDark ? "#0EA5A4" : "#38BDF8",
    buttonDanger: isDark ? "#F87171" : "#EF4444",
    modalBg: isDark ? "#1E293B" : "#FFFFFF",
    genderSelected: isDark ? "#0EA5A4" : "#38BDF8",
  };

  return StyleSheet.create({
    container: { flex: 1, paddingTop: 4, paddingBottom: 10, backgroundColor: colors.background },
    
    header: {
      fontSize: 20,
      fontWeight: "700",
      marginVertical: 16,
      color: colors.text,
    },
    button: {
      paddingVertical: 9,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: "center",
      marginVertical: 6,
    },
    buttonText: {
      color: "#fff",
      fontWeight: "bold",
      fontSize: 16,
    },
    editButton: {
      backgroundColor: colors.buttonPrimary,
      alignSelf: "center",
      minWidth: 120,
      maxWidth: 160,
    },
    saveButton: {
      backgroundColor: colors.buttonSecondary,
    },
    secondaryButton: {
      borderWidth: 1,
      borderColor: colors.buttonPrimary,
    },
    secondaryButtonText: {
      color: colors.buttonPrimary,
      fontWeight: "bold",
      fontSize: 16,
    },
    settingsCard: {
      marginHorizontal: 16,
      marginTop: 24,
      padding: 16,
      borderRadius: 20,
      backgroundColor: isDark ? "#1E293B" : "#FFFFFF",
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    settingsTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },
    settingsHint: {
      fontSize: 13,
      color: colors.secondaryText,
      marginTop: 2,
      marginBottom: 8,
    },
    cancelButton: {
      backgroundColor: colors.buttonDanger,
    },
    modalOverlay: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
    },
    blur: {
      ...StyleSheet.absoluteFillObject,
    },
    modalContent: {
      width: "90%",
      flexGrow: 0,
      maxHeight: "85%",
      backgroundColor: colors.modalBg,
      borderRadius: 20,
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: "700",
      marginBottom: 16,
      textAlign: "center",
      color: colors.text,
    },
    label: {
      marginBottom: 6,
      fontWeight: "600",
      color: colors.secondaryText,
    },
    input: {
      backgroundColor: colors.inputBg,
      borderColor: colors.inputBorder,
      borderWidth: 1,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 6,
      marginBottom: 6,
      color: colors.text,
    },
    genderContainer: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    genderButton: {
      flex: 1,
      paddingVertical: 10,
      marginHorizontal: 4,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      alignItems: "center",
    },
    genderSelected: {
      backgroundColor: colors.genderSelected,
      borderColor: colors.genderSelected,
    },
    genderText: {
      color: colors.text,
      fontWeight: "600",
    },
    genderTextSelected: {
      color: "#fff",
    },
  });
};
