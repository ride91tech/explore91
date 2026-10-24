// Native map view — used on iOS/Android. Web falls back to MapView.web.tsx.
import React from "react";
import { View, StyleSheet, Text, Pressable } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { Business } from "@/src/api";
import { colors, fonts, radius, spacing, type as tType } from "@/src/theme";

type Props = {
  businesses: Business[];
  onSelect?: (b: Business) => void;
  city: string;
};

const CITY_CENTER: Record<string, { lat: number; lng: number }> = {
  goa: { lat: 15.2993, lng: 74.124 },
  ahmedabad: { lat: 23.0225, lng: 72.5714 },
  pune: { lat: 18.5204, lng: 73.8567 },
};

export function MapPane({ businesses, onSelect, city }: Props) {
  const center = CITY_CENTER[city.toLowerCase()] ?? { lat: 15.3, lng: 74.1 };
  const [selected, setSelected] = React.useState<Business | null>(null);
  return (
    <View style={{ flex: 1 }}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: center.lat,
          longitude: center.lng,
          latitudeDelta: 0.12,
          longitudeDelta: 0.12,
        }}
      >
        {businesses.map((b) => (
          <Marker
            key={b.business_id}
            coordinate={{ latitude: b.lat, longitude: b.lng }}
            onPress={() => setSelected(b)}
            pinColor={colors.brandPrimary}
          />
        ))}
      </MapView>
      {selected ? (
        <Pressable style={styles.card} onPress={() => onSelect?.(selected)}>
          <Text style={styles.title} numberOfLines={1}>{selected.name}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            ★ {selected.rating.toFixed(1)} · {selected.category} · {selected.price_range}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>{selected.address}</Text>
          <Text style={styles.cta}>Tap to view details ›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  title: { fontSize: tType.lg, fontFamily: fonts.display, color: colors.onSurface },
  sub: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  cta: { marginTop: spacing.sm, color: colors.brandPrimary, fontFamily: fonts.bodyBold, fontSize: tType.sm },
});
