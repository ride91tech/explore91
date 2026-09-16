import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter, useFocusEffect } from "expo-router";
import { api, Business } from "@/src/api";
import { colors, radius, spacing, type as tType } from "@/src/theme";

type Dashboard = {
  business_count: number;
  booking_count: number;
  upcoming_count: number;
  revenue_inr: number;
  avg_rating: number;
  businesses: Business[];
  recent_bookings: any[];
};

export default function OwnerOverview() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const { width } = useWindowDimensions();
  const kpiCols = width >= 900 ? 4 : 2;

  const load = useCallback(async () => {
    try {
      const d = await api<Dashboard>("/owner/dashboard", { auth: true });
      setData(d);
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={{ paddingTop: 60, alignItems: "center" }}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.xl }}>
      {/* Greeting */}
      <View>
        <Text style={styles.eyebrow}>DASHBOARD</Text>
        <Text style={styles.h1}>Good to see you.</Text>
        <Text style={styles.h1Sub}>
          Here{"’"}s what{"’"}s happening across your Explore91 businesses today.
        </Text>
      </View>

      {/* Revenue hero + KPI grid */}
      <View style={styles.heroRow}>
        <LinearGradient
          colors={["#111", "#333"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.revenue}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="cash-outline" size={16} color={colors.brandTertiary} />
            <Text style={styles.revenueLabel}>Estimated revenue</Text>
          </View>
          <Text style={styles.revenueValue}>
            ₹{((data?.revenue_inr ?? 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </Text>
          <Text style={styles.revenueHint}>
            Based on completed bookings across all your listings.
          </Text>
        </LinearGradient>

        <View style={[styles.kpiGrid, { gridTemplateColumns: `repeat(${kpiCols}, 1fr)` } as any]}>
          <KPI icon="calendar-outline" label="Bookings" value={data?.booking_count ?? 0} />
          <KPI icon="time-outline" label="Upcoming" value={data?.upcoming_count ?? 0} tint={colors.warning} />
          <KPI icon="star" label="Avg rating" value={(data?.avg_rating ?? 0).toFixed(1)} tint={colors.brandTertiary} />
          <KPI icon="storefront-outline" label="Businesses" value={data?.business_count ?? 0} />
        </View>
      </View>

      {/* Quick actions */}
      <View style={styles.quickRow}>
        <QuickAction
          testID="qa-new-biz"
          icon="add-circle-outline"
          title="List a new business"
          hint="Get discovered by more customers"
          onPress={() => router.push("/owner/new-business")}
        />
        <QuickAction
          testID="qa-bookings"
          icon="calendar-outline"
          title="Manage bookings"
          hint={`${data?.booking_count ?? 0} total across your team`}
          onPress={() => router.push("/owner/bookings")}
        />
        <QuickAction
          testID="qa-analytics"
          icon="stats-chart-outline"
          title="View analytics"
          hint="Bookings by day & business"
          onPress={() => router.push("/owner/analytics")}
        />
      </View>

      {/* My businesses */}
      <View>
        <View style={styles.sectionHead}>
          <Text style={styles.section}>My businesses</Text>
          <Pressable onPress={() => router.push("/owner/businesses")}>
            <Text style={styles.sectionLink}>See all →</Text>
          </Pressable>
        </View>
        {data?.businesses?.length ? (
          <View style={{ gap: spacing.md, marginTop: spacing.md }}>
            {data.businesses.slice(0, 5).map((b) => (
              <Pressable
                key={b.business_id}
                testID={`my-biz-${b.business_id}`}
                onPress={() => router.push(`/business/${b.business_id}`)}
                style={styles.bizRow}
              >
                <Image source={{ uri: b.cover_image }} style={styles.bizImg} contentFit="cover" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.bizName} numberOfLines={1}>{b.name}</Text>
                  <Text style={styles.bizMeta}>{b.category} · {b.city}</Text>
                  <View style={styles.pillRow}>
                    <View
                      style={[
                        styles.pill,
                        (b as any).is_approved ? styles.pillOk : styles.pillPending,
                      ]}
                    >
                      <Text style={styles.pillText}>
                        {(b as any).is_approved ? "Approved" : "Pending review"}
                      </Text>
                    </View>
                    {b.is_featured ? (
                      <View style={[styles.pill, { backgroundColor: colors.brandTertiary }]}>
                        <Text style={[styles.pillText, { color: "#FFF" }]}>Featured</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="storefront-outline" size={40} color={colors.borderStrong} />
            <Text style={styles.emptyTitle}>No businesses yet</Text>
            <Text style={styles.emptySub}>
              Add your first listing to start accepting bookings on Explore91.
            </Text>
            <Pressable
              testID="owner-first-biz"
              onPress={() => router.push("/owner/new-business")}
              style={styles.emptyCta}
            >
              <Text style={styles.emptyCtaText}>Add your first business</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Recent bookings */}
      <View>
        <Text style={styles.section}>Recent bookings</Text>
        {data?.recent_bookings?.length ? (
          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            {data.recent_bookings.slice(0, 5).map((b: any) => (
              <View key={b.booking_id} style={styles.bookingRow}>
                <View style={styles.bookingDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.bookingName}>{b.business_name}</Text>
                  <Text style={styles.bookingMeta}>
                    {b.date} · {b.time} · {b.guests} guest{b.guests === 1 ? "" : "s"}
                  </Text>
                </View>
                <View
                  style={[
                    styles.pill,
                    b.status === "confirmed" ? styles.pillOk : { backgroundColor: colors.error },
                  ]}
                >
                  <Text style={styles.pillText}>{b.status}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyInline}>No bookings yet — they{"’"}ll show up here as soon as customers reserve.</Text>
        )}
      </View>
    </View>
  );
}

function KPI({
  icon,
  label,
  value,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | number;
  tint?: string;
}) {
  return (
    <View style={styles.kpi}>
      <View style={[styles.kpiIcon, tint ? { backgroundColor: `${tint}22` } : null]}>
        <Ionicons name={icon} size={16} color={tint ?? colors.onSurface} />
      </View>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
    </View>
  );
}

function QuickAction({
  icon,
  title,
  hint,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} style={styles.qa}>
      <View style={styles.qaIcon}>
        <Ionicons name={icon} size={20} color={colors.brandPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.qaTitle}>{title}</Text>
        <Text style={styles.qaHint}>{hint}</Text>
      </View>
      <Ionicons name="arrow-forward" size={18} color={colors.onSurfaceTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.onSurfaceTertiary,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  h1: { fontSize: 32, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.8, marginTop: 4 },
  h1Sub: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: 4 },

  heroRow: { flexDirection: "row", gap: spacing.lg, flexWrap: "wrap" as any },
  revenue: {
    minWidth: 260,
    flex: 1,
    borderRadius: radius.lg,
    padding: spacing.xl,
    minHeight: 160,
    justifyContent: "space-between",
  },
  revenueLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: tType.sm,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  revenueValue: { color: "#FFF", fontSize: 40, fontWeight: "800", letterSpacing: -1, marginTop: spacing.md },
  revenueHint: { color: "rgba(255,255,255,0.6)", fontSize: tType.sm, marginTop: spacing.sm },

  kpiGrid: {
    display: "grid",
    gap: 12,
    flex: 1,
    minWidth: 260,
  } as any,
  kpi: {
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    minWidth: 130,
  },
  kpiIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.onSurfaceTertiary,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: spacing.md,
  },
  kpiValue: { fontSize: 26, fontWeight: "800", color: colors.onSurface, marginTop: 4, letterSpacing: -0.6 },

  quickRow: {
    flexDirection: "row",
    gap: spacing.md,
    flexWrap: "wrap" as any,
  },
  qa: {
    flex: 1,
    minWidth: 240,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  qaIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  qaTitle: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface },
  qaHint: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },

  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  section: { fontSize: tType.xl, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.3 },
  sectionLink: { fontSize: tType.sm, color: colors.brandPrimary, fontWeight: "700" },

  bizRow: {
    flexDirection: "row",
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    gap: spacing.md,
    alignItems: "center",
  },
  bizImg: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  bizName: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface },
  bizMeta: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  pillRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  pill: { paddingHorizontal: 8, height: 22, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  pillOk: { backgroundColor: colors.success },
  pillPending: { backgroundColor: colors.warning },
  pillText: { fontSize: 11, fontWeight: "700", color: "#FFF", textTransform: "capitalize" },

  emptyCard: {
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  emptyTitle: { fontSize: tType.xl, fontWeight: "800", color: colors.onSurface, marginTop: 6 },
  emptySub: { fontSize: tType.base, color: colors.onSurfaceTertiary, textAlign: "center" },
  emptyCta: {
    marginTop: spacing.md,
    paddingHorizontal: 20,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCtaText: { color: "#FFF", fontWeight: "700", fontSize: tType.base },
  emptyInline: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: spacing.md },

  bookingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  bookingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  bookingName: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface },
  bookingMeta: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
});
