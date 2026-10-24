/**
 * A category tile, as on explore91.com's home screen.
 *
 * The site presents categories as soft tinted squares with the icon in a white
 * disc, not as outlined pills — it is the first block of colour below the hero
 * and most of what makes the home screen feel warm rather than utilitarian.
 * Pills are still used for filters on Discover, where a compact row that
 * scrolls and toggles is the right affordance; this is for browsing.
 */
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { colors, fonts, radius, spacing, type as tType } from "@/src/theme";
import type { IconName } from "@/src/icons";

/**
 * The tints cycle rather than being mapped per category.
 *
 * A fixed mapping would need an entry for every category the backend returns,
 * and categories are CMS-managed — a new one would fall through to no tint at
 * all. Cycling by index means any number of categories stays colourful, and
 * the order is stable for a given list so tiles do not change colour between
 * renders.
 */
const TINTS = [
  { bg: "#FBEDE9", fg: "#B4552F" }, // terracotta
  { bg: "#EDF3EC", fg: "#3F8439" }, // emerald
  { bg: "#FBF2DF", fg: "#9A7420" }, // gold
  { bg: "#EAEFF4", fg: "#3C5A77" }, // slate blue
  { bg: "#F3EEF6", fg: "#6A4C82" }, // plum
];

export function CategoryTile({
  label,
  icon,
  index,
  onPress,
  testID,
}: {
  label: string;
  icon?: IconName;
  /** Position in the list; picks the tint. */
  index: number;
  onPress?: () => void;
  testID?: string;
}) {
  const tint = TINTS[index % TINTS.length];

  return (
    <Pressable
      testID={testID}
      onPress={() => {
        Haptics.selectionAsync();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: tint.bg },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.disc}>
        <Ionicons name={icon ?? "ellipse-outline"} size={19} color={tint.fg} />
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 96,
    paddingVertical: spacing.lg,
    borderRadius: radius.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  // The site's `.press` affordance: a small downward nudge, no opacity change.
  pressed: { transform: [{ translateY: 2 }] },
  disc: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontFamily: fonts.bodySemi,
    fontSize: tType.sm,
    color: colors.onSurface,
  },
});
