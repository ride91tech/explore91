import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { colors, fonts, radius, spacing, type as tType } from "@/src/theme";

type Analytics = {
  by_day: { date: string; count: number }[];
  by_business: { name: string; bookings: number }[];
  total: number;
};

export default function OwnerAnalytics() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await api<Analytics>("/owner/analytics", { auth: true }));
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const maxDay = Math.max(1, ...(data?.by_day.map((d) => d.count) ?? [1]));
  const maxBiz = Math.max(1, ...(data?.by_business.map((b) => b.bookings) ?? [1]));

  return (
    <View style={{ gap: spacing.xl }}>
      <View>
        <Text style={styles.eyebrow}>YOUR PERFORMANCE</Text>
        <Text style={styles.h1}>Analytics</Text>
        <Text style={styles.sub}>See how your businesses are trending over time.</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} />
      ) : (
        <View style={{ gap: spacing.xl }}>
          <View style={styles.headerCard}>
            <Text style={styles.headerLabel}>Total bookings (all time)</Text>
            <Text style={styles.headerValue}>{data?.total ?? 0}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>Bookings by day</Text>
            <Text style={styles.sectionHint}>Last two weeks</Text>
            {data?.by_day.length ? (
              <View style={styles.chartRow}>
                {data.by_day.map((d) => (
                  <View key={d.date} style={styles.barCol}>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          { height: `${(d.count / maxDay) * 100}%` || "1%" } as any,
                        ]}
                      />
                    </View>
                    <Text style={styles.barLabel}>{d.date.slice(5)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyText}>
                No bookings yet — data will appear once customers reserve.
              </Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>Bookings by business</Text>
            {data?.by_business.length ? (
              <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                {data.by_business.map((b) => (
                  <View key={b.name}>
                    <View style={styles.bizHeader}>
                      <Text style={styles.bizLabel} numberOfLines={1}>{b.name}</Text>
                      <Text style={styles.bizLabel}>{b.bookings}</Text>
                    </View>
                    <View style={styles.hBarTrack}>
                      <View
                        style={[
                          styles.hBarFill,
                          { width: `${(b.bookings / maxBiz) * 100}%` || "2%" } as any,
                        ]}
                      />
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyText}>No businesses yet.</Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 11, fontFamily: fonts.bodyBold, color: colors.onSurfaceTertiary, letterSpacing: 2, textTransform: "uppercase" },
  h1: { fontSize: 28, fontFamily: fonts.display, color: colors.onSurface, letterSpacing: -0.6, marginTop: 4 },
  sub: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: 4 },

  headerCard: {
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  headerLabel: {
    fontSize: 11,
    fontFamily: fonts.bodyBold,
    color: colors.onSurfaceTertiary,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  headerValue: { fontSize: 40, fontFamily: fonts.display, color: colors.onSurface, marginTop: 8, letterSpacing: -1 },

  card: {
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  section: { fontSize: tType.xl, fontFamily: fonts.display, color: colors.onSurface },
  sectionHint: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },

  chartRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    height: 220,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  barCol: { flex: 1, alignItems: "center", gap: 6 },
  barTrack: { flex: 1, width: 14, justifyContent: "flex-end", borderRadius: 6, overflow: "hidden" },
  barFill: { width: 14, backgroundColor: colors.brandPrimary, borderRadius: 6 },
  barLabel: { fontSize: 9, color: colors.onSurfaceTertiary },

  bizHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  bizLabel: { fontSize: tType.sm, color: colors.onSurface, fontFamily: fonts.bodySemi },
  hBarTrack: { height: 10, borderRadius: 5, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  hBarFill: { height: 10, backgroundColor: colors.brandPrimary, borderRadius: 5 },

  emptyText: { color: colors.onSurfaceTertiary, fontSize: tType.base, marginTop: 8 },
});
