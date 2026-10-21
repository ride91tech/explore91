import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
  Modal,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { Slot, useRouter } from "expo-router";
import { useRouteSegments } from "@/src/routing";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { colors, radius, spacing, type as tType } from "@/src/theme";

const NAV = [
  { key: "index", label: "Overview", icon: "grid-outline" as const, href: "/owner" },
  { key: "businesses", label: "Businesses", icon: "storefront-outline" as const, href: "/owner/businesses" },
  { key: "bookings", label: "Bookings", icon: "calendar-outline" as const, href: "/owner/bookings" },
  { key: "staff", label: "Staff", icon: "people-outline" as const, href: "/owner/staff" },
  { key: "analytics", label: "Analytics", icon: "stats-chart-outline" as const, href: "/owner/analytics" },
  { key: "new-business", label: "Add business", icon: "add-circle-outline" as const, href: "/owner/new-business" },
];

const MOBILE_BREAKPOINT = 900;

export default function OwnerLayout() {
  const router = useRouter();
  const segments = useRouteSegments();
  const { user, loading, signOut, refresh } = useAuth();
  const { width } = useWindowDimensions();
  const isDesktop = width >= MOBILE_BREAKPOINT;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [enabling, setEnabling] = useState(false);

  const active = segments[1] || "index";

  // Bounce guests to /login, preserving return URL. Run in an effect so we
  // don't trigger a state update during render.
  useEffect(() => {
    if (loading || user) return;
    if (typeof window !== "undefined") {
      const returnTo = encodeURIComponent(window.location.pathname);
      router.replace(`/login?returnTo=${returnTo}` as any);
    } else {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  const isOwner = user.roles?.includes("owner");

  // Signed in but not an owner → offer one-tap upgrade.
  if (!isOwner) {
    const enableOwner = async () => {
      setEnabling(true);
      try {
        await api("/auth/roles", {
          method: "POST",
          auth: true,
          body: JSON.stringify({ role: "owner" }),
        });
        await refresh();
      } catch (e) {
        console.log(e);
      } finally {
        setEnabling(false);
      }
    };
    return (
      <View style={styles.centered}>
        <View style={styles.enableCard}>
          <View style={styles.enableIcon}>
            <Ionicons name="briefcase-outline" size={28} color={colors.brandPrimary} />
          </View>
          <Text style={styles.enableTitle}>Set up your business account</Text>
          <Text style={styles.enableSub}>
            List your business, take bookings, and manage your team from anywhere on Explore91.
          </Text>
          <View style={styles.bulletRow}>
            {["Publish unlimited listings", "See every booking in real time", "Track revenue, staff & analytics"].map((t) => (
              <View key={t} style={styles.bullet}>
                <Ionicons name="checkmark-circle" size={18} color={colors.brandPrimary} />
                <Text style={styles.bulletText}>{t}</Text>
              </View>
            ))}
          </View>
          <Pressable
            testID="owner-enable"
            onPress={enableOwner}
            disabled={enabling}
            style={styles.primaryBtn}
          >
            {enabling ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.primaryBtnText}>Enable business account</Text>
            )}
          </Pressable>
          <Pressable onPress={() => router.replace("/(tabs)")}>
            <Text style={styles.secondaryLink}>Back to app</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const nav = (href: string) => {
    setDrawerOpen(false);
    router.push(href as any);
  };

  const Sidebar = ({ compact = false }: { compact?: boolean }) => (
    <View style={[styles.sidebar, compact && styles.sidebarCompact]}>
      <View style={styles.brandRow}>
        <View style={styles.brandDot} />
        <View>
          <Text style={styles.brand}>EXPLORE91</Text>
          <Text style={styles.brandSub}>Business studio</Text>
        </View>
      </View>
      <View style={{ marginTop: spacing.xl, gap: 2 }}>
        {NAV.map((n) => {
          const isActive = active === n.key;
          return (
            <Pressable
              key={n.key}
              testID={`owner-nav-${n.key}`}
              onPress={() => nav(n.href)}
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
          <Text style={styles.avatarText}>{(user.name?.[0] || "O").toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.userName} numberOfLines={1}>{user.name}</Text>
          <Text style={styles.userEmail} numberOfLines={1}>{user.email}</Text>
        </View>
        <Pressable testID="owner-signout" onPress={() => signOut()} hitSlop={6}>
          <Ionicons name="log-out-outline" size={16} color={colors.onSurfaceTertiary} />
        </Pressable>
      </View>
    </View>
  );

  if (isDesktop) {
    return (
      <View style={styles.shell}>
        <Sidebar />
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentInner}
          showsVerticalScrollIndicator={false}
        >
          <Slot />
        </ScrollView>
      </View>
    );
  }

  // Mobile — top bar + slide-in drawer
  return (
    <View style={styles.mobileShell}>
      <View style={styles.mobileHeader}>
        <Pressable
          testID="owner-menu"
          onPress={() => setDrawerOpen(true)}
          style={styles.mobileIconBtn}
        >
          <Ionicons name="menu-outline" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.mobileTitle}>{navTitle(active)}</Text>
        </View>
        <Pressable
          testID="owner-close"
          onPress={() => router.replace("/(tabs)")}
          style={styles.mobileIconBtn}
        >
          <Ionicons name="close-outline" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
      >
        <Slot />
      </ScrollView>

      <Modal
        visible={drawerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDrawerOpen(false)}
      >
        <Pressable style={styles.drawerBackdrop} onPress={() => setDrawerOpen(false)}>
          <Pressable style={styles.drawerPanel} onPress={() => {}}>
            <Sidebar compact />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function navTitle(key: string) {
  return NAV.find((n) => n.key === key)?.label ?? "Business studio";
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
  sidebarCompact: {
    width: 260,
    borderRightWidth: 0,
    height: "100%",
  } as any,

  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  brandDot: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.brandPrimary,
  },
  brand: { fontSize: 13, fontWeight: "800", color: colors.onSurface, letterSpacing: 2 },
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
  navLabel: { fontSize: tType.base, color: colors.onSurfaceTertiary, fontWeight: "500" },
  navLabelActive: { color: colors.onSurface, fontWeight: "700" },

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
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#FFF", fontWeight: "700" },
  userName: { fontSize: tType.sm, fontWeight: "700", color: colors.onSurface },
  userEmail: { fontSize: 11, color: colors.onSurfaceTertiary },

  content: { flex: 1 } as any,
  contentInner: { padding: 32, minHeight: "100%" } as any,

  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.surfaceSecondary,
    minHeight: "100%",
  } as any,

  enableCard: {
    maxWidth: 480,
    padding: 32,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: "center",
  },
  enableIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  enableTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.onSurface,
    letterSpacing: -0.4,
    textAlign: "center",
  },
  enableSub: {
    fontSize: tType.base,
    color: colors.onSurfaceTertiary,
    textAlign: "center",
    lineHeight: 22,
  },
  bulletRow: { gap: 10, alignSelf: "stretch", marginTop: spacing.sm },
  bullet: { flexDirection: "row", alignItems: "center", gap: 10 },
  bulletText: { fontSize: tType.base, color: colors.onSurface },

  primaryBtn: {
    marginTop: spacing.md,
    paddingHorizontal: 24,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  primaryBtnText: { color: "#FFF", fontSize: tType.base, fontWeight: "700" },
  secondaryLink: { color: colors.onSurfaceTertiary, fontSize: tType.sm, marginTop: 8 },

  mobileShell: { flex: 1, backgroundColor: colors.surface } as any,
  mobileHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    height: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  mobileIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  mobileTitle: { fontSize: tType.lg, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.3 },

  drawerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    flexDirection: "row",
  } as any,
  drawerPanel: {
    width: 260,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.divider,
  },
});
