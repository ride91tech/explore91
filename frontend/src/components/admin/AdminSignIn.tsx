import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { colors, radius, spacing, type as tType } from "@/src/theme";

const HERO = "https://images.unsplash.com/photo-1685271552630-9bc169185566?crop=entropy&cs=srgb&fm=jpg&w=1600&q=85";

export function AdminSignIn() {
  const { user, loading, signIn, signOut, refresh } = useAuth();
  const router = useRouter();
  const [ensuring, setEnsuring] = useState(false);
  const [ensureErr, setEnsureErr] = useState<string | null>(null);

  const isAdmin = user?.roles?.includes("admin");

  useEffect(() => {
    if (isAdmin) router.replace("/admin");
  }, [isAdmin, router]);

  const requestAdmin = async () => {
    setEnsuring(true);
    setEnsureErr(null);
    try {
      await api("/auth/roles", { method: "POST", auth: true, body: JSON.stringify({ role: "admin" }) });
      await refresh();
    } catch (e: any) {
      setEnsureErr(
        e?.status === 403
          ? "Your email is not in the ADMIN_EMAILS allowlist. Ask the platform operator to add it in the deployment Secrets and retry."
          : e?.message ?? "Could not grant admin role."
      );
    } finally {
      setEnsuring(false);
    }
  };

  return (
    <View style={styles.shell}>
      {/* Left brand panel */}
      <View style={styles.brandPane}>
        <Image source={{ uri: HERO }} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient
          colors={["rgba(17,17,17,0.55)", "rgba(17,17,17,0.85)", "rgba(17,17,17,0.98)"]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.brandTop}>
          <View style={styles.brandDot} />
          <View>
            <Text style={styles.brand}>EXPLORE91</Text>
            <Text style={styles.brandSub}>Admin console</Text>
          </View>
        </View>
        <View style={styles.brandBottom}>
          <Text style={styles.heroKicker}>Operating system for every city</Text>
          <Text style={styles.heroTitle}>
            Approve businesses.{"\n"}Curate reels.{"\n"}Grow the platform.
          </Text>
          <View style={styles.bulletCol}>
            <Bullet text="Realtime GMV, bookings and platform-fee dashboard" />
            <Bullet text="Moderate reels, approve businesses & manage banners" />
            <Bullet text="Handle support tickets & fraud flags in one place" />
          </View>
        </View>
      </View>

      {/* Right form pane */}
      <View style={styles.formPane}>
        <View style={styles.formCard}>
          {loading ? (
            <View style={{ alignItems: "center", padding: 40 }}>
              <ActivityIndicator color={colors.brandPrimary} />
            </View>
          ) : !user ? (
            <>
              <Text style={styles.h1}>Sign in</Text>
              <Text style={styles.sub}>
                Use your Google account to sign in to the Explore91 admin console. Access is limited to allowlisted operators.
              </Text>
              <Pressable
                testID="admin-google-signin"
                onPress={() => signIn()}
                style={styles.googleBtn}
              >
                <Ionicons name="logo-google" size={18} color={colors.onSurface} />
                <Text style={styles.googleText}>Continue with Google</Text>
              </Pressable>
              <View style={styles.divider} />
              <Text style={styles.helper}>
                Are you a customer? Return to the{" "}
                <Text style={styles.link} onPress={() => router.replace("/(tabs)" as any)}>
                  Explore91 app
                </Text>
                .
              </Text>
            </>
          ) : (
            <>
              <View style={styles.checkIcon}>
                <Ionicons name="checkmark" size={26} color="#FFF" />
              </View>
              <Text style={styles.h1}>Almost there.</Text>
              <Text style={styles.sub}>
                You're signed in as <Text style={{ fontWeight: "700" }}>{user.email}</Text>. Your account needs the{" "}
                <Text style={styles.code}>admin</Text> role to access this console.
              </Text>

              <View style={styles.stepBlock}>
                <Text style={styles.stepTitle}>How to get access</Text>
                <Text style={styles.stepItem}>
                  1. Ask a platform operator to add <Text style={styles.code}>{user.email}</Text> to the{" "}
                  <Text style={styles.code}>ADMIN_EMAILS</Text> secret in the deployment settings, then redeploy.
                </Text>
                <Text style={styles.stepItem}>2. Come back here and tap "Request admin role" below.</Text>
              </View>

              <Pressable
                testID="admin-request-role"
                onPress={requestAdmin}
                disabled={ensuring}
                style={[styles.primaryBtn, ensuring && { opacity: 0.5 }]}
              >
                {ensuring ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Request admin role</Text>}
              </Pressable>

              {ensureErr ? <Text style={styles.err}>{ensureErr}</Text> : null}

              <View style={styles.divider} />
              <Pressable testID="admin-switch-account" onPress={() => signOut()} style={styles.textLinkRow}>
                <Ionicons name="log-out-outline" size={16} color={colors.onSurfaceTertiary} />
                <Text style={styles.link}>Sign out and use a different account</Text>
              </Pressable>
            </>
          )}
        </View>

        <Text style={styles.legal}>
          © {new Date().getFullYear()} Explore91 · v1 · Preview environment
        </Text>
      </View>
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot}>
        <Ionicons name="checkmark" size={12} color={colors.brandTertiary} />
      </View>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    flexDirection: "row",
    minHeight: 720,
    backgroundColor: colors.surface,
  } as any,

  // Left panel
  brandPane: {
    width: "50%",
    minWidth: 440,
    padding: 56,
    justifyContent: "space-between",
    overflow: "hidden",
  } as any,
  brandTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  brandDot: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.brandTertiary },
  brand: { color: "#FFF", fontSize: 14, letterSpacing: 3, fontWeight: "800" },
  brandSub: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 },

  brandBottom: {},
  heroKicker: { color: colors.brandTertiary, fontSize: 12, letterSpacing: 2, fontWeight: "800", textTransform: "uppercase" },
  heroTitle: { color: "#FFF", fontSize: 44, fontWeight: "800", lineHeight: 52, letterSpacing: -1, marginTop: 12 },
  bulletCol: { marginTop: 32, gap: 12 },
  bulletRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  bulletDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(226,125,96,0.15)",
    borderWidth: 1, borderColor: "rgba(226,125,96,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  bulletText: { color: "rgba(255,255,255,0.85)", fontSize: 14, lineHeight: 20 },

  // Right form pane
  formPane: {
    flex: 1,
    minWidth: 420,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    backgroundColor: colors.surface,
  } as any,
  formCard: {
    width: "100%",
    maxWidth: 420,
    padding: 40,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  h1: { fontSize: 28, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.6 },
  sub: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: 8, lineHeight: 22 },

  googleBtn: {
    marginTop: 28,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  googleText: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },

  checkIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.success,
    alignItems: "center", justifyContent: "center",
    marginBottom: 20,
  },
  stepBlock: {
    marginTop: 20,
    padding: 16,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    gap: 8,
  },
  stepTitle: { fontSize: 11, fontWeight: "800", color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 1 },
  stepItem: { fontSize: tType.sm, color: colors.onSurface, lineHeight: 20 },
  code: { fontFamily: "monospace", fontSize: 12, color: colors.onSurface, backgroundColor: colors.surfaceTertiary, paddingHorizontal: 4, borderRadius: 4 },

  primaryBtn: {
    marginTop: 20,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "#FFF", fontSize: tType.base, fontWeight: "700" },
  err: { color: colors.error, fontSize: tType.sm, marginTop: 12, lineHeight: 18 },

  divider: { height: 1, backgroundColor: colors.divider, marginTop: 24, marginBottom: 20 },
  helper: { fontSize: tType.sm, color: colors.onSurfaceTertiary, textAlign: "center", lineHeight: 20 },
  link: { color: colors.brandPrimary, fontWeight: "700" },
  textLinkRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },

  legal: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 32 },
});
