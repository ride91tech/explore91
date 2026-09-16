import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable, TextInput } from "react-native";
import { api } from "@/src/api";
import { colors, spacing, type as tType } from "@/src/theme";
import { PageHeader, Btn, KPI, Card, Table, TableHead, TableRow, Cell, Empty } from "@/src/components/admin/ui";

type Report = {
  days: number;
  city: string | null;
  total_bookings: number;
  total_gmv: number;
  total_fees: number;
  series: { date: string; bookings: number; gmv: number; fees: number }[];
};

const RANGES = [7, 30, 90];

export default function Reports() {
  const [days, setDays] = useState(30);
  const [city, setCity] = useState("");
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ days: String(days) });
      if (city) qs.append("city", city);
      const r = await api<Report>(`/admin/reports/gmv?${qs.toString()}`, { auth: true });
      setData(r);
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  }, [days, city]);

  useEffect(() => { load(); }, [load]);

  const downloadCsv = async () => {
    const base = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
    // Fetch as blob with auth header, then trigger download
    const { loadToken } = await import("@/src/api");
    const token = await loadToken();
    const qs = new URLSearchParams({ days: String(days) });
    if (city) qs.append("city", city);
    const res = await fetch(`${base}/api/admin/reports/gmv/export?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (typeof window !== "undefined") {
      const blob = new Blob([text], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `explore91-gmv-${days}d${city ? "-" + city : ""}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const max = Math.max(1, ...(data?.series.map((s) => s.gmv) ?? [1]));

  return (
    <View>
      <PageHeader
        title="Financial reports"
        subtitle="Gross booking value, platform fees, day-by-day."
        right={
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <TextInput
              placeholder="Filter by city (blank = all)"
              placeholderTextColor={colors.onSurfaceTertiary}
              value={city}
              onChangeText={(s) => setCity(s.toLowerCase())}
              style={styles.input}
            />
            <View style={styles.filters}>
              {RANGES.map((d) => (
                <Pressable key={d} onPress={() => setDays(d)} style={[styles.chip, days === d && styles.chipActive]}>
                  <Text style={[styles.chipText, days === d && styles.chipTextActive]}>{d}d</Text>
                </Pressable>
              ))}
            </View>
            <Btn testID="csv-export" label="Export CSV" onPress={downloadCsv} />
          </View>
        }
      />

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} />
      ) : (
        <>
          <View style={styles.kpiRow}>
            <KPI label="Total bookings" value={data?.total_bookings ?? 0} />
            <KPI label="Gross booking value" value={`₹${(data?.total_gmv ?? 0).toLocaleString()}`} />
            <KPI label="Platform fees (5%)" value={`₹${(data?.total_fees ?? 0).toLocaleString()}`} />
          </View>

          <Card style={{ marginTop: 24 }}>
            <Text style={styles.sectionTitle}>Daily trend</Text>
            <View style={styles.chart}>
              {(data?.series ?? []).map((s) => (
                <View key={s.date} style={styles.barCol}>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { height: `${(s.gmv / max) * 100}%` }]} />
                  </View>
                  <Text style={styles.barLabel}>{s.date.slice(5)}</Text>
                </View>
              ))}
              {(data?.series?.length ?? 0) === 0 ? <Text style={styles.chartEmpty}>No bookings in this range.</Text> : null}
            </View>
          </Card>

          <View style={{ marginTop: 24 }}>
            <Table>
              <TableHead cols={[{ label: "Date", width: 1 }, { label: "Bookings", width: 1 }, { label: "GMV", width: 1 }, { label: "Fees", width: 1 }]} />
              {(data?.series ?? []).length === 0 ? <Empty label="Nothing to report yet." /> : data!.series.map((s) => (
                <TableRow key={s.date}>
                  <Cell width={1}>{s.date}</Cell>
                  <Cell width={1}>{s.bookings}</Cell>
                  <Cell width={1}>{`₹${s.gmv.toLocaleString()}`}</Cell>
                  <Cell width={1}>{`₹${s.fees.toLocaleString()}`}</Cell>
                </TableRow>
              ))}
            </Table>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { width: 240, height: 40, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 16, color: colors.onSurface, fontSize: tType.base },
  filters: { flexDirection: "row", gap: 6, backgroundColor: colors.surface, padding: 4, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chip: { paddingHorizontal: 14, height: 30, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  chipTextActive: { color: "#FFF" },

  kpiRow: { flexDirection: "row", gap: 16, flexWrap: "wrap" },

  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  chart: { marginTop: 16, height: 200, flexDirection: "row", alignItems: "flex-end", gap: 4 },
  barCol: { flex: 1, alignItems: "center", gap: 4 },
  barTrack: { flex: 1, width: 12, borderRadius: 6, backgroundColor: colors.surfaceSecondary, justifyContent: "flex-end", overflow: "hidden" },
  barFill: { width: 12, backgroundColor: colors.brandPrimary, borderRadius: 6 },
  barLabel: { fontSize: 9, color: colors.onSurfaceTertiary },
  chartEmpty: { flex: 1, textAlign: "center", color: colors.onSurfaceTertiary, alignSelf: "center" },
});
