import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Dimensions, Platform } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as AppleAuthentication from "expo-apple-authentication";
import { useAuth } from "@/src/auth";
import { colors, spacing, type as tType, radius } from "@/src/theme";

const HERO = "https://images.unsplash.com/photo-1685271552630-9bc169185566?crop=entropy&cs=srgb&fm=jpg&w=1600&q=85";

export default function Login() {
  const insets = useSafeAreaInsets();
  const { signIn, signInWithApple } = useAuth();
  const { width, height } = Dimensions.get("window");
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "ios") {
      AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
    }
  }, []);

  const handleApple = async () => {
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await signInWithApple();
    } catch (e: any) {
      // Apple returns { code: 'ERR_REQUEST_CANCELED' } when user cancels — swallow.
      if (e?.code !== "ERR_REQUEST_CANCELED" && e?.code !== "ERR_CANCELED") {
        setError(e?.message ?? "Apple sign-in failed. Please try again.");
      }
    }
  };

  return (
    <View style={styles.container}>
      <Image source={{ uri: HERO }} style={{ width, height }} contentFit="cover" />
      <LinearGradient
        colors={["rgba(17,17,17,0.15)", "rgba(17,17,17,0.55)", "rgba(17,17,17,0.95)"]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.top, { paddingTop: insets.top + spacing.xl }]}>
        <Text style={styles.brand}>EXPLORE91</Text>
        <Text style={styles.tag}>India's premium city discovery</Text>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={styles.h1}>Discover, book, and{"\n"}live your city.</Text>
        <Text style={styles.sub}>
          From candlelit dining to sunrise treks — book across restaurants, hotels, spas, events and more, all in one app.
        </Text>

        <Pressable
          testID="google-signin-button"
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); signIn(); }}
          style={styles.googleBtn}
        >
          <Ionicons name="logo-google" size={18} color={colors.onSurface} />
          <Text style={styles.googleText}>Continue with Google</Text>
        </Pressable>

        {appleAvailable ? (
          <View testID="apple-signin-wrap" style={{ marginTop: spacing.md }}>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={27}
              style={styles.appleBtn}
              onPress={handleApple}
            />
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.legal}>
          By continuing you agree to Explore91's Terms & Privacy Policy.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  top: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "flex-start", paddingHorizontal: spacing.xl },
  brand: { color: "#FFF", fontSize: 14, letterSpacing: 4, fontWeight: "800" },
  tag: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 4, letterSpacing: 1 },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.xl },
  h1: { color: "#FFF", fontSize: 34, fontWeight: "800", letterSpacing: -0.8, lineHeight: 40 },
  sub: { color: "rgba(255,255,255,0.85)", fontSize: 15, lineHeight: 22, marginTop: spacing.md },
  googleBtn: {
    marginTop: spacing.xl,
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  googleText: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  appleBtn: { height: 54, width: "100%" },
  error: { color: "#FFC5C5", fontSize: 13, textAlign: "center", marginTop: spacing.md },
  legal: { color: "rgba(255,255,255,0.6)", fontSize: 12, textAlign: "center", marginTop: spacing.lg },
});
