import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Slot, useRouter } from "expo-router";
import { useRouteSegments } from "@/src/routing";
import { useAuth } from "@/src/auth";
import { AdminSignIn } from "@/src/components/admin/AdminSignIn";
import { ToastHost } from "@/src/components/admin/feedback";
import { colors, fonts, radius, spacing, type as tType } from "@/src/theme";

const NAV = [
  { key: "index", label: "Overview", icon: "grid-outline" as const, href: "/admin" },
  { key: "users", label: "Users", icon: "people-outline" as const, href: "/admin/users" },
  { key: "businesses", label: "Businesses", icon: "storefront-outline" as const, href: "/admin/businesses" },
  { key: "reels", label: "Reels", icon: "play-circle-outline" as const, href: "/admin/reels" },
  { key: "categories", label: "Categories", icon: "pricetags-outline" as const, href: "/admin/categories" },
  { key: "cities", label: "Cities", icon: "location-outline" as const, href: "/admin/cities" },
  { key: "banners", label: "Banners", icon: "megaphone-outline" as const, href: "/admin/banners" },
  { key: "reports", label: "Reports", icon: "stats-chart-outline" as const, href: "/admin/reports" },
  { key: "tickets", label: "Support", icon: "chatbubbles-outline" as const, href: "/admin/tickets" },
  { key: "flags", label: "Fraud flags", icon: "flag-outline" as const, href: "/admin/flags" },
  { key: "audit", label: "Audit log", icon: "receipt-outline" as const, href: "/admin/audit" },
];

export default function AdminLayout() {
  const router = useRouter();
  const segments = useRouteSegments();
  const { user, loading, signOut } = useAuth();
  const active = segments[1] || "index";

  // Web-only gate — mobile shows a friendly bounce screen
  if (Platform.OS !== "web") {
    return <MobileBlocker />;
  }

  if (loading) {
    return (
      <View style={styles.centeredScreen}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  // Written as one negated check on `user` rather than via an `isAdmin`
  // boolean so TypeScript narrows `user` to non-null for the rest of the
  // component. The optional-chain form read the same at runtime but left
  // `user` possibly-null below, which is what the sidebar had to paper over.
  if (!user || !user.roles?.includes("admin")) {
    // Not signed in, or signed in without the role — the dedicated web
    // sign-in / access-request screen handles both states internally.
    return <AdminSignIn />;
  }

  return (
    <ToastHost>
    <View style={styles.shell}>
      {/* Sidebar */}
      <View style={styles.sidebar}>
        <View style={styles.brandRow}>
          <View style={styles.brandDot} />
          <View>
            <Text style={styles.brand}>EXPLORE91</Text>
            <Text style={styles.brandSub}>Admin console</Text>
          </View>
        </View>
        <View style={{ marginTop: spacing.xl, gap: 2 }}>
          {NAV.map((n) => {
            const isActive = active === n.key;
            return (
              <Pressable
                key={n.key}
                testID={`nav-${n.key}`}
                onPress={() => router.push(n.href as any)}
                style={[styles.navItem, isActive && styles.navItemActive]}
              >
                <Ionicons
                  name={n.icon}
                  size={18}
                  color={isActive ? colors.onSurface : colors.onSurfaceTertiary}
                />
                <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>{n.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flex: 1 }} />
        <View style={styles.userBox}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user.name?.[0] || "A").toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName} numberOfLines={1}>{user.name}</Text>
            <Text style={styles.userEmail} numberOfLines={1}>{user.email}</Text>
          </View>
          <Pressable testID="admin-signout" onPress={() => signOut()} hitSlop={6}>
            <Ionicons name="log-out-outline" size={16} color={colors.onSurfaceTertiary} />
          </Pressable>
        </View>
      </View>

      {/* Content pane */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={{ padding: 32, minHeight: "100%" }}
        showsVerticalScrollIndicator={false}
      >
        <Slot />
      </ScrollView>
    </View>
    </ToastHost>
  );
}

function MobileBlocker() {
  const router = useRouter();
  return (
    <View style={styles.centeredScreen}>
      <View style={styles.gateCard}>
        <Ionicons name="desktop-outline" size={40} color={colors.onSurfaceTertiary} />
        <Text style={styles.gateTitle}>Open on desktop</Text>
        <Text style={styles.gateSub}>
          The Explore91 admin console is a web-only workspace. Please visit the same URL on your desktop browser to access it.
        </Text>
        <Pressable onPress={() => router.replace("/(tabs)")} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Back to app</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    minHeight: 720,
  } as any,
  sidebar: {
    width: 260,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRightWidth: 1,
    borderRightColor: colors.divider,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  brandDot: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: colors.brandPrimary,
  },
  brand: { fontSize: 13, fontFamily: fonts.bodyBold, color: colors.onSurface, letterSpacing: 2 },
  brandSub: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },

  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: spacing.md,
    height: 40,
    borderRadius: radius.sm,
  },
  navItemActive: { backgroundColor: colors.surfaceSecondary },
  navLabel: { fontSize: tType.base, color: colors.onSurfaceTertiary, fontFamily: fonts.bodyMedium },
  navLabelActive: { color: colors.onSurface, fontFamily: fonts.bodyBold },

  userBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    marginTop: spacing.md,
  },
  avatar: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: "#FFF", fontFamily: fonts.bodyBold },
  userName: { fontSize: tType.sm, fontFamily: fonts.bodyBold, color: colors.onSurface },
  userEmail: { fontSize: 11, color: colors.onSurfaceTertiary },

  content: { flex: 1 } as any,

  centeredScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.surfaceSecondary,
    minHeight: "100%",
  } as any,
  gateCard: {
    maxWidth: 480,
    padding: 32,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  gateTitle: { fontSize: 22, fontFamily: fonts.display, color: colors.onSurface, letterSpacing: -0.4 },
  gateSub: { fontSize: tType.base, color: colors.onSurfaceTertiary, textAlign: "center", lineHeight: 22 },
  primaryBtn: { marginTop: spacing.md, paddingHorizontal: 20, height: 44, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { color: "#FFF", fontSize: tType.base, fontFamily: fonts.bodyBold },
});
