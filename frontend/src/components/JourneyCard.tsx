/**
 * The Explore91 Journey card.
 *
 * Shared by Trips and Profile, which both lead with it on the website. One
 * component rather than two copies because the gradient, the stat row and the
 * completion bar all have to agree — the card is the app's single most
 * branded surface and two drifting versions would be obvious.
 *
 * Every number here comes from /journey. Nothing is estimated.
 */
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import type { JourneyT } from "@/src/api";
import {
  colors,
  fonts,
  radius,
  shadow,
  spacing,
  text as tText,
  type as tType,
} from "@/src/theme";

export function JourneyCard({
  journey,
  onPress,
  testID,
}: {
  journey: JourneyT | null;
  onPress?: () => void;
  testID?: string;
}) {
  // india_percent is already truncated server-side against India's 28 states.
  const pct = journey?.india_percent ?? 0;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.wrap, pressed && { transform: [{ translateY: 2 }] }]}
    >
      <LinearGradient
        colors={[colors.brandPrimary, colors.brandSecondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {/* Watermark. Behind everything, clipped by the card's radius. */}
        <View pointerEvents="none" style={styles.watermark}>
          <Ionicons name="trophy" size={150} color="rgba(255,255,255,0.10)" />
        </View>

        <View style={styles.topRow}>
          <Ionicons name="trophy" size={13} color={colors.brandTertiary} />
          <Text style={styles.kicker}>Explore91 Journey</Text>
        </View>

        <Text style={styles.title}>One India.{"\n"}Infinite Experiences.</Text>

        <View style={styles.statRow}>
          <Stat
            value={journey ? journey.cities : "—"}
            label={journey?.cities === 1 ? "City" : "Cities"}
          />
          <Stat
            value={journey ? journey.states : "—"}
            label={journey?.states === 1 ? "State" : "States"}
          />
          <Stat value={journey ? `${pct}%` : "—"} label="India" gold />
        </View>

        {/* Completion bar. The denominator is India's 28 states, which is why
            union territories are reported separately below rather than being
            folded in and quietly inflating this. */}
        <View style={styles.barBlock}>
          <View style={styles.barLabels}>
            <Text style={styles.barLabel}>India completion</Text>
            <Text style={styles.barLabel}>
              {journey ? `${journey.states} / ${journey.states_total}` : "—"}
            </Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, Math.max(pct, pct > 0 ? 2 : 0))}%` }]} />
          </View>
        </View>

        {journey && journey.union_territories > 0 ? (
          <Text style={styles.utNote}>
            + {journey.union_territories} union{" "}
            {journey.union_territories === 1 ? "territory" : "territories"} of{" "}
            {journey.union_territories_total}
          </Text>
        ) : null}

        {onPress ? <Text style={styles.cta}>Open your journey →</Text> : null}
      </LinearGradient>
    </Pressable>
  );
}

function Stat({
  value,
  label,
  gold,
}: {
  value: number | string;
  label: string;
  gold?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, gold && { color: colors.brandTertiary }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.xxxl, ...shadow.card },
  card: {
    borderRadius: radius.xxxl,
    padding: spacing.lg,
    overflow: "hidden",
  },
  watermark: { position: "absolute", right: -28, bottom: -34 },

  topRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  kicker: { ...tText.eyebrow, color: "rgba(255,255,255,0.9)" },

  title: {
    ...tText.displayLoose,
    fontSize: 22,
    color: "#FFF",
    marginTop: spacing.sm,
    lineHeight: 27,
  },

  statRow: { flexDirection: "row", marginTop: spacing.lg },
  stat: { flex: 1, alignItems: "center" },
  statValue: { fontFamily: fonts.display, fontSize: tType.xxl, color: "#FFF" },
  statLabel: {
    ...tText.eyebrow,
    fontSize: 9.5,
    letterSpacing: 1.1,
    color: "rgba(255,255,255,0.8)",
    marginTop: 2,
  },

  barBlock: { marginTop: spacing.lg },
  barLabels: { flexDirection: "row", justifyContent: "space-between" },
  barLabel: {
    ...tText.eyebrow,
    fontSize: 9.5,
    letterSpacing: 1.1,
    color: "rgba(255,255,255,0.8)",
  },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginTop: 6,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.brandTertiary },

  utNote: {
    fontFamily: fonts.body,
    fontSize: tType.sm,
    color: "rgba(255,255,255,0.85)",
    marginTop: spacing.md,
  },
  cta: {
    fontFamily: fonts.bodySemi,
    fontSize: tType.sm,
    color: "#FFF",
    marginTop: spacing.md,
  },
});
