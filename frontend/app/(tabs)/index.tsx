import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth";
import { api, Business, CategoryT, CityT } from "@/src/api";
import { CategoryTile } from "@/src/components/CategoryTile";
import type { IconName } from "@/src/icons";
import { BusinessCard } from "@/src/components/BusinessCard";
import { colors, fonts, radius, shadow, spacing, text as tText, type as tType } from "@/src/theme";

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

  // The site puts a time-of-day kicker above the city name. Derived from the
  // device clock rather than stored, so it is true without needing an API.
  const hour = new Date().getHours();
  const timeOfDay =
    hour < 12 ? "This morning" : hour < 17 ? "This afternoon" : "Tonight";

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
        {/* Full-bleed hero. Runs under the status bar and is overlapped by the
            sheet below, which is what gives the site its layered feel — a
            bordered card in a scroll view does not read the same way. */}
        <View style={styles.hero}>
          {heroCity ? (
            <Image
              source={{ uri: heroCity.image }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={220}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.ink }]} />
          )}
          <LinearGradient
            colors={["rgba(14,22,15,0.35)", "rgba(14,22,15,0.15)", "rgba(14,22,15,0.92)"]}
            locations={[0, 0.42, 1]}
            style={StyleSheet.absoluteFill}
          />

          <View style={[styles.heroTop, { paddingTop: insets.top + spacing.sm }]}>
            <Pressable
              testID="city-selector"
              style={styles.cityPill}
              onPress={() => router.push("/city")}
            >
              <View style={styles.pinCircle}>
                <Ionicons name="location" size={14} color="#FFF" />
              </View>
              <View>
                <Text style={styles.heroEyebrow}>Currently exploring</Text>
                <Text style={styles.cityName}>{cityName}</Text>
              </View>
              <Ionicons name="chevron-down" size={15} color="rgba(255,255,255,0.8)" />
            </Pressable>

            <Pressable
              testID="header-avatar"
              style={styles.avatar}
              onPress={() => router.push("/(tabs)/profile")}
            >
              {user?.picture ? (
                <Image source={{ uri: user.picture }} style={{ width: 40, height: 40, borderRadius: 20 }} />
              ) : (
                <Text style={styles.avatarText}>{(user?.name?.[0] || "U").toUpperCase()}</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.heroBottom}>
            <Text style={styles.heroEyebrow}>{timeOfDay}</Text>
            <Text style={styles.heroCity} numberOfLines={1} adjustsFontSizeToFit>
              {heroCity?.name ?? cityName}
            </Text>
            {heroCity?.tagline ? (
              <Text style={styles.heroTag}>{heroCity.tagline}</Text>
            ) : null}
            {/* The site shows weather here. There is no weather source, so
                this carries the city's real state and region instead of
                inventing a temperature. */}
            {heroCity?.state ? (
              <Text style={styles.heroMeta}>
                {[heroCity.state, heroCity.region].filter(Boolean).join("  ·  ")}
              </Text>
            ) : null}
          </View>
        </View>

        {/* The sheet that overlaps the hero. */}
        <View style={styles.sheet}>
          <Pressable
            testID="home-search"
            style={styles.search}
            onPress={() => router.push("/(tabs)/explore")}
          >
            <Ionicons name="search" size={18} color={colors.onSurfaceTertiary} />
            <Text style={styles.searchText}>Search places, food, stays, reels…</Text>
            <View style={styles.searchGo}>
              <Ionicons name="arrow-forward" size={16} color={colors.onBrandPrimary} />
            </View>
          </Pressable>
        </View>

        {/* Categories */}
        <View style={{ marginTop: spacing.xl }}>
          <Text style={[styles.eyebrow, { paddingHorizontal: spacing.lg }]}>Explore</Text>
          <SectionHeader title="Browse by category" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {categories.map((c, i) => (
              <CategoryTile
                key={c.slug}
                testID={`cat-${c.slug}`}
                label={c.name}
                icon={c.icon as IconName | undefined}
                index={i}
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
  emptyCityTitle: { fontSize: tType.lg, fontFamily: fonts.display, color: colors.onSurface, textAlign: "center" },
  emptyCitySub: { fontSize: tType.base, color: colors.onSurfaceSecondary, textAlign: "center" },
  emptyCityBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCityBtnText: { color: "#FFF", fontFamily: fonts.bodyBold, fontSize: tType.base },
  container: { flex: 1, backgroundColor: colors.background },
  // Just over half the viewport, as on the site. Tall enough for the city
  // name to dominate, short enough that the sheet below is clearly content
  // waiting to be scrolled rather than a second screen.
  hero: {
    height: Math.round(Dimensions.get("window").height * 0.56),
    justifyContent: "space-between",
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
  },
  cityPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pinCircle: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroEyebrow: {
    ...tText.eyebrow,
    color: "rgba(255,255,255,0.72)",
  },
  cityName: {
    fontFamily: fonts.displaySemi,
    fontSize: tType.lg,
    color: "#FFF",
    marginTop: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
  },
  avatarText: { color: "#FFF", fontFamily: fonts.bodyBold, fontSize: 16 },

  heroBottom: {
    paddingHorizontal: spacing.lg,
    // Clears the sheet, which is pulled up over the bottom of the hero.
    paddingBottom: spacing.xxl + spacing.lg,
  },
  heroCity: {
    ...tText.displayTight,
    fontSize: tType.hero,
    color: "#FFF",
    marginTop: 2,
  },
  heroTag: {
    fontFamily: fonts.body,
    fontSize: tType.lg,
    color: "rgba(255,255,255,0.88)",
    marginTop: 4,
  },
  heroMeta: {
    fontFamily: fonts.bodyMedium,
    fontSize: tType.sm,
    color: "rgba(255,255,255,0.62)",
    marginTop: spacing.sm,
  },

  // Pulled up over the hero. The large top radius is the shape the site uses
  // wherever content rises over photography.
  sheet: {
    marginTop: -spacing.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    borderTopLeftRadius: radius.xxxl,
    borderTopRightRadius: radius.xxxl,
    backgroundColor: colors.background,
  },
  search: {
    marginHorizontal: spacing.lg,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 18,
    paddingRight: 6,
    gap: 10,
    ...shadow.card,
  },
  searchText: { flex: 1, color: colors.onSurfaceTertiary, fontFamily: fonts.body, fontSize: tType.base },
  searchGo: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },

  eyebrow: tText.eyebrow,

  chipRow: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingVertical: spacing.sm },

  sectionTitle: {
    ...tText.displayLoose,
    fontSize: tType.xxl,
    color: colors.onSurface,
  },
  sectionSub: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2, fontFamily: fonts.body },
});
