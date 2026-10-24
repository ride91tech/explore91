/**
 * A place as a grid tile — the two-column card on Discover.
 *
 * BusinessCard's existing variants are all full-width (a row, or a large
 * photo card), and squeezing one into half a column leaves the text cramped
 * against the image. This is its own component rather than a fourth variant
 * because the proportions, the overlaid category badge and the truncation all
 * differ, and threading that through the existing branch would make it harder
 * to read than keeping them apart.
 */
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import type { Business } from "@/src/api";
import { colors, fonts, radius, shadow, spacing, text as tText, type as tType } from "@/src/theme";

export function PlaceTile({
  biz,
  onPress,
  testID,
}: {
  biz: Business;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.imageWrap}>
        <Image
          source={{ uri: biz.cover_image }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={180}
        />
        {biz.category ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText} numberOfLines={1}>
              {biz.category}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {biz.name}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {biz.tags?.slice(0, 2).join(" · ") || biz.address}
        </Text>
        <View style={styles.ratingRow}>
          <Ionicons name="star" size={11} color={colors.brandTertiary} />
          <Text style={styles.rating}>
            {biz.rating?.toFixed(1) ?? "—"}
            {biz.review_count ? ` · ${biz.review_count.toLocaleString("en-IN")}` : ""}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    overflow: "hidden",
    ...shadow.card,
  },
  pressed: { transform: [{ translateY: 2 }] },
  imageWrap: {
    height: 118,
    backgroundColor: colors.surfaceSecondary,
  },
  badge: {
    position: "absolute",
    left: spacing.sm,
    top: spacing.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: "rgba(14,22,15,0.62)",
  },
  badgeText: {
    ...tText.eyebrow,
    fontSize: 9,
    letterSpacing: 1.1,
    color: "#FFF",
  },
  body: { padding: 10 },
  name: {
    fontFamily: fonts.displaySemi,
    fontSize: tType.base,
    color: colors.onSurface,
    letterSpacing: -0.2,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.onSurfaceTertiary,
    marginTop: 1,
  },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5 },
  rating: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.onSurfaceTertiary,
  },
});
