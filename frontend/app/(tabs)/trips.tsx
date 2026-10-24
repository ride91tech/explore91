import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/auth";
import { api, Business, InterestPlace, JourneyT } from "@/src/api";
import { BusinessCard } from "@/src/components/BusinessCard";
import { colors, radius, spacing, type as tType } from "@/src/theme";

/**
 * Trips — everything saved, planned and remembered.
 *
 * Mirrors explore91.com's Trips tab: the journey card on top, then Saved
 * Places, Bucket List, Itineraries and Nearby Now. Saved and Bucket List are
 * live; the other two are labelled rather than faked, because there is no
 * backend for them yet and a tile that does nothing when tapped is worse than
 * one that says so.
 */

type Section = "saved" | "bucket";

const SEGMENTS: { key: Section; label: string; blurb: string }[] = [
  { key: "saved", label: "Saved places", blurb: "Bookmarks across every city" },
  { key: "bucket", label: "Bucket list", blurb: "Places you dream of visiting" },
];

export default function Trips() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [section, setSection] = useState<Section>("saved");
  const [saved, setSaved] = useState<Business[]>([]);
  const [bucket, setBucket] = useState<InterestPlace[]>([]);
  const [journey, setJourney] = useState<JourneyT | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // One failing call shouldn't blank the whole tab, so each is settled
    // independently rather than racing in a single Promise.all.
    const [s, b, j] = await Promise.allSettled([
      api<Business[]>("/saved", { auth: true }),
      api<InterestPlace[]>("/places/interest?status=interested", { auth: true }),
      api<JourneyT>("/journey", { auth: true }),
    ]);
    if (s.status === "fulfilled") setSaved(s.value);
    if (b.status === "fulfilled") setBucket(b.value);
    if (j.status === "fulfilled") setJourney(j.value);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const items: Business[] = section === "saved" ? saved : bucket;

  const header = (
    <View>
      <View style={styles.titleBlock}>
        <Text style={styles.kicker}>CURRENTLY EXPLORING</Text>
        <Text style={styles.city}>{user?.home_city ?? "Goa"}</Text>
        <Text style={styles.title}>Your Trips</Text>
        <Text style={styles.sub}>Everything you've saved, planned and remembered.</Text>
      </View>

      <Pressable
        testID="journey-card"
        onPress={() => router.push("/journey")}
        style={styles.journeyCard}
      >
        <Text style={styles.journeyKicker}>EXPLORE91 JOURNEY</Text>
        <Text style={styles.journeyTitle}>One India.{"\n"}Infinite Experiences.</Text>
        <View style={styles.statRow}>
          <Stat value={journey ? journey.cities : "—"} label={journey?.cities === 1 ? "CITY" : "CITIES"} />
          <Stat value={journey ? journey.states : "—"} label={journey?.states === 1 ? "STATE" : "STATES"} />
          <Stat value={journey ? `${journey.india_percent}%` : "—"} label="INDIA" />
        </View>
        {/* Union territories don't count toward the 28 states, so showing
            them separately keeps a Delhi or Leh trip from looking like
            nothing happened. */}
        {journey && journey.union_territories > 0 ? (
          <Text style={styles.utNote}>
            + {journey.union_territories} union{" "}
            {journey.union_territories === 1 ? "territory" : "territories"} of{" "}
            {journey.union_territories_total}
          </Text>
        ) : null}
        <Text style={styles.journeyCta}>Open your journey →</Text>
      </Pressable>

      <View style={styles.segmentRow}>
        {SEGMENTS.map((s) => {
          const active = s.key === section;
          const count = s.key === "saved" ? saved.length : bucket.length;
          return (
            <Pressable
              key={s.key}
              testID={`trips-seg-${s.key}`}
              onPress={() => setSection(s.key)}
              style={[styles.segment, active && styles.segmentActive]}
            >
              <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                {s.label}
              </Text>
              <Text style={[styles.segmentCount, active && styles.segmentCountActive]}>
                {count}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.segmentBlurb}>
        {SEGMENTS.find((s) => s.key === section)?.blurb}
      </Text>
    </View>
  );

  const footer = (
    <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
      <Text style={styles.soonHead}>Coming to Trips</Text>
      <SoonTile
        icon="calendar-outline"
        title="Itineraries"
        blurb="Plan a city day by day."
      />
      <SoonTile
        icon="navigate-outline"
        title="Nearby now"
        blurb="What's around you today."
      />
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.surface }]}>
        <ActivityIndicator color={colors.brandTertiary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={items}
        keyExtractor={(b) => b.business_id}
        contentContainerStyle={{
          paddingTop: insets.top + spacing.md,
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + 120,
          gap: spacing.md,
        }}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons
              name={section === "saved" ? "bookmark-outline" : "sparkles-outline"}
              size={26}
              color={colors.onSurfaceTertiary}
            />
            <Text style={styles.emptyTitle}>
              {section === "saved" ? "Nothing saved yet" : "Your bucket list is empty"}
            </Text>
            <Text style={styles.emptySub}>
              {section === "saved"
                ? "Bookmark a place and it shows up here."
                : "Mark a place Interested and it lands here."}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <BusinessCard
            biz={item}
            variant="row"
            testID={`trip-${item.business_id}`}
            onPress={() => router.push(`/business/${item.business_id}`)}
          />
        )}
      />
    </View>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SoonTile({
  icon,
  title,
  blurb,
}: {
  icon: "calendar-outline" | "navigate-outline";
  title: string;
  blurb: string;
}) {
  return (
    <View style={styles.soonTile}>
      <Ionicons name={icon} size={20} color={colors.onSurfaceTertiary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.soonTitle}>{title}</Text>
        <Text style={styles.soonBlurb}>{blurb}</Text>
      </View>
      <View style={styles.soonPill}>
        <Text style={styles.soonPillText}>Soon</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  titleBlock: { marginBottom: spacing.lg },
  kicker: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: colors.onSurfaceTertiary,
  },
  city: { fontSize: tType.base, fontWeight: "600", color: colors.onSurfaceSecondary, marginTop: 2 },
  title: { fontSize: 30, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.6, marginTop: 6 },
  sub: { fontSize: tType.base, color: colors.onSurfaceSecondary, marginTop: 4 },

  journeyCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  journeyKicker: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: colors.brandTertiary,
  },
  journeyTitle: { fontSize: 22, fontWeight: "800", color: colors.onSurface, lineHeight: 28 },
  statRow: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.sm },
  stat: { gap: 2 },
  statValue: { fontSize: 26, fontWeight: "800", color: colors.onSurface },
  statLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    color: colors.onSurfaceTertiary,
  },
  utNote: { fontSize: tType.sm, color: colors.onSurfaceSecondary },
  journeyCta: { fontSize: tType.base, fontWeight: "700", color: colors.brandTertiary, marginTop: 4 },

  segmentRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xl },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    paddingHorizontal: spacing.md,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
  },
  segmentActive: { backgroundColor: colors.brandTertiary },
  segmentLabel: { fontSize: tType.sm, fontWeight: "700", color: colors.onSurfaceSecondary },
  segmentLabelActive: { color: "#FFF" },
  segmentCount: { fontSize: tType.sm, fontWeight: "700", color: colors.onSurfaceTertiary },
  segmentCountActive: { color: "rgba(255,255,255,0.9)" },
  segmentBlurb: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: spacing.sm },

  empty: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyTitle: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface },
  emptySub: { fontSize: tType.base, color: colors.onSurfaceSecondary, textAlign: "center" },

  soonHead: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: colors.onSurfaceTertiary,
  },
  soonTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
  },
  soonTitle: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface },
  soonBlurb: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  soonPill: {
    paddingHorizontal: 10,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  soonPillText: { fontSize: 10, fontWeight: "700", color: colors.onSurfaceSecondary },
});
