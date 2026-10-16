import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth";
import { api, CityT, JourneyT } from "@/src/api";
import { colors, radius, spacing, type as tType } from "@/src/theme";

/**
 * Your Journey — the private record explore91.com leads with.
 *
 * The site is explicit about the tone: "no leaderboards, no noise", and the
 * map "starts to fill in on its own" as you open reels and get directions.
 * So this screen reports, it doesn't gamify: no streaks, no ranks, no nudges.
 *
 * States and union territories are shown apart because coverage is measured
 * against India's 28 states — a Delhi or Leh trip moves the city count and the
 * territory count without moving the percentage, and saying so is better than
 * quietly folding UTs in to make the number look busier.
 */
export default function Journey() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [journey, setJourney] = useState<JourneyT | null>(null);
  const [cityTotal, setCityTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [j, cities] = await Promise.all([
        api<JourneyT>("/journey", { auth: true }),
        api<CityT[]>("/cities"),
      ]);
      setJourney(j);
      setCityTotal(cities.length);
    } catch (e: any) {
      setError(
        e?.status === 401
          ? "Sign in to keep a record of where you've been."
          : "Couldn't load your journey just now."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visited = journey?.visited ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} testID="close-journey" style={styles.close}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Your Journey</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandTertiary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="map-outline" size={28} color={colors.onSurfaceTertiary} />
          <Text style={styles.emptyTitle}>{error}</Text>
          {/* 401 is the common case here, so offer the way forward. */}
          <Pressable onPress={() => router.push("/login")} style={styles.cta}>
            <Text style={styles.ctaText}>Sign in</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: spacing.lg,
            paddingBottom: insets.bottom + 60,
            gap: spacing.lg,
          }}
        >
          <View>
            <Text style={styles.city}>{user?.home_city ?? "Goa"}</Text>
            <Text style={styles.counts}>
              {journey?.cities ?? 0} of {cityTotal ?? "—"} cities ·{" "}
              {journey?.states ?? 0} of {journey?.states_total ?? 28} states
            </Text>
          </View>

          <View style={styles.progressCard}>
            <Text style={styles.percent}>{journey?.india_percent ?? 0}%</Text>
            <Text style={styles.percentLabel}>of India</Text>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { width: `${Math.min(100, journey?.india_percent ?? 0)}%` },
                ]}
              />
            </View>
            {journey && journey.union_territories > 0 ? (
              <Text style={styles.utNote}>
                Plus {journey.union_territories} of{" "}
                {journey.union_territories_total} union territories, which sit
                outside the 28 states.
              </Text>
            ) : null}
          </View>

          {visited.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyHead}>Your Journey begins here.</Text>
              <Text style={styles.emptySub}>
                Open a reel, get directions, and the map will start to fill in on
                its own.
              </Text>
              <Pressable
                testID="journey-open-reels"
                onPress={() => router.push("/(tabs)/reels")}
                style={styles.cta}
              >
                <Text style={styles.ctaText}>Open Reels</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: spacing.sm }}>
              <Text style={styles.sectionHead}>WHERE YOU'VE BEEN</Text>
              {visited.map((v) => (
                <View key={v.city_slug} style={styles.row} testID={`visited-${v.city_slug}`}>
                  <Ionicons name="location" size={16} color={colors.brandTertiary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowCity}>{v.name}</Text>
                    <Text style={styles.rowState}>{v.state}</Text>
                  </View>
                  <Text style={styles.rowDate}>
                    {new Date(v.visited_at).toLocaleDateString(undefined, {
                      month: "short",
                      year: "numeric",
                    })}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.footnote}>
            A private record. No leaderboards, no noise.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },

  city: { fontSize: 30, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.6 },
  counts: { fontSize: tType.base, color: colors.onSurfaceSecondary, marginTop: 4 },

  progressCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.lg,
    gap: 6,
  },
  percent: { fontSize: 44, fontWeight: "800", color: colors.onSurface, letterSpacing: -1.5 },
  percentLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: colors.onSurfaceTertiary,
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceTertiary,
    overflow: "hidden",
    marginTop: spacing.sm,
  },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.brandTertiary },
  utNote: { fontSize: tType.sm, color: colors.onSurfaceSecondary, marginTop: spacing.sm, lineHeight: 19 },

  emptyBlock: { gap: spacing.sm, alignItems: "flex-start" },
  emptyHead: { fontSize: 22, fontWeight: "800", color: colors.onSurface },
  emptySub: { fontSize: tType.base, color: colors.onSurfaceSecondary, lineHeight: 22 },
  emptyTitle: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface, textAlign: "center" },

  cta: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { color: "#FFF", fontWeight: "700", fontSize: tType.base },

  sectionHead: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: colors.onSurfaceTertiary,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
  },
  rowCity: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface },
  rowState: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  rowDate: { fontSize: tType.sm, color: colors.onSurfaceSecondary },

  footnote: {
    fontSize: tType.sm,
    color: colors.onSurfaceTertiary,
    textAlign: "center",
    marginTop: spacing.md,
  },
});
