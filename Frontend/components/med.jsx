import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  ActivityIndicator,
  useColorScheme,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
  ScrollView,
  Keyboard,
} from "react-native";
import { SvgXml } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import config from "../config";
import AsyncStorage from "@react-native-async-storage/async-storage";

const HISTORY_KEY = "MED_SEARCH_HISTORY";

// Refresh icon SVG
const refreshSvg = (color = "#000") => `
<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="${color}" viewBox="0 0 24 24">
  <path d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7c2.76 0 5 2.24 
           5 5 0 1.64-.8 3.09-2.03 4l1.46 1.46A7.938 7.938 0 0 0 20 
           12c0-2.21-.9-4.21-2.35-5.65zM6 13c0-1.64.8-3.09 
           2.03-4L6.57 7.54A7.938 7.938 0 0 0 4 13c0 
           4.42 3.58 8 8 8v3l5-5-5-5v3c-2.76 
           0-5-2.24-5-5z"/>
</svg>
`;

export default function Med() {
  const colorScheme = useColorScheme();
  const [medicineName, setMedicineName] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [similarMeds, setSimilarMeds] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedMedicine, setSelectedMedicine] = useState(null);
  const [history, setHistory] = useState([]);
  const [searchError, setSearchError] = useState("");
  const spinAnim = useRef(new Animated.Value(0)).current;
  const [iconActive, setIconActive] = useState(false);

  const suggestionDebounceRef = useRef(null);
  const searchAbortRef = useRef(null);
  const suggestionAbortRef = useRef(null);

  const colors = {
    background: colorScheme === "dark" ? "#000000" : "#F0FDF4",
    card: colorScheme === "dark" ? "rgb(51, 54, 58)" : "rgba(248, 250, 252, 1)",
    text: colorScheme === "dark" ? "#F8FAFC" : "#1E293B",
    label: colorScheme === "dark" ? "#CBD5E1" : "#334155",
    price: "#16A34A",
    button: "#0EA5A4",
    placeholder: "#94A3B8",
    border: colorScheme === "dark" ? "#3F444B" : "#CBD5E1",
    overlay: "rgba(0,0,0,0.7)",
  };

  useEffect(() => {
    return () => {
      if (searchAbortRef.current) searchAbortRef.current.abort();
      if (suggestionAbortRef.current) suggestionAbortRef.current.abort();
      if (suggestionDebounceRef.current)
        clearTimeout(suggestionDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const stored = await AsyncStorage.getItem(HISTORY_KEY);
        if (stored) setHistory(JSON.parse(stored));
      } catch (e) {
        console.error("History load failed", e);
      }
    };
    loadHistory();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  const updateHistory = (name) => {
    if (!name) return;

    setHistory((prev) => {
      const filtered = prev.filter(
        (item) => item.toLowerCase() !== name.toLowerCase(),
      );
      const updated = [...filtered, name];
      return updated.slice(-5);
    });
  };

  const handleReset = () => {
    setIconActive(true);
    Animated.sequence([
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(spinAnim, {
        toValue: 0,
        duration: 0,
        useNativeDriver: true,
      }),
    ]).start(() => setIconActive(false));

    setMedicineName("");
    setSearchError("");
    setSearchResult(null);
    setSimilarMeds([]);
    setSuggestions([]);
  };

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["180deg", "0deg"],
  });

  const handleSearch = async (nameArg) => {
    const query = (typeof nameArg === "string" ? nameArg : medicineName).trim();
    if (!query) return;
    setMedicineName(query);
    Keyboard.dismiss();
    setSuggestions([]);
    setSearchError("");

    // Abort previous search
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }

    const controller = new AbortController();
    searchAbortRef.current = controller;

    try {
      setLoadingSearch(true);

      const res = await fetch(
        `${config.API_BASE}/medicine?name=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      );

      if (res.status === 404) {
        setSearchResult(null);
        setSimilarMeds([]);
        setSearchError(`No medicine found for "${query}".`);
        return;
      }
      if (!res.ok) throw new Error("Medicine fetch failed");

      const json = await res.json();
      setSearchResult(json || null);
      updateHistory(json?.name || query);

      let subs = [];

      if (json) {
        const getJson = (url) =>
          fetch(url, { signal: controller.signal })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);

        // Same-composition medicines from our own dataset, plus the
        // pharmacy's listed substitutes (only those we have data for).
        const sameComposition = json.short_composition1
          ? getJson(
              `${config.API_BASE}/similar?comp1=${encodeURIComponent(json.short_composition1)}` +
                (json.short_composition2
                  ? `&comp2=${encodeURIComponent(json.short_composition2)}`
                  : ""),
            )
          : Promise.resolve([]);
        const listed = [0, 1, 2, 3, 4]
          .map((i) => json[`substitute${i}`])
          .filter(Boolean)
          .map((n) => getJson(`${config.API_BASE}/medicine?name=${encodeURIComponent(n)}`));

        const [similar, ...listedResults] = await Promise.all([sameComposition, ...listed]);

        const seen = new Set([json.name?.toLowerCase()]);
        for (const s of [...(similar || []), ...listedResults]) {
          const key = s?.name?.toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          subs.push(s);
        }

        subs.sort((a, b) => {
          const priceA = parseFloat(a?.price) || Infinity;
          const priceB = parseFloat(b?.price) || Infinity;
          return priceA - priceB;
        });
      }

      setSimilarMeds(subs.slice(0, 15));
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Search error:", err.message);
        setSimilarMeds([]);
        setSearchError(
          `Could not reach the server at ${config.API_BASE}. Check your Wi-Fi, or update the server address in Profile.`,
        );
      }
    } finally {
      setLoadingSearch(false);
    }
  };

  const handleInputChange = (text) => {
    setMedicineName(text);

    if (suggestionDebounceRef.current) {
      clearTimeout(suggestionDebounceRef.current);
    }

    if (!text.trim()) {
      setSuggestions([]);
      return;
    }

    suggestionDebounceRef.current = setTimeout(async () => {
      if (suggestionAbortRef.current) {
        suggestionAbortRef.current.abort();
      }

      const controller = new AbortController();
      suggestionAbortRef.current = controller;

      setLoadingSuggestions(true);

      try {
        const res = await fetch(
          `${config.API_BASE}/suggestions?q=${encodeURIComponent(text)}`,
          { signal: controller.signal },
        );

        if (!res.ok) throw new Error("Failed to fetch suggestions");

        const json = await res.json();
        setSuggestions(Array.isArray(json) ? json.slice(0, 6) : []);
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("Suggestion error:", err.message);
          setSuggestions([]);
        }
      } finally {
        setLoadingSuggestions(false);
      }
    }, 400);
  };

  const handleSuggestionPress = (item) => {
    if (!item?.name) return;
    if (suggestionDebounceRef.current) clearTimeout(suggestionDebounceRef.current);
    handleSearch(item.name);
  };

  const renderHeader = () => (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text style={[styles.title, { color: colors.text }]}>
          Find a medicine
        </Text>
        <TouchableOpacity onPress={handleReset}>
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <SvgXml
              xml={refreshSvg(iconActive ? "#ffffffff" : colors.text)}
              width="28"
              height="28"
            />
          </Animated.View>
        </TouchableOpacity>
      </View>

      <View style={{ zIndex: 10 }}>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.card,
              color: colors.text,
              borderColor: colors.label,
            },
          ]}
          value={medicineName}
          placeholder="e.g. Panadol, Augmentin, Brufen"
          returnKeyType="search"
          onSubmitEditing={() => handleSearch()}
          placeholderTextColor={colors.placeholder}
          onChangeText={handleInputChange}
        />
      </View>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.button }]}
        onPress={() => handleSearch()}
        disabled={loadingSearch}
      >
        {loadingSearch ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Search</Text>
        )}
      </TouchableOpacity>

        {medicineName.length > 0 && (loadingSuggestions || suggestions.length > 0) && (
          <View
            style={[
              styles.suggestionBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {loadingSuggestions && suggestions.length === 0 ? (
              <ActivityIndicator
                style={{ padding: 12 }}
                size="small"
                color={colors.button}
              />
            ) : (
              <FlatList
                data={suggestions.filter((item) => item && item.name)}
                keyExtractor={(item, index) => item._id || index.toString()}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item, index }) => (
                  <TouchableOpacity
                    style={[
                      styles.suggestionItemWrapper,
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                    ]}
                    onPress={() => handleSuggestionPress(item)}
                  >
                    <Ionicons name="medkit-outline" size={16} color={colors.button} />
                    <Text
                      style={[styles.suggestionItem, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {!!searchError && (
          <View style={[styles.messageBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="alert-circle-outline" size={20} color="#DC2626" />
            <Text style={{ color: colors.text, flex: 1, marginLeft: 8 }}>{searchError}</Text>
          </View>
        )}

        {!searchResult && !searchError && suggestions.length === 0 && (
          history.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              <Text style={[styles.sectionTitle, { color: colors.label }]}>
                Recent searches
              </Text>
              {[...history].reverse().map((item) => (
                <TouchableOpacity
                  key={item}
                  style={[styles.historyRow, { borderBottomColor: colors.border }]}
                  onPress={() => handleSearch(item)}
                >
                  <Ionicons name="time-outline" size={18} color={colors.placeholder} />
                  <Text style={{ color: colors.text, flex: 1, marginLeft: 10 }} numberOfLines={1}>
                    {item}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.placeholder} />
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={{ color: colors.placeholder, textAlign: "center", marginTop: 24 }}>
              Search a medicine to see its price, composition and cheaper alternatives.
            </Text>
          )
        )}

        {searchResult && (
          <MedicineCard
            data={searchResult}
            colors={colors}
            isPrimary={true}
            onLongPress={() => setSelectedMedicine(searchResult)}
          />
        )}

        {similarMeds.length > 0 && (
          <View style={{ marginTop: 8 }}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Alternatives ({similarMeds.length}) — cheapest first
            </Text>

            {similarMeds.map((med, idx) => (
              <MedicineCard
                key={med._id || idx}
                data={med}
                colors={colors}
                onLongPress={() => setSelectedMedicine(med)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
    >
      <View style={[styles.container]} keyboardShouldPersistTaps="handled">
        {renderHeader()}

        {/* Modal */}
        <Modal
          visible={!!selectedMedicine}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedMedicine(null)}
        >
          <View
            style={[
              styles.modalBackground,
              { backgroundColor: colors.overlay },
            ]}
          >
            <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
              <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {selectedMedicine?.name || "N/A"}
                </Text>
                <Detail
                  label="Manufacturer"
                  value={selectedMedicine?.manufacturer_name}
                  colors={colors}
                />
                <Detail
                  label="Price"
                  value={selectedMedicine?.price ? `Rs ${selectedMedicine.price}` : null}
                  colors={colors}
                />
                <Detail
                  label="Type"
                  value={selectedMedicine?.type}
                  colors={colors}
                />
                <Detail
                  label="Packaging"
                  value={selectedMedicine?.pack_size_label}
                  colors={colors}
                />
                <Detail
                  label="Composition 1"
                  value={selectedMedicine?.short_composition1}
                  colors={colors}
                />
                <Detail
                  label="Composition 2"
                  value={selectedMedicine?.short_composition2}
                  colors={colors}
                />
                <Detail
                  label="Side Effects"
                  value={selectedMedicine?.Consolidated_Side_Effects}
                  colors={colors}
                />
                <Detail
                  label="Use"
                  value={selectedMedicine?.use0}
                  colors={colors}
                />
                <Detail
                  label="Chemical Class"
                  value={selectedMedicine?.["Chemical Class"]}
                  colors={colors}
                />
                <Detail
                  label="Prescription Required"
                  value={selectedMedicine?.["Prescription Required"]}
                  colors={colors}
                />
                <Detail
                  label="Therapeutic Class"
                  value={selectedMedicine?.["Therapeutic Class"]}
                  colors={colors}
                />
                <Detail
                  label="Action Class"
                  value={selectedMedicine?.["Action Class"]}
                  colors={colors}
                />
              </ScrollView>
              <TouchableOpacity
                style={[styles.closeButton, { backgroundColor: colors.button }]}
                onPress={() => setSelectedMedicine(null)}
              >
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}

function MedicineCard({ data, onLongPress, colors, isPrimary = false }) {
  const colorScheme = useColorScheme();
  const textColor = colorScheme === "dark" ? "#c9c9c9ff" : "#7e7e7eff";
  if (!data) return null;
  return (
    <View
      style={[
        styles.resultBox,
        { backgroundColor: colors.card, marginBottom: 12 },
      ]}
    >
      <TouchableOpacity onPress={onLongPress} onLongPress={onLongPress}>
        <View style={styles.resultHeader}>
          <Text
            style={[styles.resultTitle, { color: colors.text }]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {data.name || "N/A"}
          </Text>
          <Text style={[styles.price, { color: colors.price }]}>
            {data.price ? `Rs ${data.price}` : "Price N/A"}
          </Text>
        </View>
        <Text numberOfLines={1} style={{ marginTop: 4 }}>
          <Text style={{ fontWeight: "700", color: colors.label }}>
            Manufacturer:{" "}
          </Text>
          <Text style={{ color: textColor }}>{data.manufacturer_name || "—"}</Text>
        </Text>
        <Text numberOfLines={2} style={{ marginTop: 2 }}>
          <Text style={{ fontWeight: "700", color: colors.label }}>
            Composition:{" "}
          </Text>
          <Text style={{ color: textColor }}>
            {[data.short_composition1, data.short_composition2].filter(Boolean).join(" + ") || "—"}
          </Text>
        </Text>
        <Text style={{ fontSize: 12, marginTop: 6, color: colors.button }}>
          Tap for details
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function Detail({ label, value, colors }) {
  const colorScheme = useColorScheme();
  const textColor = colorScheme === "dark" ? "#c9c9c9ff" : "#7e7e7eff";

  if (!value) return null;
  return (
    <Text style={{ marginBottom: 6 }}>
      <Text style={{ fontWeight: "700", color: colors.label }}>{label}: </Text>
      <Text style={{ color: textColor }}>{value}</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 12 },
  label: { fontSize: 16, fontWeight: "500", marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: "700", marginBottom: 4, marginTop: 4 },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  messageBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  suggestionBox: {
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 8,
    maxHeight: 300,
    overflow: "hidden",
  },
  suggestionItemWrapper: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  suggestionItem: { fontSize: 15, marginLeft: 10, flex: 1 },
  button: {
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 10,
    marginBottom: 8,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  resultBox: {
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.1)",
  },
  resultHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  resultTitle: {
    flex: 1,
    flexShrink: 1,
    fontSize: 18,
    fontWeight: "700",
    marginRight: 10,
  },
  price: { minWidth: 70, textAlign: "right", fontSize: 16, fontWeight: "600" },
  modalBackground: { flex: 1, justifyContent: "center", alignItems: "center" },
  modalCard: { padding: 20, borderRadius: 16, width: "90%", maxHeight: "85%" },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  closeButton: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
  },
  closeText: { color: "#fff", fontWeight: "600" },
});
