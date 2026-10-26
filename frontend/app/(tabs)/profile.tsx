import React, { useCallback, useState } from "react";
import {
  Alert,
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
import { api, Booking, Business, JourneyT } from "@/src/api";
import { JourneyCard } from "@/src/components/JourneyCard";
import {
  colors,
  fonts,
  radius,
  shadow,
  spacing,
  text as tText,
  type as tType,
} from "@/src/theme";
import type { IconName } from "@/src/icons";

/**
 * Profile.
 *
 * Follows the website's layout — identity, the Journey card, a stat strip,
 * then grouped account rows — with one section left out. The site shows an
 * Achievements rail of five badges; there is no badge concept anywhere in
 * this backend, and the site's are hardcoded. A row of invented trophies is
 * worse than no row, so the stat strip carries real counts instead.
 */
export default function Profile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut, refresh, deleteAccount } = useAuth();
  const [erasing, setErasing] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [saved, setSaved] = useState<Business[]>([]);
  const [journey, setJourney] = useState<JourneyT | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // Settled independently: a failing /journey should not blank the
    // bookings list, and vice versa.
    const [b, s, j] = await Promise.allSettled([
      api<Booking[]>("/bookings", { auth: true }),
      api<Business[]>("/saved", { auth: true }),
      api<JourneyT>("/journey", { auth: true }),
    ]);
    if (b.status === "fulfilled") setBookings(b.value);
    if (s.status === "fulfilled") setSaved(s.value);
    if (j.status === "fulfilled") setJourney(j.value);
    try {
      await refresh();
    } catch {
      /* a stale profile is better than a blank one */
    }
    setLoading(false);
  }, [refresh]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Date-aware: a confirmed booking stops being "upcoming" once its day has passed.
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const upcoming = bookings.filter((b) => b.status === "confirmed" && b.date >= todayStr);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Identity */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.identity}>
          <LinearGradient
            colors={[colors.brandPrimary, colors.brandSecondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatar}
          >
            {user?.picture ? (
              <Image
                source={{ uri: user.picture }}
                style={{ width: 56, height: 56, borderRadius: radius.pill }}
              />
            ) : (
              <Text style={styles.avatarText}>{(user?.name?.[0] || "U").toUpperCase()}</Text>
            )}
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} testID="profile-name" numberOfLines={1}>
              {user?.name ?? "Guest"}
            </Text>
            <View style={styles.cityRow}>
              <Ionicons name="location" size={12} color={colors.onSurfaceTertiary} />
              <Text style={styles.cityText} numberOfLines={1}>
                Exploring {user?.home_city ?? "Goa"}
              </Text>
            </View>
          </View>
          <Pressable
            testID="profile-change-city"
            onPress={() => router.push("/city")}
            style={styles.iconBtn}
            accessibilityLabel="Change city"
          >
            <Ionicons name="settings-outline" size={17} color={colors.onSurface} />
          </Pressable>
        </View>
      </View>

      {/* Journey */}
      <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg }}>
        <JourneyCard
          testID="profile-journey-card"
          journey={journey}
          onPress={() => router.push("/journey")}
        />
      </View>

      {/* Stat strip. Every figure is a count of real records. */}
      <View style={styles.statStrip}>
        <MiniStat value={journey?.cities ?? "—"} label="Cities" />
        <MiniStat value={journey?.states ?? "—"} label="States" />
        <MiniStat value={saved.length} label="Saved" />
        <MiniStat value={bookings.length} label="Bookings" />
      </View>

      {/* Reward points */}
      <View style={styles.walletWrap}>
        <LinearGradient
          colors={[colors.ink, "#1C2E1E"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.wallet}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <Ionicons name="sparkles" size={14} color={colors.brandTertiary} />
            <Text style={styles.walletLabel}>Reward points</Text>
          </View>
          <Text testID="wallet-points" style={styles.walletValue}>
            {user?.wallet_points?.toLocaleString("en-IN") ?? 0}
          </Text>
          <Text style={styles.walletSub}>
            Redeem across bookings, discounts &amp; partner offers.
          </Text>
        </LinearGradient>
      </View>

      {/* Upcoming bookings */}
      <View style={styles.block}>
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
                style={({ pressed }) => [styles.bookingRow, pressed && styles.pressed]}
                onPress={() => router.push(`/business/${b.business_id}`)}
              >
                <Image
                  source={{ uri: b.business_image }}
                  style={styles.bookingImage}
                  contentFit="cover"
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.bookingTitle} numberOfLines={1}>
                    {b.business_name}
                  </Text>
                  <Text style={styles.bookingMeta}>
                    {b.date} · {b.time} · {b.guests} guest{b.guests === 1 ? "" : "s"}
                  </Text>
                  {b.service_name ? (
                    <Text style={styles.bookingMeta}>{b.service_name}</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurfaceTertiary} />
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* Account */}
      <View style={styles.block}>
        <Text style={styles.section}>Account</Text>
        <View style={styles.rowGroup}>
          <SettingRow
            icon="location-outline"
            label="Change city"
            hint={user?.home_city ?? "Goa"}
            onPress={() => router.push("/city")}
            testID="settings-city"
          />
          <SettingRow
            icon="bookmarks-outline"
            label="Saved places"
            hint={saved.length ? `${saved.length}` : undefined}
            onPress={() => router.push("/(tabs)/trips")}
            testID="settings-saved"
          />
          <SettingRow
            icon="calendar-outline"
            label="All bookings"
            hint={`${bookings.length}`}
            onPress={() => router.push("/bookings" as any)}
            testID="settings-bookings"
          />
          <SettingRow
            icon="help-circle-outline"
            label="Help & support"
            onPress={() => router.push("/support" as any)}
            testID="settings-help"
            last
          />
        </View>
      </View>

      <View style={styles.block}>
        <Text style={styles.section}>For business &amp; platform</Text>
        <View style={styles.rowGroup}>
          <SettingRow
            icon="briefcase-outline"
            label="Business studio"
            hint={user?.roles?.includes("owner") ? "Open dashboard" : "Set up"}
            onPress={() => router.push("/owner" as any)}
            testID="settings-owner"
            last
          />
        </View>

        <Pressable testID="logout-button" onPress={signOut} style={styles.logout}>
          <Ionicons name="log-out-outline" size={17} color={colors.error} />
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>

        <Pressable
          testID="privacy-link"
          onPress={() => router.push("/privacy")}
          style={styles.quietRow}
        >
          <Text style={styles.quietText}>Privacy notice</Text>
        </Pressable>

        {/* Erasure has to be reachable in the app, not by emailing support:
            DPDP s12(3) is a right the user exercises, and Google Play
            requires in-app account deletion for anything that lets you make
            an account. The confirm spells out what survives, because
            "deleted" that silently keeps your reviews is a lie. */}
        <Pressable
          testID="delete-account"
          disabled={erasing}
          onPress={() =>
            Alert.alert(
              "Delete your account?",
              "This cannot be undone.\n\nYour account, saved places, likes, "
                + "visits and support tickets are deleted. Reviews and bookings "
                + "stay with the business but stop being linked to you.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: async () => {
                    setErasing(true);
                    try {
                      await deleteAccount();
                      router.replace("/login");
                    } catch {
                      setErasing(false);
                      Alert.alert("Could not delete", "Please try again.");
                    }
                  },
                },
              ],
            )
          }
          style={styles.quietRow}
        >
          <Text style={[styles.quietText, styles.danger]}>
            {erasing ? "Deleting…" : "Delete my account"}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function MiniStat({ value, label }: { value: number | string; label: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniValue}>{value}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}

function SettingRow({
  icon,
  label,
  hint,
  onPress,
  testID,
  last,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  onPress?: () => void;
  testID?: string;
  last?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingRow,
        !last && styles.settingRowDivided,
        pressed && { backgroundColor: colors.surfaceSecondary },
      ]}
    >
      {/* Tinted icon square, as on the site's account list. */}
      <View style={styles.settingIcon}>
        <Ionicons name={icon} size={17} color={colors.brandPrimary} />
      </View>
      <Text style={styles.settingLabel}>{label}</Text>
      {hint ? <Text style={styles.settingHint}>{hint}</Text> : null}
      <Ionicons name="chevron-forward" size={17} color={colors.onSurfaceTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarText: { color: "#FFF", fontFamily: fonts.display, fontSize: 22 },
  name: {
    ...tText.displayLoose,
    fontSize: tType.xl,
    color: colors.onSurface,
  },
  cityRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  cityText: {
    fontFamily: fonts.body,
    fontSize: tType.sm,
    color: colors.onSurfaceTertiary,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  statStrip: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  miniStat: {
    flex: 1,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: "center",
    ...shadow.card,
  },
  miniValue: { fontFamily: fonts.display, fontSize: tType.lg, color: colors.onSurface },
  miniLabel: { ...tText.eyebrow, fontSize: 9.5, letterSpacing: 1.1, marginTop: 2 },

  walletWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.lg },
  wallet: {
    borderRadius: radius.xxl,
    padding: spacing.lg,
    minHeight: 130,
    justifyContent: "space-between",
    ...shadow.card,
  },
  walletLabel: { ...tText.eyebrow, color: "rgba(255,255,255,0.75)" },
  walletValue: {
    ...tText.displayTight,
    color: "#FFF",
    fontSize: 38,
    marginTop: spacing.sm,
  },
  walletSub: {
    fontFamily: fonts.body,
    fontSize: tType.sm,
    color: "rgba(255,255,255,0.7)",
    marginTop: spacing.md,
  },

  block: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  section: {
    ...tText.displayLoose,
    fontSize: tType.xl,
    color: colors.onSurface,
  },
  emptyBooking: {
    fontFamily: fonts.body,
    fontSize: tType.base,
    color: colors.onSurfaceTertiary,
    marginTop: spacing.sm,
  },

  pressed: { transform: [{ translateY: 2 }] },
  bookingRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    ...shadow.card,
  },
  bookingImage: {
    width: 54,
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
  },
  bookingTitle: {
    fontFamily: fonts.displaySemi,
    fontSize: tType.lg,
    color: colors.onSurface,
  },
  bookingMeta: {
    fontFamily: fonts.body,
    fontSize: tType.sm,
    color: colors.onSurfaceTertiary,
    marginTop: 2,
  },

  rowGroup: {
    marginTop: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadow.card,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 58,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  settingRowDivided: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  settingIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: "rgba(63,132,57,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  settingLabel: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: tType.base,
    color: colors.onSurface,
  },
  settingHint: {
    fontFamily: fonts.body,
    fontSize: tType.sm,
    color: colors.onSurfaceTertiary,
    marginRight: 2,
  },

  quietRow: { marginTop: spacing.lg, alignItems: "center", paddingVertical: spacing.sm },
  quietText: { fontFamily: fonts.body, fontSize: tType.sm, color: colors.onSurfaceTertiary },
  danger: { color: colors.error },
  logout: {
    marginTop: spacing.xl,
    height: 50,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  logoutText: { color: colors.error, fontFamily: fonts.bodySemi, fontSize: tType.base },
});
