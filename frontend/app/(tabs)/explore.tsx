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
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/src/auth";
import { api, Business, CategoryT } from "@/src/api";
import { Chip } from "@/src/components/Chip";
import { BusinessCard } from "@/src/components/BusinessCard";
import { MapPane } from "@/src/components/MapPane";
import { colors, radius, spacing, type as tType } from "@/src/theme";

type ViewMode = "list" | "map";

export default function Explore() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ category?: string }>();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(params.category ?? null);
  const [categories, setCategories] = useState<CategoryT[]>([]);
  const [results, setResults] = useState<Business[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<ViewMode>("list");

  const city = (user?.home_city ?? "Goa").toLowerCase();

  useEffect(() => { api<CategoryT[]>("/categories").then(setCategories).catch(() => {}); }, []);
  useEffect(() => { if (params.category) setCategory(params.category); }, [params.category]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ city, limit: "50" });
      if (category) qs.append("category", category);
      if (q.trim()) qs.append("q", q.trim());
      const list = await api<Business[]>(`/businesses?${qs.toString()}`);
      setResults(list);
    } catch (e) {
      console.log("search", e);
    } finally {
      setLoading(false);
    }
  }, [city, category, q]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const activeCategoryName = useMemo(
    () => categories.find((c) => c.slug === category)?.name ?? null,
    [categories, category]
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surface }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.titleRow}>
          <Text style={styles.pageTitle}>Explore {user?.home_city ?? "Goa"}</Text>
          <View style={styles.modeToggle}>
            <Pressable
              testID="mode-list"
              onPress={() => setMode("list")}
              style={[styles.modeBtn, mode === "list" && styles.modeBtnActive]}
            >
              <Ionicons name="list" size={16} color={mode === "list" ? "#FFF" : colors.onSurface} />
            </Pressable>
            <Pressable
              testID="mode-map"
              onPress={() => setMode("map")}
              style={[styles.modeBtn, mode === "map" && styles.modeBtnActive]}
            >
              <Ionicons name="map" size={16} color={mode === "map" ? "#FFF" : colors.onSurface} />
            </Pressable>
          </View>
        </View>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.onSurfaceTertiary} />
          <TextInput
            testID="search-input"
            value={q}
            onChangeText={setQ}
            placeholder="Search places, cuisines, services…"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.searchInput}
            returnKeyType="search"
          />
          {q ? (
            <Pressable onPress={() => setQ("")}>
              <Ionicons name="close-circle" size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={{ height: 56 }}
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
              icon={c.icon as any}
              active={category === c.slug}
              onPress={() => setCategory(c.slug === category ? null : c.slug)}
            />
          ))}
        </ScrollView>
      </View>

      {mode === "map" ? (
        <MapPane
          businesses={results}
          city={user?.home_city ?? "Goa"}
          onSelect={(b) => router.push(`/business/${b.business_id}`)}
        />
      ) : (
      <FlatList
        data={results}
        keyExtractor={(b) => b.business_id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.md }}
        renderItem={({ item }) => (
          <BusinessCard
            biz={item}
            variant="row"
            testID={`result-${item.business_id}`}
            onPress={() => router.push(`/business/${item.business_id}`)}
          />
        )}
        ListHeaderComponent={
          loading ? (
            <View style={{ paddingVertical: spacing.md, alignItems: "center" }}>
              <ActivityIndicator color={colors.brandPrimary} />
            </View>
          ) : (
            <View style={{ marginBottom: spacing.md }}>
              <Text style={styles.resultCount}>
                {results.length} result{results.length === 1 ? "" : "s"}
                {activeCategoryName ? ` · ${activeCategoryName}` : ""}
              </Text>
            </View>
          )
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={48} color={colors.borderStrong} />
              <Text style={styles.emptyTitle}>No places found</Text>
              <Text style={styles.emptySub}>Try clearing filters or searching a different keyword.</Text>
            </View>
          ) : null
        }
      />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  pageTitle: { fontSize: 26, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.6, marginBottom: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  modeToggle: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    padding: 4,
  },
  modeBtn: {
    width: 36, height: 32, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
  },
  modeBtnActive: { backgroundColor: colors.brandPrimary },
  searchBar: {
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: tType.base },
  chipRow: { gap: 8, paddingRight: spacing.lg, alignItems: "center" },
  resultCount: { fontSize: tType.sm, color: colors.onSurfaceTertiary, fontWeight: "600" },
  empty: { paddingVertical: spacing.xxxl, alignItems: "center" },
  emptyTitle: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface, marginTop: spacing.md },
  emptySub: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: 4, textAlign: "center" },
});
