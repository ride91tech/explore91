/**
 * explore91.com/city/<slug>, opened in the app.
 *
 * Shared city links open the installed app, which had no route for them and
 * showed "Unmatched Route". Opening one now switches the city being browsed,
 * on this device only (the account's home city is untouched), and lands on
 * Home. A slug that isn't a live city leaves the current city as it is.
 */
import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCity } from "@/src/city";
import { colors } from "@/src/theme";

export default function CityLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { cities, chooseCity } = useCity();

  useEffect(() => {
    if (!cities.length) return; // wait for the list, to know the slug is real
    const target = cities.find((c) => c.slug === (slug ?? "").toLowerCase() && c.is_live !== false);
    (target ? chooseCity(target.slug) : Promise.resolve()).then(() => router.replace("/(tabs)"));
  }, [cities, slug, chooseCity, router]);

  // If the city list can't load (offline), still get the person somewhere.
  useEffect(() => {
    const t = setTimeout(() => router.replace("/(tabs)"), 6000);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.brandPrimary} />
    </View>
  );
}
