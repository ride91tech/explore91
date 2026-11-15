/**
 * The city the app is showing.
 *
 * It used to be the signed-in account's home_city, or Goa. Picking a city
 * needed an account, so a signed-out visitor could only ever browse Goa, and
 * a shared city link had nowhere to put its city. Now, in order:
 *
 * 1. A city the person picked (in the picker, or by opening a city link).
 *    Kept on the device, and it wins until they choose "Use my location".
 * 2. The live city nearest the device's approximate location. The position
 *    never leaves the phone; only the resulting city is used.
 * 3. The account's home city, when location is refused or unavailable.
 * 4. Goa.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as Location from "expo-location";
import { api, CityGroupT, CityT } from "@/src/api";
import { useAuth } from "@/src/auth";
import { pickCity, CityPick } from "@/src/nearestCity";
import { storage } from "@/src/utils/storage";

const MANUAL_KEY = "explore91.city.manual";
const DEFAULT = { slug: "goa", name: "Goa" };

export type CitySource = "manual" | "location" | "account" | "default";

type Ctx = {
  slug: string;
  name: string;
  source: CitySource;
  /** Why the city isn't quite where you are, when chosen by location. */
  note: string | null;
  /** True while asking for permission or reading the position. */
  locating: boolean;
  /** Location was refused or could not be read. */
  locationUnavailable: boolean;
  cities: CityT[];
  /** Browse this city until "Use my location". Does not touch the account. */
  chooseCity: (slug: string) => Promise<void>;
  /** Forget a manual choice and follow the device's location again. */
  useMyLocation: () => Promise<void>;
};

const CityCtx = createContext<Ctx>({
  ...DEFAULT,
  source: "default",
  note: null,
  locating: false,
  locationUnavailable: false,
  cities: [],
  chooseCity: async () => {},
  useMyLocation: async () => {},
});

/** Location can hang (no fix indoors, a browser waiting on its prompt). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

async function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") return null;
  // Approximate is plenty to tell Goa from Pune; a cached fix is instant.
  const pos =
    (await Location.getLastKnownPositionAsync().catch(() => null)) ??
    (await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest }).catch(() => null),
      10000
    ));
  return pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : null;
}

/** The live city nearest the device, or null if location isn't available. */
async function locatedCity(cities: CityT[]): Promise<CityPick | null> {
  try {
    const pos = await currentPosition();
    return pos ? pickCity(pos.lat, pos.lng, cities) : null;
  } catch {
    return null;
  }
}

export function CityProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [cities, setCities] = useState<CityT[]>([]);
  const [manual, setManual] = useState<string | null>(null);
  const [manualLoaded, setManualLoaded] = useState(false);
  const [located, setLocated] = useState<CityPick | null>(null);
  const [triedLocation, setTriedLocation] = useState(false);
  const [relocating, setRelocating] = useState(false);
  const [locationUnavailable, setLocationUnavailable] = useState(false);

  useEffect(() => {
    api<CityGroupT[]>("/cities/grouped")
      .then((groups) => setCities(groups.flatMap((g) => g.cities)))
      .catch(() => {});
    storage.getItem<string>(MANUAL_KEY, "").then((s) => {
      setManual(s || null);
      setManualLoaded(true);
    });
  }, []);

  // Follow location once at start, and only if the person hasn't picked a
  // city themselves. Until it settles, screens show the fallback city.
  const autoPending = manualLoaded && !manual && cities.length > 0 && !triedLocation;
  useEffect(() => {
    if (!autoPending) return;
    let cancelled = false;
    locatedCity(cities).then((pick) => {
      if (cancelled) return;
      setLocated(pick);
      setLocationUnavailable(!pick);
      setTriedLocation(true);
    });
    return () => { cancelled = true; };
  }, [autoPending, cities]);

  const chooseCity = useCallback(async (slug: string) => {
    setManual(slug);
    await storage.setItem(MANUAL_KEY, slug);
  }, []);

  const useMyLocation = useCallback(async () => {
    setManual(null);
    setRelocating(true);
    await storage.removeItem(MANUAL_KEY);
    const pick = await locatedCity(cities);
    setLocated(pick);
    setLocationUnavailable(!pick);
    setTriedLocation(true);
    setRelocating(false);
  }, [cities]);

  const locating = autoPending || relocating;

  const homeCity = user?.home_city ?? null;
  const value = useMemo<Ctx>(() => {
    const byslug = (s: string) => cities.find((c) => c.slug === s);
    const base = { locating, locationUnavailable, cities, chooseCity, useMyLocation };
    if (manual) {
      return { ...base, slug: manual, name: byslug(manual)?.name ?? titleCase(manual), source: "manual", note: null };
    }
    if (located) {
      const note = located.comingSoon
        ? `Explore91 isn't in ${located.comingSoon} yet. Showing ${located.name}, the nearest city we cover.`
        : located.far
          ? `We're not in your area yet. Showing ${located.name}, the nearest city we cover.`
          : null;
      return { ...base, slug: located.slug, name: located.name, source: "location", note };
    }
    if (homeCity) {
      const slug = homeCity.toLowerCase();
      return { ...base, slug, name: byslug(slug)?.name ?? homeCity, source: "account", note: null };
    }
    return { ...base, ...DEFAULT, source: "default", note: null };
  }, [manual, located, homeCity, cities, locating, locationUnavailable, chooseCity, useMyLocation]);

  return <CityCtx.Provider value={value}>{children}</CityCtx.Provider>;
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const useCity = () => useContext(CityCtx);
