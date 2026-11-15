import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth";
import { useCity } from "@/src/city";
import { api, CityT, CityGroupT } from "@/src/api";
import { colors, fonts, radius, spacing, type as tType } from "@/src/theme";

/** A city is browsable once it has businesses — the home screen is built from
 *  them, so without any it renders empty carousels. `is_live` is absent on
 *  older API versions, and undefined must not hide a city. */
const isLive = (c: CityT) => c.is_live !== false;

export default function CityPicker() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refresh } = useAuth();
  const city = useCity();
  const [groups, setGroups] = useState<CityGroupT[]>([]);
  const width = Dimensions.get("window").width;

  useEffect(() => {
    api<CityGroupT[]>("/cities/grouped").then(setGroups).catch(() => {});
  }, []);

  // Regions keep only the cities you can actually open; everything else
  // collects into one honest "coming soon" list. Both are derived from the
  // same payload, so a city can never appear in both.
  const { liveRegions, comingSoon } = useMemo(() => {
    const live: CityGroupT[] = [];
    const soon: CityT[] = [];
    for (const g of groups) {
      const open = g.cities.filter(isLive);
      if (open.length) live.push({ region: g.region, cities: open });
      soon.push(...g.cities.filter((c) => !isLive(c)));
    }
    soon.sort((a, b) => a.name.localeCompare(b.name));
    return { liveRegions: live, comingSoon: soon };
  }, [groups]);

  const pick = async (slug: string, name: string) => {
    // Anyone can pick a city now; it is remembered on the device and wins
    // over location until "Use my current location". This used to send
    // signed-out visitors to sign in, so they could only ever browse Goa.
    await city.chooseCity(slug);
    leave();
    // A signed-in account still keeps its home city in step, as before.
    if (user) {
      api("/auth/me", { method: "PATCH", auth: true, body: JSON.stringify({ home_city: name }) })
        .then(() => refresh())
        .catch((e) => console.log("city pick", e));
    }
  };

  // Opened directly (a typed URL, a refresh on the web) there is nothing to
  // go back to, and router.back() silently did nothing: close and picking a
  // city both left you stuck here.
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)"));

  const followLocation = async () => {
    await city.useMyLocation();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={leave} testID="close-city" style={styles.close}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Choose your city</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + 40 }}>
        <Pressable
          testID="city-use-location"
          onPress={followLocation}
          disabled={city.locating}
          style={styles.locRow}
        >
          <Ionicons
            name={city.source === "location" ? "navigate" : "navigate-outline"}
            size={20}
            color={colors.brandPrimary}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.locTitle}>
              {city.source === "location" ? `Using your location · ${city.name}` : "Use my current location"}
            </Text>
            {city.locating ? (
              <Text style={styles.locSub}>{"Finding the city you're in…"}</Text>
            ) : city.locationUnavailable && city.source !== "location" ? (
              <Text style={styles.locSub}>
                Location is off or unavailable. Turn it on in your settings, or pick a city below.
              </Text>
            ) : city.note ? (
              <Text style={styles.locSub}>{city.note}</Text>
            ) : null}
          </View>
          {city.locating ? <ActivityIndicator color={colors.brandPrimary} /> : null}
        </Pressable>

        {liveRegions.map((g) => (
          <View key={g.region} style={{ gap: spacing.md }}>
            <Text style={styles.regionHead}>{g.region}</Text>
            {g.cities.map((c) => {
              const active = city.slug === c.slug;
              return (
                <Pressable
                  key={c.slug}
                  testID={`city-${c.slug}`}
                  onPress={() => pick(c.slug, c.name)}
                  style={[styles.cityCard, { width: width - spacing.lg * 2 }]}
                >
                  <Image source={{ uri: c.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  <LinearGradient
                    colors={["rgba(14,22,15,0.15)", "rgba(14,22,15,0.9)"]}
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
          </View>
        ))}

        {comingSoon.length ? (
          <>
            <Text style={styles.comingSoonHead}>Coming soon</Text>
            <View style={styles.comingSoonRow}>
              {comingSoon.map((c) => (
                <View key={c.slug} testID={`city-soon-${c.slug}`} style={styles.soonChip}>
                  <Ionicons name="time-outline" size={14} color={colors.onSurfaceTertiary} />
                  <Text style={styles.soonText}>{c.name}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
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
  title: { fontSize: tType.lg, fontFamily: fonts.display, color: colors.onSurface },

  locRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  locTitle: { fontSize: tType.base, fontFamily: fonts.bodyBold, color: colors.onSurface },
  locSub: { fontSize: tType.sm, color: colors.onSurfaceSecondary, marginTop: 2 },
  regionHead: {
    fontSize: tType.sm,
    fontFamily: fonts.bodyBold,
    color: colors.onSurfaceSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  cityCard: {
    height: 180,
    borderRadius: radius.lg,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  cityInfo: { padding: spacing.lg },
  cityName: { color: "#FFF", fontSize: 28, fontFamily: fonts.display, letterSpacing: -0.6 },
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
  currentText: { color: "#FFF", fontSize: 11, fontFamily: fonts.bodyBold },

  comingSoonHead: { marginTop: spacing.xl, fontSize: tType.lg, fontFamily: fonts.bodyBold, color: colors.onSurface },
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
  soonText: { fontSize: tType.sm, color: colors.onSurfaceSecondary, fontFamily: fonts.bodySemi },
});
