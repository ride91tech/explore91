import React, { useCallback, useMemo, useState } from "react";
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
import { useCity } from "@/src/city";
import { api, Business, InterestPlace, JourneyT } from "@/src/api";
import { BusinessCard } from "@/src/components/BusinessCard";
import { JourneyCard } from "@/src/components/JourneyCard";
import { colors, fonts, radius, shadow, spacing, text as tText, type as tType } from "@/src/theme";

/**
 * Trips — everything saved, planned and remembered.
 *
 * Mirrors explore91.com's Trips tab: the journey card on top, then Saved
 * Places, Bucket List, Itineraries and Nearby Now. Saved and Bucket List are
 * live; the other two are labelled rather than faked, because there is no
 * backend for them yet and a tile that does nothing when tapped is worse than
 * one that says so.
 */

type Section = "saved" | "bucket" | "visited";

// The bucket list used to ask for "interested" places only, so a place
// marked Going or Visited was listed nowhere in the app: moving a
// bucket-list place on to Going made it vanish.
const SEGMENTS: { key: Section; label: string; blurb: string }[] = [
  { key: "saved", label: "Saved", blurb: "Bookmarks across every city" },
  { key: "bucket", label: "Bucket list", blurb: "Places you're interested in or going to" },
  { key: "visited", label: "Visited", blurb: "Places you've been" },
];

const EMPTY: Record<Section, { icon: "bookmark-outline" | "sparkles-outline" | "flag-outline"; title: string; sub: string }> = {
  saved: { icon: "bookmark-outline", title: "Nothing saved yet", sub: "Bookmark a place and it shows up here." },
  bucket: { icon: "sparkles-outline", title: "Your bucket list is empty", sub: "Mark a place Interested or Going and it lands here." },
  visited: { icon: "flag-outline", title: "No visited places yet", sub: "Mark a place Visited and it's remembered here." },
};

export default function Trips() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const city = useCity();
  const [section, setSection] = useState<Section>("saved");
  const [saved, setSaved] = useState<Business[]>([]);
  const [flagged, setFlagged] = useState<InterestPlace[]>([]);
  const [journey, setJourney] = useState<JourneyT | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // One failing call shouldn't blank the whole tab, so each is settled
    // independently rather than racing in a single Promise.all.
    const [s, b, j] = await Promise.allSettled([
      api<Business[]>("/saved", { auth: true }),
      api<InterestPlace[]>("/places/interest?limit=100", { auth: true }),
      api<JourneyT>("/journey", { auth: true }),
    ]);
    if (s.status === "fulfilled") setSaved(s.value);
    if (b.status === "fulfilled") setFlagged(b.value);
    if (j.status === "fulfilled") setJourney(j.value);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const bucket = useMemo(() => flagged.filter((p) => p.interest_status !== "visited"), [flagged]);
  const visited = useMemo(() => flagged.filter((p) => p.interest_status === "visited"), [flagged]);
  const lists: Record<Section, (Business | InterestPlace)[]> = { saved, bucket, visited };
  const items = lists[section];

  const header = (
    <View>
      <View style={styles.titleBlock}>
        <Text style={styles.kicker}>Currently exploring</Text>
        <View style={styles.cityRow}>
          <Ionicons name="location" size={14} color={colors.brandPrimary} />
          <Text style={styles.city}>{city.name}</Text>
        </View>
        <Text style={styles.title}>Your Trips</Text>
        <Text style={styles.sub}>Everything you've saved, planned and remembered.</Text>
      </View>

      <JourneyCard
        testID="journey-card"
        journey={journey}
        onPress={() => router.push("/journey")}
      />

      <View style={styles.segmentRow}>
        {SEGMENTS.map((s) => {
          const active = s.key === section;
          const count = lists[s.key].length;
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
        <ActivityIndicator color={colors.brandPrimary} />
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
            <Ionicons name={EMPTY[section].icon} size={26} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyTitle}>{EMPTY[section].title}</Text>
            <Text style={styles.emptySub}>{EMPTY[section].sub}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View>
            <BusinessCard
              biz={item}
              variant="row"
              testID={`trip-${item.business_id}`}
              onPress={() => router.push(`/business/${item.business_id}`)}
            />
            {/* The bucket list mixes two flags, so each row says which. */}
            {section === "bucket" && "interest_status" in item ? (
              <View style={styles.flagPill} pointerEvents="none">
                <Text style={styles.flagPillText}>
                  {item.interest_status === "going" ? "Going" : "Interested"}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      />
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
      <View style={styles.soonIcon}>
        <Ionicons name={icon} size={19} color={colors.brandPrimary} />
      </View>
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
  flagPill: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.brandPrimary,
  },
  flagPillText: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.onBrandPrimary },

  titleBlock: { marginBottom: spacing.lg },
  kicker: tText.eyebrow,
  cityRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  city: {
    fontFamily: fonts.displaySemi,
    fontSize: tType.lg,
    color: colors.onSurface,
  },
  title: {
    ...tText.displayTight,
    fontSize: 30,
    color: colors.onSurface,
    marginTop: spacing.md,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: tType.base,
    color: colors.onSurfaceTertiary,
    marginTop: 4,
  },

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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  segmentLabel: { fontFamily: fonts.bodySemi, fontSize: tType.sm, color: colors.onSurface },
  segmentLabelActive: { color: colors.onBrandPrimary },
  segmentCount: { fontFamily: fonts.bodySemi, fontSize: tType.sm, color: colors.onSurfaceTertiary },
  segmentCountActive: { color: "rgba(255,255,255,0.9)" },
  segmentBlurb: {
    fontFamily: fonts.body,
    fontSize: tType.sm,
    color: colors.onSurfaceTertiary,
    marginTop: spacing.sm,
  },

  empty: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyTitle: { fontFamily: fonts.display, fontSize: tType.lg, color: colors.onSurface },
  emptySub: {
    fontFamily: fonts.body,
    fontSize: tType.base,
    color: colors.onSurfaceTertiary,
    textAlign: "center",
  },

  soonHead: tText.eyebrow,
  soonTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  // Tinted icon square, as on the site's Trips tiles.
  soonIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: "rgba(63,132,57,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  soonTitle: { fontFamily: fonts.displaySemi, fontSize: tType.base, color: colors.onSurface },
  soonBlurb: {
    fontFamily: fonts.body,
    fontSize: tType.sm,
    color: colors.onSurfaceTertiary,
    marginTop: 2,
  },
  soonPill: {
    paddingHorizontal: 10,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  soonPillText: { fontFamily: fonts.bodySemi, fontSize: 10, color: colors.onSurfaceTertiary },
});
