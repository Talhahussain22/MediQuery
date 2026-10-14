import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  useColorScheme,
  Alert,
  Platform,
  TouchableOpacity,
  Linking,
} from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import config from "../../config";

// Leaflet + OpenStreetMap tiles: unlike Google Maps on Android, needs no API key.
function buildMapHtml(region, places, isDark) {
  const data = JSON.stringify({
    center: [region.latitude, region.longitude],
    places: places.map(p => ({ id: p.id, lat: p.lat, lon: p.lon, name: p.tags.name, address: p.tags.address })),
  }).replace(/</g, "\\u003c");

  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { margin: 0; height: 100%; background: ${isDark ? "#111" : "#eee"}; }
  ${isDark ? ".leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.9); }" : ""}
  .pin { width: 28px; height: 28px; border-radius: 14px; background: #e11d48; border: 2px solid #fff;
         display: flex; align-items: center; justify-content: center; font-size: 14px; box-shadow: 0 1px 4px rgba(0,0,0,.4); }
  .me { width: 14px; height: 14px; border-radius: 7px; background: #2563eb; border: 3px solid #fff; box-shadow: 0 0 0 2px rgba(37,99,235,.35); }
  .popup b { display: block; margin-bottom: 2px; }
</style></head><body><div id="map"></div><script>
  const data = ${data};
  const map = L.map('map', { zoomControl: true }).setView(data.center, 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  L.marker(data.center, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [20, 20] }) }).addTo(map);
  const pinIcon = L.divIcon({ className: '', html: '<div class="pin">\u{1F48A}</div>', iconSize: [28, 28] });
  data.places.forEach(p => {
    const el = document.createElement('div');
    el.className = 'popup';
    const b = document.createElement('b'); b.textContent = p.name;
    const s = document.createElement('span'); s.textContent = p.address;
    el.append(b, s);
    L.marker([p.lat, p.lon], { icon: pinIcon }).addTo(map).bindPopup(el)
      .on('click', () => window.ReactNativeWebView.postMessage(JSON.stringify(p)));
  });
  map.on('click', () => window.ReactNativeWebView.postMessage('null'));
</script></body></html>`;
}

export default function Maps() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  const [region, setRegion] = useState(null);
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState(null);

  const apiAbortRef = useRef(null);
  const debounceRef = useRef(null);


  const mapHtml = useMemo(
    () => (region ? buildMapHtml(region, places, isDark) : null),
    [region, places, isDark],
  );

  useEffect(() => {
    return () => {
      if (apiAbortRef.current) apiAbortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const fetchPrivateAPI = useCallback(async (lat, lon) => {
    // Abort previous API call
    if (apiAbortRef.current) {
      apiAbortRef.current.abort();
    }

    const controller = new AbortController();
    apiAbortRef.current = controller;

    setLoading(true);

    try {
      console.log("📍 Sending coordinates:", { lat, lon });

      const res = await fetch(`${config.API_BASE}/get_medical_shops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: lat, longitude: lon }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
      }

      const json = await res.json();

      const fetchedPlaces = (json || []).map((p, idx) => ({
        id: p.id || idx,
        lat: p.lat,
        lon: p.lon,
        tags: {
          name: p.name || "Medical Shop",
          address: p.address || "Address not available",
        },
      }));

      setPlaces(fetchedPlaces);
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("API error:", err);
        Alert.alert("Server Error", "Could not fetch nearby medical shops.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // --- Get Location and Fetch Data ---
  const getLocationAndFetch = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      try {
        setPlaces([]);

        const { status } = await Location.requestForegroundPermissionsAsync();

        if (status !== "granted") {
          Alert.alert(
            "Permission Required",
            "Location permission is required.",
          );
          return;
        }

        setLocating(true);
        // A fresh high-accuracy GPS fix can hang indoors; a recent cached
        // position or a network fix is plenty for a 10 km pharmacy search.
        const loc =
          (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 })) ||
          (await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Location timed out")), 15000),
            ),
          ]));
        setLocating(false);

        const { latitude, longitude } = loc.coords;

        setRegion({
          latitude,
          longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        });

        fetchPrivateAPI(latitude, longitude);
      } catch (err) {
        setLocating(false);
        console.error("Location error:", err);
        Alert.alert(
          "Location unavailable",
          "Could not get your location. Make sure location is turned on, then tap refresh.",
        );
      }
    }, 500); // ⏱️ debounce delay
  }, [fetchPrivateAPI]);

  useEffect(() => {
    getLocationAndFetch();
  }, []);

  const openInMaps = () => {
    if (!selectedPlace) return;
    const { lat, lon, tags } = selectedPlace;
    const label = tags?.name || "Pharmacy";
    const scheme =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?daddr=${lat},${lon}&dirflg=d`
        : `geo:0,0?q=${lat},${lon}(${label})`;
    Linking.openURL(scheme).catch(() =>
      Alert.alert("Error", "Could not open maps app."),
    );
  };

  return (
    <View style={[styles.container, isDark ? styles.darkBg : styles.lightBg]}>
      <StatusBar style={isDark ? "light" : "dark"} />

      {/* Header */}
      <View style={styles.headerRow}>
        <Text
          style={[
            styles.header,
            isDark ? styles.headerDark : styles.headerLight,
          ]}
        >
          Nearest Medical Shops
        </Text>
        <TouchableOpacity
          onPress={getLocationAndFetch}
          style={[styles.refreshBtn, loading && styles.refreshBtnLoading]}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator
              size="small"
              color={isDark ? "#fff" : "#0EA5A4"}
              style={{ marginRight: 0 }}
            />
          ) : (
            <Ionicons
              name="refresh-circle"
              size={30}
              color={isDark ? "#fff" : "#0EA5A4"}
            />
          )}
        </TouchableOpacity>
      </View>

      {/* Map */}
      {region && (
        <View style={styles.innerContainer}>
          <WebView
            style={styles.map}
            originWhitelist={["*"]}
            source={{ html: mapHtml, baseUrl: "https://mediquery.local/" }}
            onMessage={e => {
              const p = JSON.parse(e.nativeEvent.data);
              setSelectedPlace(p && { lat: p.lat, lon: p.lon, tags: { name: p.name } });
            }}
          />

          {selectedPlace && (
            <TouchableOpacity style={styles.fab} onPress={openInMaps}>
              <Text style={styles.fabText}>
                Directions to {selectedPlace.tags?.name || "Pharmacy"} ➡️
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Loader Overlay */}
      {(loading || locating) && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={isDark ? "#fff" : "#007AFF"} />
          <Text style={{ marginTop: 8, color: isDark ? "#fff" : "#333" }}>
            {locating ? "Finding your location..." : "Loading nearby medical shops..."}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    marginBottom: 12,
  },
  header: { fontSize: 22, fontWeight: "700" },
  innerContainer: { flex: 1, borderRadius: 12, overflow: "hidden" },
  map: { flex: 1 },
  loadingOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.25)",
    zIndex: 20,
  },
  fab: {
    position: "absolute",
    bottom: 20,
    right: 20,
    backgroundColor: "#2563EB",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 30,
    elevation: 4,
  },
  fabText: { color: "#fff", fontWeight: "bold" },
  marker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#e11d48",
    justifyContent: "center",
    alignItems: "center",
  },
  markerText: { color: "#fff", fontWeight: "bold" },
  darkBg: { backgroundColor: "#000000" },
  lightBg: { backgroundColor: "#F0FDF4" },
  headerLight: { color: "#1F2937" },
  headerDark: { color: "#F3F4F6" },
  refreshBtn: { marginRight: 8, paddingVertical: 2 },
  refreshBtnLoading: { opacity: 0.6 },
});
