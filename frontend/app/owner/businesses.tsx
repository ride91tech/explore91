import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter, useFocusEffect } from "expo-router";
import { api, Business } from "@/src/api";
import { colors, fonts, radius, spacing, type as tType } from "@/src/theme";

export default function OwnerBusinesses() {
  const router = useRouter();
  const [items, setItems] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setItems(await api<Business[]>("/owner/businesses", { auth: true }));
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ gap: spacing.xl }}>
      <View style={styles.head}>
        <View>
          <Text style={styles.eyebrow}>YOUR LISTINGS</Text>
          <Text style={styles.h1}>Businesses</Text>
        </View>
        <Pressable
          testID="add-business"
          onPress={() => router.push("/owner/new-business")}
          style={styles.primaryBtn}
        >
          <Ionicons name="add" size={16} color="#FFF" />
          <Text style={styles.primaryBtnText}>Add business</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} />
      ) : items.length ? (
        <View style={{ gap: spacing.md }}>
          {items.map((b) => (
            <Pressable
              key={b.business_id}
              testID={`biz-${b.business_id}`}
              onPress={() => router.push(`/business/${b.business_id}`)}
              style={styles.row}
            >
              <Image source={{ uri: b.cover_image }} style={styles.img} contentFit="cover" />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{b.name}</Text>
                <Text style={styles.meta}>{b.category} · {b.city} · {b.price_range}</Text>
                <View style={styles.pillRow}>
                  <View
                    style={[
                      styles.pill,
                      (b as any).is_approved ? styles.pillOk : styles.pillPending,
                    ]}
                  >
                    <Text style={styles.pillText}>
                      {(b as any).is_approved ? "Approved" : "Pending review"}
                    </Text>
                  </View>
                  {b.is_featured ? (
                    <View style={[styles.pill, { backgroundColor: colors.brandTertiary }]}>
                      <Text style={styles.pillText}>Featured</Text>
                    </View>
                  ) : null}
                  {b.rating ? (
                    <View style={styles.ratingPill}>
                      <Ionicons name="star" size={11} color={colors.brandTertiary} />
                      <Text style={styles.ratingText}>{b.rating.toFixed(1)} ({b.review_count})</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Ionicons name="storefront-outline" size={40} color={colors.borderStrong} />
          <Text style={styles.emptyTitle}>No businesses yet</Text>
          <Text style={styles.emptySub}>Add your first listing to start receiving bookings.</Text>
          <Pressable
            onPress={() => router.push("/owner/new-business")}
            style={[styles.primaryBtn, { marginTop: spacing.md }]}
          >
            <Ionicons name="add" size={16} color="#FFF" />
            <Text style={styles.primaryBtnText}>Add business</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, flexWrap: "wrap" as any },
  eyebrow: { fontSize: 11, fontFamily: fonts.bodyBold, color: colors.onSurfaceTertiary, letterSpacing: 2, textTransform: "uppercase" },
  h1: { fontSize: 28, fontFamily: fonts.display, color: colors.onSurface, letterSpacing: -0.6, marginTop: 4 },

  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
  },
  primaryBtnText: { color: "#FFF", fontFamily: fonts.bodyBold, fontSize: tType.sm },

  row: {
    flexDirection: "row",
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    gap: spacing.md,
    alignItems: "center",
  },
  img: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  name: { fontSize: tType.lg, fontFamily: fonts.bodyBold, color: colors.onSurface },
  meta: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  pillRow: { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" as any },
  pill: { paddingHorizontal: 8, height: 22, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  pillOk: { backgroundColor: colors.success },
  pillPending: { backgroundColor: colors.warning },
  pillText: { fontSize: 11, fontFamily: fonts.bodyBold, color: "#FFF" },
  ratingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
  },
  ratingText: { fontSize: 11, fontFamily: fonts.bodyBold, color: colors.onSurface },

  empty: {
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: tType.xl, fontFamily: fonts.display, color: colors.onSurface, marginTop: 6 },
  emptySub: { fontSize: tType.base, color: colors.onSurfaceTertiary, textAlign: "center" },
});
