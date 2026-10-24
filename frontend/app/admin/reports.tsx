import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { api, loadToken } from "@/src/api";
import { colors, fonts, spacing, type as tType } from "@/src/theme";
import {
  PageHeader, Btn, KPI, Card, Table, TableHead, TableRow, Cell, Empty,
  SearchInput, Loading,
} from "@/src/components/admin/ui";
import { useAsyncAction } from "@/src/components/admin/feedback";

type Row = { date: string; bookings: number; gmv: number; fees: number; confirmed: number };
type Report = {
  days: number;
  city: string | null;
  total_bookings: number;
  total_gmv: number;
  total_fees: number;
  confirmed_gmv: number;
  estimated_gmv: number;
  series: Row[];
};

const RANGES = [7, 30, 90];
const inr = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN")}`;

export default function Reports() {
  const [days, setDays] = useState(30);
  const [city, setCity] = useState("");
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const { run, isBusy } = useAsyncAction();

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ days: String(days) });
    if (city.trim()) qs.append("city", city.trim());
    const r = await api<Report>(`/admin/reports/gmv?${qs}`, { auth: true });
    setData(r);
  }, [days, city]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      run("load", load).finally(() => setLoading(false));
    }, city ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const downloadCsv = () =>
    run("csv", async () => {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
      const token = await loadToken();
      const qs = new URLSearchParams({ days: String(days) });
      if (city.trim()) qs.append("city", city.trim());
      const res = await fetch(`${base}/api/admin/reports/gmv/export?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const text = await res.text();
      if (typeof window !== "undefined") {
        const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `explore91-gmv-${days}d${city ? "-" + city : ""}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    }, "CSV downloaded.");

  const series = data?.series ?? [];
  const max = Math.max(1, ...series.map((s) => s.gmv));
  // At 90 days there isn't room for a label per bar.
  const labelEvery = Math.ceil(series.length / 15) || 1;

  return (
    <View>
      <PageHeader
        title="Financial reports"
        subtitle="Booked value by the day the booking was made."
        right={
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <SearchInput
              testID="city-filter"
              value={city}
              onChangeText={(s) => setCity(s.toLowerCase())}
              placeholder="City (blank = all)"
              width={200}
            />
            <View style={styles.filters}>
              {RANGES.map((d) => (
                <Pressable key={d} testID={`range-${d}`} onPress={() => setDays(d)} style={[styles.chip, days === d && styles.chipActive]}>
                  <Text style={[styles.chipText, days === d && styles.chipTextActive]}>{d}d</Text>
                </Pressable>
              ))}
            </View>
            <Btn testID="csv-export" label="Export CSV" busy={isBusy("csv")} onPress={downloadCsv} />
          </View>
        }
      />

      {loading ? (
        <Loading label="Crunching numbers…" />
      ) : (
        <>
          <View style={styles.kpiRow}>
            <KPI label="Total bookings" value={data?.total_bookings ?? 0} hint="Cancellations excluded" />
            <KPI label="Gross booking value" value={inr(data?.total_gmv ?? 0)} />
            <KPI label="Confirmed" value={inr(data?.confirmed_gmv ?? 0)} hint="Real priced items" />
            <KPI label="Estimated" value={inr(data?.estimated_gmv ?? 0)} hint="From price band" />
            <KPI label="Platform fees (5%)" value={inr(data?.total_fees ?? 0)} />
          </View>

          <Card style={{ marginTop: 24 }}>
            <View style={styles.chartHead}>
              <Text style={styles.sectionTitle}>Daily booked value</Text>
              <Text style={styles.axisMax}>peak {inr(max)}</Text>
            </View>
            {series.length === 0 ? (
              <Text style={styles.chartEmpty}>No bookings in this range.</Text>
            ) : (
              <View style={styles.chart}>
                {series.map((s, i) => {
                  const confirmedPct = s.gmv ? (s.confirmed / s.gmv) * 100 : 0;
                  return (
                    <View key={s.date} style={styles.barCol}>
                      <View style={styles.barTrack}>
                        <View style={[styles.barFill, { height: `${(s.gmv / max) * 100}%` }]}>
                          <View style={[styles.barConfirmed, { height: `${confirmedPct}%` }]} />
                        </View>
                      </View>
                      <Text style={styles.barLabel} numberOfLines={1}>
                        {i % labelEvery === 0 ? s.date.slice(5) : " "}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
            <View style={styles.legend}>
              <View style={[styles.swatch, { backgroundColor: colors.brandPrimary }]} />
              <Text style={styles.legendText}>Confirmed</Text>
              <View style={[styles.swatch, { backgroundColor: colors.surfaceTertiary, marginLeft: 16 }]} />
              <Text style={styles.legendText}>Estimated</Text>
            </View>
          </Card>

          <View style={{ marginTop: 24 }}>
            <Table>
              <TableHead
                cols={[
                  { label: "Date", width: 1 },
                  { label: "Bookings", width: 1 },
                  { label: "Gross", width: 1 },
                  { label: "Confirmed", width: 1 },
                  { label: "Fees", width: 1 },
                ]}
              />
              {series.length === 0 ? (
                <Empty label="Nothing to report in this range." />
              ) : (
                series.map((s) => (
                  <TableRow key={s.date}>
                    <Cell width={1}>{s.date}</Cell>
                    <Cell width={1}>{String(s.bookings)}</Cell>
                    <Cell width={1}>{inr(s.gmv)}</Cell>
                    <Cell width={1}>{inr(s.confirmed)}</Cell>
                    <Cell width={1}>{inr(s.fees)}</Cell>
                  </TableRow>
                ))
              )}
            </Table>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: "row", gap: 6, backgroundColor: colors.surface, padding: 4, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chip: { paddingHorizontal: 14, height: 30, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { fontSize: 12, fontFamily: fonts.bodyBold, color: colors.onSurface },
  chipTextActive: { color: "#FFF" },

  kpiRow: { flexDirection: "row", gap: 16, flexWrap: "wrap" },

  chartHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 16, fontFamily: fonts.display, color: colors.onSurface },
  axisMax: { fontSize: 11, color: colors.onSurfaceTertiary, fontFamily: fonts.bodySemi },
  chart: { marginTop: 16, height: 200, flexDirection: "row", alignItems: "flex-end", gap: 3 },
  barCol: { flex: 1, alignItems: "center", gap: 4, minWidth: 6 },
  barTrack: { flex: 1, width: "100%", maxWidth: 18, borderRadius: 4, backgroundColor: colors.surfaceSecondary, justifyContent: "flex-end", overflow: "hidden" },
  barFill: { width: "100%", backgroundColor: colors.surfaceTertiary, borderRadius: 4, justifyContent: "flex-end" },
  barConfirmed: { width: "100%", backgroundColor: colors.brandPrimary, borderRadius: 4 },
  barLabel: { fontSize: 9, color: colors.onSurfaceTertiary },
  chartEmpty: { color: colors.onSurfaceTertiary, paddingVertical: 40, textAlign: "center", fontSize: tType.base },

  legend: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 16 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: 11, color: colors.onSurfaceTertiary, fontFamily: fonts.bodySemi },
});
