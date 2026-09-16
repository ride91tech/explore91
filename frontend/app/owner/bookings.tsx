import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useFocusEffect } from "expo-router";
import { api } from "@/src/api";
import { colors, radius, spacing, type as tType } from "@/src/theme";

type OwnerBooking = {
  booking_id: string;
  business_id: string;
  business_name: string;
  business_image: string;
  date: string;
  time: string;
  guests: number;
  status: string;
  service_name?: string;
  user_id: string;
  notes?: string;
};

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "confirmed", label: "Confirmed" },
  { key: "cancelled", label: "Cancelled" },
];

export default function OwnerBookings() {
  const [items, setItems] = useState<OwnerBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    try {
      setItems(await api<OwnerBooking[]>("/owner/bookings", { auth: true }));
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.status === filter)),
    [items, filter]
  );

  const grouped = useMemo(() => {
    const buckets: Record<string, OwnerBooking[]> = {};
    for (const b of filtered) {
      const key = b.date || "TBD";
      (buckets[key] ||= []).push(b);
    }
    return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <View style={{ gap: spacing.xl }}>
      <View>
        <Text style={styles.eyebrow}>YOUR CALENDAR</Text>
        <Text style={styles.h1}>Bookings</Text>
        <Text style={styles.sub}>Every reservation across your businesses, in one view.</Text>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count = f.key === "all" ? items.length : items.filter((i) => i.status === f.key).length;
          return (
            <Pressable
              key={f.key}
              testID={`filter-${f.key}`}
              onPress={() => setFilter(f.key)}
              style={[styles.filter, active && styles.filterActive]}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {f.label} <Text style={styles.filterCount}>· {count}</Text>
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} />
      ) : filtered.length ? (
        <View style={{ gap: spacing.xl }}>
          {grouped.map(([date, list]) => (
            <View key={date}>
              <Text style={styles.dayLabel}>{formatDay(date)}</Text>
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                {list.map((b) => (
                  <View key={b.booking_id} testID={`b-${b.booking_id}`} style={styles.row}>
                    <Image source={{ uri: b.business_image }} style={styles.img} contentFit="cover" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>{b.business_name}</Text>
                      <Text style={styles.meta}>
                        {b.time} · {b.guests} guest{b.guests === 1 ? "" : "s"}
                        {b.service_name ? ` · ${b.service_name}` : ""}
                      </Text>
                      {b.notes ? (
                        <Text style={styles.notes} numberOfLines={2}>"{b.notes}"</Text>
                      ) : null}
                    </View>
                    <View
                      style={[
                        styles.badge,
                        b.status === "confirmed" ? { backgroundColor: colors.success } : { backgroundColor: colors.error },
                      ]}
                    >
                      <Text style={styles.badgeText}>{b.status}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={40} color={colors.borderStrong} />
          <Text style={styles.emptyTitle}>No bookings to show</Text>
          <Text style={styles.emptySub}>Once customers reserve at your businesses, they will appear here.</Text>
        </View>
      )}
    </View>
  );
}

function formatDay(iso: string) {
  // iso can be YYYY-MM-DD; if not parseable just show as-is.
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 11, fontWeight: "800", color: colors.onSurfaceTertiary, letterSpacing: 2, textTransform: "uppercase" },
  h1: { fontSize: 28, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.6, marginTop: 4 },
  sub: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: 4 },

  filterRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" as any },
  filter: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  filterActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterText: { fontSize: tType.sm, color: colors.onSurface, fontWeight: "600" },
  filterTextActive: { color: "#FFF" },
  filterCount: { color: colors.onSurfaceTertiary, fontWeight: "500" },

  dayLabel: { fontSize: 11, fontWeight: "800", color: colors.onSurfaceTertiary, letterSpacing: 1, textTransform: "uppercase" },

  row: {
    flexDirection: "row",
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    gap: spacing.md,
    alignItems: "center",
  },
  img: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  name: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface },
  meta: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  notes: { fontSize: tType.sm, color: colors.onSurfaceSecondary, marginTop: 6, fontStyle: "italic" },

  badge: { paddingHorizontal: 10, height: 24, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#FFF", fontSize: 11, fontWeight: "700", textTransform: "capitalize" },

  empty: {
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: tType.xl, fontWeight: "800", color: colors.onSurface, marginTop: 6 },
  emptySub: { fontSize: tType.base, color: colors.onSurfaceTertiary, textAlign: "center" },
});
