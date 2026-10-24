import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  FlatList,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/src/auth";
import { api, Business, CategoryT, CityT } from "@/src/api";
import { PlaceTile } from "@/src/components/PlaceTile";
import { MapPane } from "@/src/components/MapPane";
import {
  FilterSheet,
  EMPTY_FILTERS,
  countActive,
  type Filters,
} from "@/src/components/FilterSheet";
import {
  colors,
  fonts,
  radius,
  shadow,
  spacing,
  text as tText,
  type as tType,
} from "@/src/theme";

type ViewMode = "browse" | "map";

export default function Explore() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ category?: string }>();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(params.category ?? null);
  const [categories, setCategories] = useState<CategoryT[]>([]);
  const [city, setCity] = useState<CityT | null>(null);
  const [results, setResults] = useState<Business[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<ViewMode>("browse");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const cityName = user?.home_city ?? "Goa";
  const citySlug = cityName.toLowerCase();

  useEffect(() => {
    api<CategoryT[]>("/categories").then(setCategories).catch(() => {});
    api<CityT[]>("/cities")
      .then((all) => setCity(all.find((c) => c.slug === citySlug) ?? null))
      .catch(() => {});
  }, [citySlug]);

  useEffect(() => {
    if (params.category) setCategory(params.category);
  }, [params.category]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ city: citySlug, limit: "50" });
      if (category) qs.append("category", category);
      if (q.trim()) qs.append("q", q.trim());
      setResults(await api<Business[]>(`/businesses?${qs.toString()}`));
    } catch (e) {
      console.log("search", e);
    } finally {
      setLoading(false);
    }
  }, [citySlug, category, q]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  /**
   * Refinement happens here rather than in the query because /businesses
   * accepts only city, category, q and featured. The list is capped at 50, so
   * this is sorting and filtering a small array, not a scan.
   */
  const refined = useMemo(() => {
    let list = results;
    if (filters.price.length) {
      list = list.filter((b) => b.price_range && filters.price.includes(b.price_range));
    }
    if (filters.hasOffer) list = list.filter((b) => (b.offers?.length ?? 0) > 0);
    if (filters.verifiedOnly) list = list.filter((b) => b.is_verified);
    if (filters.sort === "rating") {
      list = [...list].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    } else if (filters.sort === "reviews") {
      list = [...list].sort((a, b) => (b.review_count ?? 0) - (a.review_count ?? 0));
    }
    return list;
  }, [results, filters]);

  const activeCategoryName = useMemo(
    () => categories.find((c) => c.slug === category)?.name ?? "All",
    [categories, category]
  );

  // The site leads the grid with one place as an editor's pick. Prefer a
  // featured business over merely the first result, so the slot means
  // something; fall back to the first when the city has none flagged.
  const editorsPick = useMemo(
    () => refined.find((b) => b.is_featured) ?? refined[0],
    [refined]
  );
  const rest = useMemo(
    () => refined.filter((b) => b.business_id !== editorsPick?.business_id),
    [refined, editorsPick]
  );

  const activeFilters = countActive(filters);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <FlatList
        data={mode === "map" ? [] : rest}
        keyExtractor={(b) => b.business_id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ paddingBottom: 120, gap: spacing.md }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <PlaceTile
            biz={item}
            testID={`result-${item.business_id}`}
            onPress={() => router.push(`/business/${item.business_id}`)}
          />
        )}
        ListHeaderComponent={
          <View>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
              <View style={styles.cityRow}>
                <Ionicons name="location" size={12} color={colors.brandPrimary} />
                <Text style={styles.cityEyebrow}>{cityName}</Text>
              </View>
              <Text style={styles.pageTitle}>Discover</Text>
              {city?.tagline ? <Text style={styles.pageSub}>{city.tagline}</Text> : null}

              <View style={styles.searchBar}>
                <Ionicons name="search" size={17} color={colors.onSurfaceTertiary} />
                <TextInput
                  testID="search-input"
                  value={q}
                  onChangeText={setQ}
                  placeholder={`Search ${cityName}…`}
                  placeholderTextColor={colors.onSurfaceTertiary}
                  style={styles.searchInput}
                  returnKeyType="search"
                />
                {q ? (
                  <Pressable onPress={() => setQ("")} hitSlop={8}>
                    <Ionicons name="close-circle" size={17} color={colors.onSurfaceTertiary} />
                  </Pressable>
                ) : null}
              </View>

              {/* Browse / Map */}
              <View style={styles.segment}>
                <SegButton
                  testID="mode-browse"
                  icon="grid-outline"
                  label="Browse"
                  active={mode === "browse"}
                  onPress={() => setMode("browse")}
                />
                <SegButton
                  testID="mode-map"
                  icon="map-outline"
                  label="Map"
                  active={mode === "map"}
                  onPress={() => setMode("map")}
                />
              </View>
            </View>

            {mode === "map" ? null : (
              <>
                {/* Category chips */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  <Chip
                    testID="chip-all"
                    label="All"
                    active={!category}
                    onPress={() => setCategory(null)}
                  />
                  {categories.map((c) => (
                    <Chip
                      key={c.slug}
                      testID={`filter-${c.slug}`}
                      label={c.name}
                      active={category === c.slug}
                      onPress={() => setCategory(c.slug === category ? null : c.slug)}
                    />
                  ))}
                </ScrollView>

                {/* Filter bar */}
                <View style={styles.filterBar}>
                  <Pressable
                    testID="open-filters"
                    onPress={() => setFiltersOpen(true)}
                    style={[styles.filterChip, activeFilters > 0 && styles.filterChipActive]}
                  >
                    <Ionicons
                      name="options-outline"
                      size={13}
                      color={activeFilters > 0 ? colors.onBrandPrimary : colors.onSurface}
                    />
                    <Text
                      style={[
                        styles.filterChipText,
                        activeFilters > 0 && styles.filterChipTextActive,
                      ]}
                    >
                      {activeFilters > 0 ? `Filters · ${activeFilters}` : "Filters"}
                    </Text>
                  </Pressable>

                  <View style={{ flex: 1 }} />

                  <Pressable
                    testID="open-filters-fab"
                    onPress={() => setFiltersOpen(true)}
                    accessibilityLabel="More filters"
                  >
                    <LinearGradient
                      colors={[colors.brandPrimary, colors.brandSecondary]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.fab}
                    >
                      <Ionicons name="funnel-outline" size={14} color={colors.onBrandPrimary} />
                    </LinearGradient>
                  </Pressable>
                </View>

                {/* Editor's pick */}
                {editorsPick ? (
                  <Pressable
                    testID="editors-pick"
                    onPress={() => router.push(`/business/${editorsPick.business_id}`)}
                    style={({ pressed }) => [
                      styles.pick,
                      pressed && { transform: [{ translateY: 2 }] },
                    ]}
                  >
                    <Image
                      source={{ uri: editorsPick.cover_image }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      transition={220}
                    />
                    <LinearGradient
                      colors={["rgba(14,22,15,0)", "rgba(14,22,15,0.25)", "rgba(14,22,15,0.9)"]}
                      locations={[0, 0.45, 1]}
                      style={StyleSheet.absoluteFill}
                    />
                    <View style={styles.pickBadge}>
                      <Ionicons name="sparkles" size={10} color={colors.onBrandTertiary} />
                      <Text style={styles.pickBadgeText}>Editor&apos;s pick</Text>
                    </View>
                    <View style={styles.pickBody}>
                      <Text style={styles.pickKicker}>{editorsPick.category}</Text>
                      <Text style={styles.pickName} numberOfLines={1}>
                        {editorsPick.name}
                      </Text>
                      <Text style={styles.pickSub} numberOfLines={1}>
                        {editorsPick.tags?.slice(0, 3).join(" · ") || editorsPick.address}
                      </Text>
                      <View style={styles.pickRating}>
                        <Ionicons name="star" size={12} color={colors.brandTertiary} />
                        <Text style={styles.pickRatingText}>
                          {editorsPick.rating?.toFixed(1) ?? "—"}
                          {editorsPick.review_count
                            ? ` · ${editorsPick.review_count.toLocaleString("en-IN")} reviews`
                            : ""}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                ) : null}

                {/* Count */}
                <Text style={styles.countLabel}>
                  {loading
                    ? "Loading…"
                    : `${refined.length} ${refined.length === 1 ? "place" : "places"} · ${activeCategoryName}`}
                </Text>
              </>
            )}
          </View>
        }
        ListEmptyComponent={
          mode === "map" ? null : loading ? (
            <View style={{ paddingVertical: spacing.xl, alignItems: "center" }}>
              <ActivityIndicator color={colors.brandPrimary} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={44} color={colors.borderStrong} />
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptySub}>
                {activeFilters > 0
                  ? `No places in ${cityName} match these filters.`
                  : `We haven't listed anything in ${cityName} for this yet.`}
              </Text>
              {activeFilters > 0 ? (
                <Pressable
                  testID="empty-clear-filters"
                  onPress={() => setFilters(EMPTY_FILTERS)}
                  style={styles.emptyBtn}
                >
                  <Text style={styles.emptyBtnText}>Clear filters</Text>
                </Pressable>
              ) : null}
            </View>
          )
        }
      />

      {mode === "map" ? (
        <View style={styles.mapWrap}>
          <MapPane
            businesses={refined}
            city={cityName}
            onSelect={(b) => router.push(`/business/${b.business_id}`)}
          />
        </View>
      ) : null}

      <FilterSheet
        visible={filtersOpen}
        value={filters}
        onChange={setFilters}
        onClose={() => setFiltersOpen(false)}
        resultCount={refined.length}
      />
    </KeyboardAvoidingView>
  );
}

function SegButton({
  icon,
  label,
  active,
  onPress,
  testID,
}: {
  icon: "grid-outline" | "map-outline";
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[styles.segBtn, active && styles.segBtnActive]}
    >
      <Ionicons name={icon} size={14} color={active ? colors.onBrandPrimary : colors.onSurface} />
      <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
    </Pressable>
  );
}

/** Discover's filter chip. Pills belong here, where they toggle; the home
 *  screen uses tinted tiles, which are for browsing. */
function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  cityRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  cityEyebrow: tText.eyebrow,
  pageTitle: {
    ...tText.displayTight,
    fontSize: 34,
    color: colors.onSurface,
    marginTop: 2,
  },
  pageSub: {
    fontFamily: fonts.body,
    fontSize: tType.base,
    color: colors.onSurfaceTertiary,
    marginTop: 2,
  },

  searchBar: {
    marginTop: spacing.lg,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 10,
    ...shadow.card,
  },
  searchInput: {
    flex: 1,
    color: colors.onSurface,
    fontFamily: fonts.body,
    fontSize: tType.base,
  },

  segment: {
    marginTop: spacing.md,
    flexDirection: "row",
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
  },
  segBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  segBtnActive: { backgroundColor: colors.brandPrimary },
  segText: { fontFamily: fonts.bodySemi, fontSize: tType.sm, color: colors.onSurface },
  segTextActive: { color: colors.onBrandPrimary },

  chipRow: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontFamily: fonts.bodySemi, fontSize: tType.sm, color: colors.onSurface },
  chipTextActive: { color: colors.onBrandPrimary },

  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterChipText: { fontFamily: fonts.bodyMedium, fontSize: tType.sm, color: colors.onSurface },
  filterChipTextActive: { color: colors.onBrandPrimary },
  fab: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },

  pick: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    height: 210,
    borderRadius: radius.xxl,
    overflow: "hidden",
    justifyContent: "flex-end",
    backgroundColor: colors.surfaceSecondary,
    ...shadow.card,
  },
  pickBadge: {
    position: "absolute",
    left: spacing.md,
    top: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
  },
  pickBadgeText: {
    ...tText.eyebrow,
    fontSize: 9.5,
    letterSpacing: 1.2,
    color: colors.onBrandTertiary,
  },
  pickBody: { padding: spacing.lg },
  pickKicker: { ...tText.eyebrow, color: "rgba(255,255,255,0.85)" },
  pickName: {
    ...tText.displayLoose,
    fontSize: tType.xxl,
    color: "#FFF",
    marginTop: 3,
  },
  pickSub: {
    fontFamily: fonts.body,
    fontSize: tType.sm,
    color: "rgba(255,255,255,0.85)",
    marginTop: 2,
  },
  pickRating: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 7 },
  pickRatingText: { fontFamily: fonts.bodyMedium, fontSize: tType.sm, color: "#FFF" },

  countLabel: {
    ...tText.eyebrow,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xs,
  },

  // Covers everything below the header while the map is showing. Not
  // StyleSheet.absoluteFillObject — this RN version does not type it.
  mapWrap: { position: "absolute", left: 0, right: 0, bottom: 0, top: 230 },

  empty: { paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl, alignItems: "center" },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: tType.lg,
    color: colors.onSurface,
    marginTop: spacing.md,
  },
  emptySub: {
    fontFamily: fonts.body,
    fontSize: tType.base,
    color: colors.onSurfaceTertiary,
    marginTop: 4,
    textAlign: "center",
  },
  emptyBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
  },
  emptyBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: tType.sm,
    color: colors.onBrandPrimary,
  },
});
