/**
 * explore91.com/place/<slug>, opened in the app.
 *
 * Shared place links open the installed app (App Links on Android, Universal
 * Links on iOS), but the app had no route for them, so every shared link
 * landed on "Unmatched Route". This turns the slug into the place and swaps
 * itself for the normal place page, so Back goes where the person came from.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, Business } from "@/src/api";
import { colors, fonts, radius, spacing, type as tType } from "@/src/theme";

export default function PlaceLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const [failure, setFailure] = useState<null | "missing" | "error">(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    api<Business>(`/businesses/slug/${encodeURIComponent(slug ?? "")}`)
      .then((b) => router.replace(`/business/${b.business_id}`))
      .catch((e: any) => setFailure(e?.status === 404 ? "missing" : "error"));
  }, [slug, router, attempt]);

  const retry = () => {
    setFailure(null);
    setAttempt((n) => n + 1);
  };

  if (!failure) {
    return (
      <View style={styles.wrap}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }
  const missing = failure === "missing";
  return (
    <View style={[styles.wrap, { padding: spacing.xl, gap: spacing.md }]}>
      <Ionicons
        name={missing ? "compass-outline" : "cloud-offline-outline"}
        size={30}
        color={colors.onSurfaceTertiary}
      />
      <Text style={styles.title} testID="place-link-unavailable">
        {missing ? "This place isn't on Explore91 anymore." : "Couldn't open this place."}
      </Text>
      <Text style={styles.sub}>
        {missing
          ? "It may have been removed, or the link may be out of date."
          : "Check your connection and try again."}
      </Text>
      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
        {!missing ? (
          <Pressable onPress={retry} style={styles.btn}>
            <Text style={styles.btnText}>Try again</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => router.replace("/(tabs)/explore")}
          style={[styles.btn, missing && styles.btnPrimary]}
        >
          <Text style={[styles.btnText, missing && styles.btnTextPrimary]}>Explore nearby</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  title: { fontSize: tType.lg, fontFamily: fonts.bodyBold, color: colors.onSurface, textAlign: "center" },
  sub: { fontSize: tType.base, color: colors.onSurfaceSecondary, textAlign: "center" },
  btn: {
    paddingHorizontal: spacing.lg,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: { backgroundColor: colors.brandPrimary },
  btnText: { fontSize: tType.base, fontFamily: fonts.bodyBold, color: colors.onSurface },
  btnTextPrimary: { color: "#FFF" },
});
