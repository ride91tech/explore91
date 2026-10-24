/**
 * The Discover filter sheet.
 *
 * Deliberately narrower than the website's. The site's sheet offers "Open
 * now", "Near me · 800m" and a vibe picker; none of those can be answered
 * honestly here:
 *
 *   * Open now — `open_hours` is free text ("10:00 AM - 11:00 PM"). Parsing
 *     it would be guesswork, and a filter that is wrong some of the time is
 *     worse than one that is absent.
 *   * Near me — there is no location permission in this app and
 *     expo-location is not installed. Adding a chip that silently does
 *     nothing is the worst of both.
 *   * Vibe — no such field exists on a business.
 *
 * What is here maps to real fields: `rating` and `review_count` for sorting,
 * `price_range`, `offers` and `is_verified` for refining. Everything is
 * applied client-side over the list already fetched, because /businesses
 * takes only city, category, q and featured.
 */
import React from "react";
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { colors, fonts, radius, shadow, spacing, text as tText, type as tType } from "@/src/theme";

export type SortKey = "relevance" | "rating" | "reviews";
export type Filters = {
  sort: SortKey;
  /** "$" … "$$$$", matching Business.price_range. Empty means any. */
  price: string[];
  hasOffer: boolean;
  verifiedOnly: boolean;
};

export const EMPTY_FILTERS: Filters = {
  sort: "relevance",
  price: [],
  hasOffer: false,
  verifiedOnly: false,
};

export function countActive(f: Filters): number {
  return (
    (f.sort !== "relevance" ? 1 : 0) +
    (f.price.length > 0 ? 1 : 0) +
    (f.hasOffer ? 1 : 0) +
    (f.verifiedOnly ? 1 : 0)
  );
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: "relevance", label: "Relevance" },
  { key: "rating", label: "Rating" },
  { key: "reviews", label: "Most reviewed" },
];

const PRICES = ["$", "$$", "$$$", "$$$$"];
/** Shown in rupees; the stored values are dollar signs. */
const PRICE_LABEL: Record<string, string> = {
  $: "₹",
  $$: "₹₹",
  $$$: "₹₹₹",
  $$$$: "₹₹₹₹",
};

export function FilterSheet({
  visible,
  value,
  onChange,
  onClose,
  resultCount,
}: {
  visible: boolean;
  value: Filters;
  onChange: (f: Filters) => void;
  onClose: () => void;
  resultCount: number;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });

  const togglePrice = (p: string) =>
    set({
      price: value.price.includes(p)
        ? value.price.filter((x) => x !== p)
        : [...value.price, p],
    });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.scrim} onPress={onClose}>
        {/* Stops a tap inside the sheet from closing it. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <View style={styles.titleRow}>
            <Text style={styles.title}>Filters</Text>
            <Pressable testID="filters-close" onPress={onClose} style={styles.close} hitSlop={8}>
              <Ionicons name="close" size={18} color={colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.label}>Sort by</Text>
            <View style={styles.row}>
              {SORTS.map((s) => (
                <Pill
                  key={s.key}
                  testID={`sort-${s.key}`}
                  label={s.label}
                  active={value.sort === s.key}
                  onPress={() => set({ sort: s.key })}
                />
              ))}
            </View>

            <Text style={styles.label}>Price</Text>
            <View style={styles.row}>
              {PRICES.map((p) => (
                <Pill
                  key={p}
                  testID={`price-${p.length}`}
                  label={PRICE_LABEL[p]}
                  active={value.price.includes(p)}
                  onPress={() => togglePrice(p)}
                  wide
                />
              ))}
            </View>

            <Text style={styles.label}>Refine</Text>
            <Toggle
              testID="toggle-offer"
              label="Has an offer"
              value={value.hasOffer}
              onChange={(v) => set({ hasOffer: v })}
            />
            <Toggle
              testID="toggle-verified"
              label="Verified businesses"
              value={value.verifiedOnly}
              onChange={(v) => set({ verifiedOnly: v })}
            />
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              testID="filters-clear"
              onPress={() => onChange(EMPTY_FILTERS)}
              style={styles.clear}
            >
              <Text style={styles.clearText}>Clear all</Text>
            </Pressable>
            <Pressable testID="filters-apply" onPress={onClose} style={styles.apply}>
              <Text style={styles.applyText}>
                Show {resultCount} {resultCount === 1 ? "place" : "places"}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Pill({
  label,
  active,
  onPress,
  testID,
  wide,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
  wide?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[styles.pill, wide && styles.pillWide, active && styles.pillActive]}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Toggle({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={() => onChange(!value)}
      style={styles.toggleRow}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.track, value && styles.trackOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(14,22,15,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxxl,
    borderTopRightRadius: radius.xxxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    maxHeight: "82%",
    ...shadow.float,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: fonts.display, fontSize: tType.xl, color: colors.onSurface, letterSpacing: -0.5 },
  close: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },

  label: { ...tText.eyebrow, marginTop: spacing.xl, marginBottom: spacing.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },

  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
  },
  pillWide: { flex: 1, alignItems: "center" },
  pillActive: { backgroundColor: colors.brandPrimary },
  pillText: { fontFamily: fonts.bodySemi, fontSize: tType.sm, color: colors.onSurface },
  pillTextActive: { color: colors.onBrandPrimary },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  toggleLabel: { fontFamily: fonts.bodyMedium, fontSize: tType.base, color: colors.onSurface },
  track: {
    width: 44,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    justifyContent: "center",
  },
  trackOn: { backgroundColor: colors.brandPrimary },
  knob: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    marginLeft: 3,
    ...shadow.card,
  },
  knobOn: { marginLeft: 21 },

  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xl },
  clear: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: "center",
  },
  clearText: { fontFamily: fonts.bodyMedium, fontSize: tType.base, color: colors.onSurface },
  apply: {
    flex: 1.4,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: "center",
  },
  applyText: { fontFamily: fonts.displaySemi, fontSize: tType.base, color: colors.onBrandPrimary },
});
