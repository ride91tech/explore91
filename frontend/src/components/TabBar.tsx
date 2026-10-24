/**
 * The bottom tab bar, matching explore91.com.
 *
 * Two things make it recognisable, and neither is expressible through
 * `screenOptions` alone, which is why this replaces the default bar rather
 * than configuring it:
 *
 *   * The bar is the dark "ink" green, not a white surface. On the site this
 *     is what anchors the warm off-white pages.
 *   * Reels sits in a raised circular button that breaks above the bar's top
 *     edge. That needs the bar to render its own children and not clip them.
 *
 * The raised button is the middle entry of five, so it stays centred as long
 * as the tab order has Reels third. If a tab is ever added or removed, move
 * it rather than hard-coding an index.
 */
import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
// expo-router 57 vendors react-navigation rather than depending on it, and
// publishes no subpath for these types, so this reaches into build/. If an
// upgrade moves it the failure is a compile error here, not a silent one.
import type { BottomTabBarProps } from "expo-router/build/layouts/Tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { colors, fonts, radius, shadow, spacing } from "@/src/theme";
import type { IconName } from "@/src/icons";

/** The raised entry. Matching on name keeps it correct if the order changes. */
const RAISED = "reels";

const ICONS: Record<string, { on: IconName; off: IconName }> = {
  index: { on: "home", off: "home-outline" },
  explore: { on: "compass", off: "compass-outline" },
  reels: { on: "play-circle", off: "play-circle-outline" },
  trips: { on: "bookmarks", off: "bookmarks-outline" },
  profile: { on: "person-circle", off: "person-circle-outline" },
};

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        // The home-indicator inset is added to the bar rather than applied as
        // padding to the row, so the dark colour runs to the screen edge.
        { paddingBottom: Math.max(insets.bottom, spacing.md) },
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label = (options.title ?? route.name) as string;
        const focused = state.index === index;
        const icon = ICONS[route.name] ?? { on: "ellipse", off: "ellipse-outline" };
        const raised = route.name === RAISED;

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            Haptics.selectionAsync();
            navigation.navigate(route.name);
          }
        };

        if (raised) {
          return (
            <Pressable
              key={route.key}
              testID={`tab-${route.name}`}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={label}
              onPress={onPress}
              style={styles.item}
            >
              <View style={[styles.raised, focused && styles.raisedActive]}>
                <Ionicons name={icon.on} size={26} color={colors.onBrandPrimary} />
              </View>
              <Text style={[styles.label, styles.raisedLabel, focused && styles.labelActive]}>
                {label}
              </Text>
            </Pressable>
          );
        }

        return (
          <Pressable
            key={route.key}
            testID={`tab-${route.name}`}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={label}
            onPress={onPress}
            style={styles.item}
          >
            <Ionicons
              name={focused ? icon.on : icon.off}
              size={22}
              color={focused ? colors.onBrandPrimary : INACTIVE}
            />
            <Text style={[styles.label, focused && styles.labelActive]}>{label}</Text>
            {/* The small dot under the active label, as on the site. */}
            <View style={[styles.dot, focused && styles.dotActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** White at 58% — legible on the ink bar without competing with the active tab. */
const INACTIVE = "rgba(255,255,255,0.58)";

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.ink,
    paddingTop: spacing.md,
    // Lets the raised button hang above the bar instead of being clipped.
    overflow: "visible",
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 3,
  },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: INACTIVE,
  },
  labelActive: {
    fontFamily: fonts.bodySemi,
    color: colors.onBrandPrimary,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: "transparent",
  },
  dotActive: {
    backgroundColor: colors.brandPrimary,
  },
  raised: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    // Lifts the circle above the bar's top edge.
    marginTop: -28,
    // A ring in the bar's own colour, so the circle reads as punched through
    // it rather than floating on top.
    borderWidth: 4,
    borderColor: colors.ink,
    ...shadow.reels,
  },
  raisedActive: {
    backgroundColor: colors.brandPrimary,
    ...Platform.select({
      // A slightly stronger glow when it is the active tab.
      default: { shadowOpacity: 0.6 },
    }),
  },
  raisedLabel: {
    marginTop: 1,
  },
});
