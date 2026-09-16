import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/auth";
import { api, Business } from "@/src/api";
import { colors, radius, spacing, type as tType } from "@/src/theme";

type Stop = { time: string; note: string; business?: Business };
type DayT = { day: number; theme: string; stops: Stop[] };
type Itinerary = { title: string; summary: string; days: DayT[] };

const INTERESTS = ["Food", "Nightlife", "Culture", "Wellness", "Adventure", "Shopping", "Beach", "Family"];

export default function ItineraryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [days, setDays] = useState(2);
  const [interests, setInterests] = useState<string[]>([]);
  const [itin, setItin] = useState<Itinerary | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = (i: string) => {
    setInterests((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]);
  };

  const submit = async () => {
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const r = await api<Itinerary>("/ai/itinerary", {
        method: "POST", auth: true,
        body: JSON.stringify({
          city: (user?.home_city ?? "Goa").toLowerCase(),
          days,
          interests: interests.map((i) => i.toLowerCase()),
        }),
      });
      setItin(r);
    } catch (e) { console.log("itin", e); }
    finally { setLoading(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="itin-close" onPress={() => router.back()} style={styles.close}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Smart itinerary</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
        {itin === null ? (
          <>
            <Text style={styles.h1}>Let me plan your trip to {user?.home_city ?? "your city"}.</Text>
            <Text style={styles.sub}>Pick your interests and I'll craft a day-by-day itinerary.</Text>

            <Text style={styles.sectionLabel}>Days</Text>
            <View style={styles.row}>
              {[1, 2, 3, 4, 5].map((d) => (
                <Pressable
                  key={d}
                  testID={`itin-day-${d}`}
                  onPress={() => setDays(d)}
                  style={[styles.chip, days === d && styles.chipActive]}
                >
                  <Text style={[styles.chipText, days === d && styles.chipTextActive]}>{d} day{d > 1 ? "s" : ""}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Interests</Text>
            <View style={styles.row}>
              {INTERESTS.map((i) => (
                <Pressable
                  key={i}
                  testID={`itin-int-${i.toLowerCase()}`}
                  onPress={() => toggle(i)}
                  style={[styles.chip, interests.includes(i) && styles.chipActive]}
                >
                  <Text style={[styles.chipText, interests.includes(i) && styles.chipTextActive]}>{i}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              testID="itin-generate"
              disabled={loading}
              onPress={submit}
              style={styles.cta}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="sparkles" size={18} color="#FFF" />
                  <Text style={styles.ctaText}>Generate itinerary</Text>
                </>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.pickHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.h1}>{itin.title}</Text>
                <Text style={styles.sub}>{itin.summary}</Text>
              </View>
              <Pressable testID="itin-reset" onPress={() => setItin(null)}>
                <Text style={styles.reset}>Refine</Text>
              </Pressable>
            </View>

            {itin.days.map((d) => (
              <View key={d.day} style={{ marginTop: spacing.xl }}>
                <View style={styles.dayBadge}>
                  <Text style={styles.dayText}>Day {d.day}</Text>
                  <Text style={styles.dayTheme}>{d.theme}</Text>
                </View>
                <View style={styles.timeline}>
                  {d.stops.map((s, i) => (
                    <Pressable
                      key={i}
                      testID={`itin-stop-${d.day}-${i}`}
                      onPress={() => s.business && router.push(`/business/${s.business.business_id}`)}
                      style={styles.stopRow}
                    >
                      <View style={styles.timeCol}>
                        <Text style={styles.timeText}>{s.time}</Text>
                        <View style={styles.dot} />
                        {i < d.stops.length - 1 ? <View style={styles.line} /> : null}
                      </View>
                      <View style={styles.stopCard}>
                        {s.business ? (
                          <>
                            <Image source={{ uri: s.business.cover_image }} style={styles.stopImg} contentFit="cover" />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.stopName} numberOfLines={1}>{s.business.name}</Text>
                              <Text style={styles.stopMeta} numberOfLines={1}>
                                ★ {s.business.rating.toFixed(1)} · {s.business.category}
                              </Text>
                              <Text style={styles.stopNote} numberOfLines={2}>{s.note}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
                          </>
                        ) : (
                          <Text style={styles.stopNote}>{s.note}</Text>
                        )}
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, justifyContent: "space-between" },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface },

  h1: { fontSize: 26, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.6 },
  sub: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: spacing.sm, lineHeight: 22 },
  sectionLabel: { fontSize: tType.sm, fontWeight: "700", color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, height: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: tType.base, fontWeight: "600", color: colors.onSurface },
  chipTextActive: { color: "#FFF" },

  cta: { marginTop: spacing.xxl, height: 54, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  ctaText: { color: "#FFF", fontSize: tType.lg, fontWeight: "700" },
  pickHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  reset: { color: colors.brandPrimary, fontWeight: "700", fontSize: tType.base },

  dayBadge: { flexDirection: "row", alignItems: "baseline", gap: 10, marginBottom: spacing.md },
  dayText: { fontSize: tType.xl, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.4 },
  dayTheme: { fontSize: tType.base, color: colors.onSurfaceTertiary },

  timeline: { paddingLeft: 4 },
  stopRow: { flexDirection: "row", gap: spacing.md },
  timeCol: { width: 62, alignItems: "flex-start", paddingTop: 14 },
  timeText: { fontSize: tType.sm, fontWeight: "700", color: colors.onSurface, position: "absolute", top: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brandPrimary, marginTop: 22 },
  line: { width: 2, flex: 1, backgroundColor: colors.divider, marginLeft: 4, marginTop: 4 },
  stopCard: {
    flex: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 78,
  },
  stopImg: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  stopName: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface },
  stopMeta: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  stopNote: { fontSize: tType.sm, color: colors.onSurfaceSecondary, marginTop: 4, lineHeight: 18 },
});
