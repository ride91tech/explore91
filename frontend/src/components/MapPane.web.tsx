// Web fallback — react-native-maps doesn't render on Expo web.
import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Business } from "@/src/api";
import { colors, radius, spacing, type as tType } from "@/src/theme";

type Props = {
  businesses: Business[];
  onSelect?: (b: Business) => void;
  city: string;
};

export function MapPane({ businesses, onSelect, city }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Ionicons name="map-outline" size={24} color={colors.onSurfaceTertiary} />
        <Text style={styles.headerText}>
          Interactive map is available on the mobile app. Showing {businesses.length} places in {city}.
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
        {businesses.map((b) => (
          <Pressable key={b.business_id} onPress={() => onSelect?.(b)} style={styles.row}>
            <View style={styles.pin}><Ionicons name="location" size={16} color="#FFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{b.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>★ {b.rating.toFixed(1)} · {b.address}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  headerText: { flex: 1, fontSize: tType.sm, color: colors.onSurfaceSecondary },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  pin: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface },
  sub: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
});
