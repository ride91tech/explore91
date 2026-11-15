// Native map view — used on iOS/Android. Web falls back to MapPane.web.tsx.
import React from "react";
import { View, StyleSheet, Text, Pressable, Platform } from "react-native";
import Constants from "expo-constants";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { Business } from "@/src/api";
import { colors, fonts, radius, spacing, type as tType } from "@/src/theme";
import { MapPane as PlaceList } from "./MapPane.web";
import { ratingText } from "@/src/rating";

/**
 * Android draws this map with Google Maps, whose SDK crashes the whole app
 * when MapView mounts without an API key in the manifest. app.config.js
 * records whether the build had one; without it, show the places as a list.
 */
const MAP_AVAILABLE =
  Platform.OS !== "android" || Constants.expoConfig?.extra?.androidMapsKeyConfigured === true;

type Props = {
  businesses: Business[];
  onSelect?: (b: Business) => void;
  city: string;
};

// Fallbacks for when there are no places to frame. The map used to centre on
// these alone, and any city missing here opened over Goa: the first time a
// new city went live, its map would have shown the wrong state.
const CITY_CENTER: Record<string, { lat: number; lng: number }> = {
  goa: { lat: 15.2993, lng: 74.124 },
  ahmedabad: { lat: 23.0225, lng: 72.5714 },
  pune: { lat: 18.5204, lng: 73.8567 },
};

type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

/** A region that frames every place shown, with a margin so edge pins are
 *  not under the screen border. */
function regionFor(businesses: Business[], city: string): Region {
  const pts = businesses.filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng));
  if (pts.length) {
    const lats = pts.map((b) => b.lat);
    const lngs = pts.map((b) => b.lng);
    const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.05, (maxLat - minLat) * 1.4),
      longitudeDelta: Math.max(0.05, (maxLng - minLng) * 1.4),
    };
  }
  const c = CITY_CENTER[city.toLowerCase()] ?? CITY_CENTER.goa;
  return { latitude: c.lat, longitude: c.lng, latitudeDelta: 0.12, longitudeDelta: 0.12 };
}

export function MapPane({ businesses, onSelect, city }: Props) {
  const [selected, setSelected] = React.useState<Business | null>(null);
  const mapRef = React.useRef<MapView>(null);
  const region = React.useMemo(() => regionFor(businesses, city), [businesses, city]);
  // Re-frame when the city changes, or when places arrive after the map
  // opened empty. Not on every filter change, so a person's own panning and
  // zooming are left alone.
  const hasPlaces = businesses.length > 0;
  React.useEffect(() => {
    mapRef.current?.animateToRegion(region, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, hasPlaces]);
  if (!MAP_AVAILABLE) {
    return (
      <PlaceList
        businesses={businesses}
        onSelect={onSelect}
        city={city}
        notice={`The map isn't available in this version. Showing ${businesses.length} places in ${city}.`}
      />
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
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
            ★ {ratingText(selected)} · {selected.category} · {selected.price_range}
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
