import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth";
import { api, Business, CategoryT, CityT } from "@/src/api";
import { Chip } from "@/src/components/Chip";
import { BusinessCard } from "@/src/components/BusinessCard";
import { colors, radius, spacing, type as tType } from "@/src/theme";

export default function Discover() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [cities, setCities] = useState<CityT[]>([]);
  const [categories, setCategories] = useState<CategoryT[]>([]);
  const [featured, setFeatured] = useState<Business[]>([]);
  const [trending, setTrending] = useState<Business[]>([]);
  const [nearby, setNearby] = useState<Business[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const cityName = user?.home_city ?? "Goa";
  const citySlug = cityName.toLowerCase();
  const heroCity = cities.find((c) => c.slug === citySlug);

  const load = useCallback(async () => {
    try {
      const [c, cats, tr, feat, near] = await Promise.all([
        api<CityT[]>("/cities"),
        api<CategoryT[]>("/categories"),
        api<Business[]>(`/businesses/trending?city=${citySlug}&limit=8`),
        api<Business[]>(`/businesses?city=${citySlug}&featured=true&limit=6`),
        api<Business[]>(`/businesses?city=${citySlug}&limit=10`),
      ]);
      setCities(c);
      setCategories(cats);
      setTrending(tr);
      setFeatured(feat);
      setNearby(near);
    } catch (e) {
      console.log("home load", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [citySlug]);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <Pressable
            testID="city-selector"
            style={styles.citySelector}
            onPress={() => router.push("/city")}
          >
            <Ionicons name="location" size={16} color={colors.brandTertiary} />
            <Text style={styles.cityName}>{cityName}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.onSurface} />
          </Pressable>
          <Pressable
            testID="header-avatar"
            style={styles.avatar}
            onPress={() => router.push("/(tabs)/profile")}
          >
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={{ width: 36, height: 36, borderRadius: 18 }} />
            ) : (
              <Text style={styles.avatarText}>{(user?.name?.[0] || "U").toUpperCase()}</Text>
            )}
          </Pressable>
        </View>

        {/* Search bar (routes to explore) */}
        <Pressable
          testID="home-search"
          style={styles.search}
          onPress={() => router.push("/(tabs)/explore")}
        >
          <Ionicons name="search" size={18} color={colors.onSurfaceTertiary} />
          <Text style={styles.searchText}>Search for restaurants, hotels, spas…</Text>
        </Pressable>

        {/* Hero city card */}
        {heroCity ? (
          <Pressable
            testID="hero-city-card"
            onPress={() => router.push("/city")}
            style={styles.hero}
          >
            <Image source={{ uri: heroCity.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
            <LinearGradient
              colors={["transparent", "rgba(17,17,17,0.9)"]}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.heroInfo}>
              <Text style={styles.heroKicker}>The Explore91 edit</Text>
              <Text style={styles.heroTitle}>{heroCity.name}</Text>
              <Text style={styles.heroTag}>{heroCity.tagline}</Text>
            </View>
          </Pressable>
        ) : null}

        {/* Categories */}
        <View style={{ marginTop: spacing.xl }}>
          <SectionHeader title="Browse by category" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {categories.map((c) => (
              <Chip
                key={c.slug}
                testID={`cat-${c.slug}`}
                label={c.name}
                icon={c.icon as any}
                onPress={() => router.push({ pathname: "/(tabs)/explore", params: { category: c.slug } })}
              />
            ))}
          </ScrollView>
        </View>

        {/* A city with no listings renders every section away and the screen
            just trails off into blank space. Say what's going on and give a
            way out instead. */}
        {!loading && featured.length === 0 && trending.length === 0 && nearby.length === 0 && (
          <View style={styles.emptyCity} testID="home-empty-city">
            <Ionicons name="compass-outline" size={28} color={colors.onSurfaceTertiary} />
            <Text style={styles.emptyCityTitle}>We're still curating {cityName}</Text>
            <Text style={styles.emptyCitySub}>
              Nothing is listed here yet. Pick another city to start exploring.
            </Text>
            <Pressable
              testID="empty-city-switch"
              onPress={() => router.push("/city")}
              style={styles.emptyCityBtn}
            >
              <Text style={styles.emptyCityBtnText}>Choose another city</Text>
            </Pressable>
          </View>
        )}

        {/* Featured */}
        {featured.length > 0 && (
          <View style={{ marginTop: spacing.xl }}>
            <SectionHeader title="Featured this week" subtitle="Handpicked by our city curators" />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
              snapToInterval={296}
              decelerationRate="fast"
            >
              {featured.map((b) => (
                <View key={b.business_id} style={{ width: 280 }}>
                  <BusinessCard
                    biz={b}
                    variant="large"
                    testID={`featured-${b.business_id}`}
                    onPress={() => router.push(`/business/${b.business_id}`)}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Trending list */}
        {trending.length > 0 && (
          <View style={{ marginTop: spacing.xl, paddingHorizontal: spacing.lg }}>
            <SectionHeader title="Trending in the city" noPadding />
            <View style={{ gap: spacing.md, marginTop: spacing.md }}>
              {trending.slice(0, 5).map((b) => (
                <BusinessCard
                  key={b.business_id}
                  biz={b}
                  variant="row"
                  testID={`trending-${b.business_id}`}
                  onPress={() => router.push(`/business/${b.business_id}`)}
                />
              ))}
            </View>
          </View>
        )}

        {/* Nearby / More */}
        {nearby.length > 0 && (
          <View style={{ marginTop: spacing.xl, paddingHorizontal: spacing.lg }}>
            <SectionHeader title="More around you" noPadding />
            <View style={{ gap: spacing.md, marginTop: spacing.md }}>
              {nearby.slice(5, 10).map((b) => (
                <BusinessCard
                  key={b.business_id}
                  biz={b}
                  variant="row"
                  testID={`nearby-${b.business_id}`}
                  onPress={() => router.push(`/business/${b.business_id}`)}
                />
              ))}
            </View>
          </View>
        )}

        {loading && (
          <View style={{ padding: spacing.xxl, alignItems: "center" }}>
            <ActivityIndicator color={colors.brandPrimary} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function SectionHeader({ title, subtitle, noPadding }: { title: string; subtitle?: string; noPadding?: boolean }) {
  return (
    <View style={{ paddingHorizontal: noPadding ? 0 : spacing.lg, marginBottom: spacing.md }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyCity: {
    marginTop: spacing.xl,
    marginHorizontal: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyCityTitle: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface, textAlign: "center" },
  emptyCitySub: { fontSize: tType.base, color: colors.onSurfaceSecondary, textAlign: "center" },
  emptyCityBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCityBtnText: { color: "#FFF", fontWeight: "700", fontSize: tType.base },
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  citySelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
  },
  cityName: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarText: { color: "#FFF", fontWeight: "700", fontSize: 16 },

  search: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 10,
  },
  searchText: { color: colors.onSurfaceTertiary, fontSize: tType.base },

  hero: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.lg,
    height: 220,
    borderRadius: radius.lg,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  heroInfo: { padding: spacing.lg },
  heroKicker: { color: colors.brandTertiary, fontSize: 11, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" },
  heroTitle: { color: "#FFF", fontSize: 32, fontWeight: "800", marginTop: 4, letterSpacing: -0.6 },
  heroTag: { color: "rgba(255,255,255,0.85)", fontSize: 14, marginTop: 2 },

  chipRow: { paddingHorizontal: spacing.lg, gap: 8, paddingVertical: 4 },

  sectionTitle: { fontSize: tType.xl, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.3 },
  sectionSub: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
});
