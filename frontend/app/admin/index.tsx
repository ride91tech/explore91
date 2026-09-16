import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { colors, spacing, type as tType } from "@/src/theme";
import { PageHeader, KPI, Card, Btn, Loading } from "@/src/components/admin/ui";
import { useAsyncAction } from "@/src/components/admin/feedback";

type Stats = {
  users: number;
  businesses: number;
  pending_businesses: number;
  bookings: number;
  cancelled_bookings: number;
  reviews: number;
  gross_revenue_inr: number;
  platform_fees_inr: number;
  confirmed_revenue_inr: number;
  estimated_revenue_inr: number;
  bookings_without_amount: number;
  by_city: { city: string; count: number }[];
};

const inr = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN")}`;

export default function Overview() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const { run, isBusy } = useAsyncAction();

  const load = useCallback(async () => {
    const s = await api<Stats>("/admin/stats", { auth: true });
    setStats(s);
    setFetchedAt(new Date());
  }, []);

  useEffect(() => {
    run("load", load).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <Loading label="Loading platform stats…" />;

  const pending = stats?.pending_businesses ?? 0;
  const estimated = stats?.estimated_revenue_inr ?? 0;

  return (
    <View>
      <PageHeader
        title="Overview"
        subtitle={
          fetchedAt
            ? `Snapshot taken at ${fetchedAt.toLocaleTimeString()}`
            : "Platform snapshot."
        }
        right={
          <Btn
            testID="refresh-stats"
            tone="secondary"
            label="Refresh"
            busy={isBusy("load")}
            onPress={() => run("load", load)}
          />
        }
      />

      <View style={styles.kpiRow}>
        <KPI label="Users" value={stats?.users ?? 0} />
        <Pressable
          testID="kpi-pending"
          onPress={() => router.push("/admin/businesses?filter=pending" as any)}
          style={{ flex: 1, minWidth: 160 }}
        >
          <KPI
            label="Businesses"
            value={stats?.businesses ?? 0}
            hint={pending > 0 ? `${pending} awaiting review →` : "All reviewed"}
          />
        </Pressable>
        <KPI
          label="Bookings"
          value={stats?.bookings ?? 0}
          hint={
            (stats?.cancelled_bookings ?? 0) > 0
              ? `${stats?.cancelled_bookings} cancelled (excluded)`
              : undefined
          }
        />
        <KPI label="Reviews" value={stats?.reviews ?? 0} />
      </View>

      <View style={[styles.kpiRow, { marginTop: 24 }]}>
        <KPI
          label="Gross booking value"
          value={inr(stats?.gross_revenue_inr ?? 0)}
          hint="Excludes cancelled bookings"
        />
        <KPI
          label="Confirmed revenue"
          value={inr(stats?.confirmed_revenue_inr ?? 0)}
          hint="From priced services & menu items"
        />
        <KPI
          label="Platform fees (5%)"
          value={inr(stats?.platform_fees_inr ?? 0)}
          hint="Deposit to ops account weekly"
        />
      </View>

      {estimated > 0 ? (
        <Card style={{ marginTop: 16, backgroundColor: colors.surfaceSecondary }}>
          <Text style={styles.noticeTitle}>
            {inr(estimated)} of the above is estimated, not booked
          </Text>
          <Text style={styles.noticeBody}>
            Reservations without a priced line item (e.g. a plain table booking) are valued
            from the venue&apos;s price band. Treat the confirmed figure as the reliable one.
          </Text>
        </Card>
      ) : null}

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

  noticeTitle: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface },
  noticeBody: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 6, lineHeight: 20 },
});
