import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { api } from "@/src/api";
import { colors, spacing, type as tType } from "@/src/theme";
import { PageHeader, KPI, Card } from "@/src/components/admin/ui";

type Stats = {
  users: number;
  businesses: number;
  pending_businesses: number;
  bookings: number;
  reviews: number;
  gross_revenue_inr: number;
  platform_fees_inr: number;
  by_city: { city: string; count: number }[];
};

export default function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const s = await api<Stats>("/admin/stats", { auth: true });
      setStats(s);
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <ActivityIndicator color={colors.brandPrimary} />;

  return (
    <View>
      <PageHeader title="Overview" subtitle="Real-time snapshot of the Explore91 platform." />

      <View style={styles.kpiRow}>
        <KPI label="Users" value={stats?.users ?? 0} />
        <KPI label="Businesses" value={stats?.businesses ?? 0} hint={`${stats?.pending_businesses ?? 0} awaiting review`} />
        <KPI label="Bookings" value={stats?.bookings ?? 0} />
        <KPI label="Reviews" value={stats?.reviews ?? 0} />
      </View>

      <View style={[styles.kpiRow, { marginTop: 24 }]}>
        <KPI label="Gross booking value" value={`₹${(stats?.gross_revenue_inr ?? 0).toLocaleString()}`} hint="Demo GMV at ₹5,000 avg ticket" />
        <KPI label="Platform fees (5%)" value={`₹${(stats?.platform_fees_inr ?? 0).toLocaleString()}`} hint="Deposit to ops account weekly" />
      </View>

      <Card style={{ marginTop: 24 }}>
        <Text style={styles.section}>Business inventory by city</Text>
        <View style={{ marginTop: 16, gap: 12 }}>
          {(stats?.by_city ?? []).map((c) => {
            const total = stats!.businesses || 1;
            const pct = (c.count / total) * 100;
            return (
              <View key={c.city}>
                <View style={styles.cityRow}>
                  <Text style={styles.cityName}>{c.city.charAt(0).toUpperCase() + c.city.slice(1)}</Text>
                  <Text style={styles.cityCount}>{c.count} · {pct.toFixed(0)}%</Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${pct}%` }]} />
                </View>
              </View>
            );
          })}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  kpiRow: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  section: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  cityRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  cityName: { fontSize: tType.base, fontWeight: "600", color: colors.onSurface },
  cityCount: { fontSize: tType.sm, color: colors.onSurfaceTertiary },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  barFill: { height: 8, backgroundColor: colors.brandPrimary, borderRadius: 4 },
});
