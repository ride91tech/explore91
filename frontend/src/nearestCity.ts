/**
 * Which Explore91 city a position belongs to. Pure, so it can be tested
 * without a device: no React, no location APIs, no imports.
 *
 * The position never leaves the phone; only the chosen city is kept.
 */

export type GeoCity = {
  slug: string;
  name: string;
  lat?: number;
  lng?: number;
  /** Undefined counts as live, matching the city picker. */
  is_live?: boolean;
};

export type CityPick = {
  slug: string;
  name: string;
  /** Set when the nearest city to you exists but isn't live yet. */
  comingSoon?: string;
  /** True when even the nearest live city is a long way off. */
  far: boolean;
};

/** Within this distance a person counts as "in" a city's area. */
export const NEAR_KM = 150;

/** Great-circle distance in kilometres. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * The nearest live city to (lat, lng), plus what to tell the person when it
 * isn't really where they are. Null when no live city has coordinates.
 */
export function pickCity(lat: number, lng: number, cities: GeoCity[]): CityPick | null {
  const located = cities
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
    .map((c) => ({ c, d: distanceKm(lat, lng, c.lat as number, c.lng as number) }))
    .sort((a, b) => a.d - b.d);
  const live = located.filter(({ c }) => c.is_live !== false);
  if (!live.length) return null;

  const nearest = located[0];
  const nearestLive = live[0];
  return {
    slug: nearestLive.c.slug,
    name: nearestLive.c.name,
    comingSoon:
      nearest.c.slug !== nearestLive.c.slug && nearest.d <= NEAR_KM ? nearest.c.name : undefined,
    far: nearestLive.d > NEAR_KM,
  };
}
