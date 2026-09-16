import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius, spacing, type as tType } from "@/src/theme";
import { Business } from "@/src/api";

type Props = {
  biz: Business;
  variant?: "large" | "medium" | "row";
  onPress?: () => void;
  testID?: string;
};

export function BusinessCard({ biz, variant = "medium", onPress, testID }: Props) {
  if (variant === "row") {
    return (
      <Pressable testID={testID} onPress={onPress} style={styles.row}>
        <Image source={{ uri: biz.cover_image }} style={styles.rowImage} contentFit="cover" />
        <View style={styles.rowInfo}>
          <Text style={styles.rowTitle} numberOfLines={1}>{biz.name}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>{biz.tags.slice(0, 2).join(" · ") || biz.category}</Text>
          <View style={styles.rating}>
            <Ionicons name="star" size={12} color={colors.warning} />
            <Text style={styles.ratingText}>{biz.rating.toFixed(1)}</Text>
            <Text style={styles.rowSub}>  · {biz.price_range} · {biz.address}</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  const h = variant === "large" ? 260 : 180;
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.card, { height: h }]}>
      <Image source={{ uri: biz.cover_image }} style={styles.cardImage} contentFit="cover" />
      <LinearGradient
        colors={["transparent", "rgba(17,17,17,0.85)"]}
        style={styles.cardScrim}
      />
      {biz.is_featured ? (
        <View style={styles.badge}>
          <Ionicons name="sparkles" size={11} color={colors.onBrandTertiary} />
          <Text style={styles.badgeText}>Featured</Text>
        </View>
      ) : null}
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={1}>{biz.name}</Text>
        <View style={styles.cardMeta}>
          <View style={styles.ratingDark}>
            <Ionicons name="star" size={12} color="#FFCE5A" />
            <Text style={styles.ratingDarkText}>{biz.rating.toFixed(1)}</Text>
          </View>
          <Text style={styles.cardSub} numberOfLines={1}>  · {biz.address}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceSecondary,
  },
  cardImage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  cardScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "70%" },
  cardInfo: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.lg },
  cardTitle: { color: "#FFF", fontSize: tType.xl, fontWeight: "700", letterSpacing: -0.3 },
  cardMeta: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  cardSub: { color: "rgba(255,255,255,0.85)", fontSize: tType.sm, flexShrink: 1 },
  ratingDark: { flexDirection: "row", alignItems: "center" },
  ratingDarkText: { color: "#FFF", fontSize: tType.sm, fontWeight: "600", marginLeft: 3 },
  badge: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  badgeText: { color: colors.onBrandTertiary, fontSize: 11, fontWeight: "700" },

  // row
  row: {
    flexDirection: "row",
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  rowImage: { width: 88, height: 88, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  rowInfo: { flex: 1, justifyContent: "center" },
  rowTitle: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface },
  rowSub: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  rating: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  ratingText: { fontSize: tType.sm, fontWeight: "600", marginLeft: 3, color: colors.onSurface },
});
