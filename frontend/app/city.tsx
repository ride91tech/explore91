import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth";
import { api, CityT } from "@/src/api";
import { colors, radius, spacing, type as tType } from "@/src/theme";

export default function CityPicker() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [cities, setCities] = useState<CityT[]>([]);
  const width = Dimensions.get("window").width;

  useEffect(() => { api<CityT[]>("/cities").then(setCities).catch(() => {}); }, []);

  const pick = async (slug: string, name: string) => {
    try {
      await api("/auth/me", {
        method: "PATCH", auth: true,
        body: JSON.stringify({ home_city: name }),
      });
      await refresh();
      router.back();
    } catch (e) {
      console.log("city pick", e);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} testID="close-city" style={styles.close}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Choose your city</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + 40 }}>
        {cities.map((c) => {
          const active = user?.home_city === c.name;
          return (
            <Pressable
              key={c.slug}
              testID={`city-${c.slug}`}
              onPress={() => pick(c.slug, c.name)}
              style={[styles.cityCard, { width: width - spacing.lg * 2 }]}
            >
              <Image source={{ uri: c.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
              <LinearGradient
                colors={["rgba(17,17,17,0.15)", "rgba(17,17,17,0.9)"]}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.cityInfo}>
                <Text style={styles.cityName}>{c.name}</Text>
                <Text style={styles.cityTag}>{c.tagline}</Text>
              </View>
              {active ? (
                <View style={styles.currentBadge}>
                  <Ionicons name="checkmark" size={14} color="#FFF" />
                  <Text style={styles.currentText}>Current</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}

        <Text style={styles.comingSoonHead}>Coming soon</Text>
        <View style={styles.comingSoonRow}>
          {["Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Jaipur", "Kolkata"].map((c) => (
            <View key={c} style={styles.soonChip}>
              <Ionicons name="time-outline" size={14} color={colors.onSurfaceTertiary} />
              <Text style={styles.soonText}>{c}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    justifyContent: "space-between",
  },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface },

  cityCard: {
    height: 180,
    borderRadius: radius.lg,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  cityInfo: { padding: spacing.lg },
  cityName: { color: "#FFF", fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  cityTag: { color: "rgba(255,255,255,0.85)", fontSize: tType.base, marginTop: 2 },
  currentBadge: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  currentText: { color: "#FFF", fontSize: 11, fontWeight: "700" },

  comingSoonHead: { marginTop: spacing.xl, fontSize: tType.lg, fontWeight: "700", color: colors.onSurface },
  comingSoonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  soonChip: {
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
  },
  soonText: { fontSize: tType.sm, color: colors.onSurfaceSecondary, fontWeight: "600" },
});
