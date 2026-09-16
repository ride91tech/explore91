import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { api, Business } from "@/src/api";
import { BusinessCard } from "@/src/components/BusinessCard";
import { colors, spacing, type as tType } from "@/src/theme";

export default function Saved() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api<Business[]>("/saved", { auth: true });
      setItems(list);
    } catch (e) {
      console.log("saved", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>Saved</Text>
        <Text style={styles.sub}>Your bookmarked places</Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(b) => b.business_id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        renderItem={({ item }) => (
          <BusinessCard
            biz={item}
            variant="row"
            testID={`saved-${item.business_id}`}
            onPress={() => router.push(`/business/${item.business_id}`)}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={colors.brandPrimary} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="heart-outline" size={48} color={colors.borderStrong} />
              <Text style={styles.emptyTitle}>No saved places yet</Text>
              <Text style={styles.emptySub}>Tap the heart on any business to save it here for later.</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface },
  title: { fontSize: 32, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.8 },
  sub: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: 2 },
  empty: { alignItems: "center", paddingTop: spacing.xxxl * 2 },
  emptyTitle: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface, marginTop: spacing.md },
  emptySub: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: 4, textAlign: "center", paddingHorizontal: spacing.xl },
});
