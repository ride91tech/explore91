import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { useAuth } from "@/src/auth";
import { api, Booking } from "@/src/api";
import { colors, radius, spacing, type as tType } from "@/src/theme";

export default function Profile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut, refresh } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [b] = await Promise.all([
        api<Booking[]>("/bookings", { auth: true }),
        refresh(),
      ]);
      setBookings(b);
    } catch (e) {
      console.log("profile", e);
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Date-aware: a confirmed booking stops being "upcoming" once its day has passed.
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const upcoming = bookings.filter((b) => b.status === "confirmed" && b.date >= todayStr);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ paddingBottom: 120 }}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.avatar}>
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={{ width: 64, height: 64, borderRadius: 32 }} />
          ) : (
            <Text style={styles.avatarText}>{(user?.name?.[0] || "U").toUpperCase()}</Text>
          )}
        </View>
        <Text style={styles.name} testID="profile-name">{user?.name ?? "Guest"}</Text>
        <Text style={styles.email}>{user?.email}</Text>
      </View>

      {/* Wallet card */}
      <View style={styles.walletWrap}>
        <LinearGradient
          colors={["#1A1A1A", "#333333"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.wallet}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="sparkles" size={16} color={colors.brandTertiary} />
            <Text style={styles.walletLabel}>Reward Points</Text>
          </View>
          <Text testID="wallet-points" style={styles.walletValue}>
            {user?.wallet_points?.toLocaleString() ?? 0}
          </Text>
          <Text style={styles.walletSub}>Redeem across bookings, discounts & partner offers.</Text>
        </LinearGradient>
      </View>

      {/* Upcoming bookings */}
      <View style={{ marginTop: spacing.xl, paddingHorizontal: spacing.lg }}>
        <Text style={styles.section}>Upcoming bookings</Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.brandPrimary} />
        ) : upcoming.length === 0 ? (
          <Text style={styles.emptyBooking}>You have no upcoming bookings.</Text>
        ) : (
          <View style={{ gap: spacing.md, marginTop: spacing.md }}>
            {upcoming.map((b) => (
              <Pressable
                key={b.booking_id}
                testID={`booking-${b.booking_id}`}
                style={styles.bookingRow}
                onPress={() => router.push(`/business/${b.business_id}`)}
              >
                <Image source={{ uri: b.business_image }} style={styles.bookingImage} contentFit="cover" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.bookingTitle} numberOfLines={1}>{b.business_name}</Text>
                  <Text style={styles.bookingMeta}>{b.date} · {b.time} · {b.guests} guest{b.guests === 1 ? "" : "s"}</Text>
                  {b.service_name ? <Text style={styles.bookingMeta}>{b.service_name}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* Settings rows */}
      <View style={{ marginTop: spacing.xl, paddingHorizontal: spacing.lg }}>
        <Text style={styles.section}>Account</Text>
        <View style={styles.rowGroup}>
          <SettingRow icon="location-outline" label="Change city" hint={user?.home_city ?? "Goa"} onPress={() => router.push("/city")} testID="settings-city" />
          <SettingRow icon="bookmarks-outline" label="Saved places" onPress={() => router.push("/(tabs)/trips")} testID="settings-saved" />
          <SettingRow icon="calendar-outline" label="All bookings" hint={`${bookings.length}`} onPress={() => router.push("/bookings" as any)} testID="settings-bookings" />
          <SettingRow icon="help-circle-outline" label="Help & Support" onPress={() => router.push("/support" as any)} testID="settings-help" />
        </View>

        <Text style={[styles.section, { marginTop: spacing.xl }]}>For business & platform</Text>
        <View style={styles.rowGroup}>
          <SettingRow
            icon="briefcase-outline"
            label="Business studio"
            hint={user?.roles?.includes("owner") ? "Open dashboard" : "Set up"}
            onPress={() => router.push("/owner" as any)}
            testID="settings-owner"
          />
        </View>

        <Pressable testID="logout-button" onPress={signOut} style={styles.logout}>
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function SettingRow({
  icon,
  label,
  hint,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} style={styles.settingRow}>
      <Ionicons name={icon} size={20} color={colors.onSurface} />
      <Text style={styles.settingLabel}>{label}</Text>
      {hint ? <Text style={styles.settingHint}>{hint}</Text> : null}
      <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: spacing.md,
  },
  avatarText: { color: "#FFF", fontWeight: "700", fontSize: 24 },
  name: { fontSize: 22, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.4 },
  email: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: 2 },

  walletWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.md },
  wallet: {
    borderRadius: radius.lg,
    padding: spacing.xl,
    minHeight: 140,
    justifyContent: "space-between",
  },
  walletLabel: { color: "rgba(255,255,255,0.7)", fontSize: tType.sm, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  walletValue: { color: "#FFF", fontSize: 40, fontWeight: "800", marginTop: spacing.sm, letterSpacing: -1 },
  walletSub: { color: "rgba(255,255,255,0.7)", fontSize: tType.sm, marginTop: spacing.md },

  section: { fontSize: tType.xl, fontWeight: "700", color: colors.onSurface, letterSpacing: -0.3 },
  emptyBooking: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: spacing.sm },

  bookingRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    gap: spacing.md,
  },
  bookingImage: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  bookingTitle: { fontSize: tType.lg, fontWeight: "700", color: colors.onSurface },
  bookingMeta: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },

  rowGroup: {
    marginTop: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    overflow: "hidden",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 56,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  settingLabel: { flex: 1, fontSize: tType.lg, color: colors.onSurface, fontWeight: "500" },
  settingHint: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginRight: 4 },

  logout: {
    marginTop: spacing.xl,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  logoutText: { color: colors.error, fontSize: tType.lg, fontWeight: "700" },
});
