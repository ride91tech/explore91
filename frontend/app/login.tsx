import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
  Platform,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as AppleAuthentication from "expo-apple-authentication";
import { useAuth } from "@/src/auth";
import { colors, spacing, radius } from "@/src/theme";

const HERO = "https://images.unsplash.com/photo-1685271552630-9bc169185566?crop=entropy&cs=srgb&fm=jpg&w=1600&q=85";

/** Same shape the backend's DevSignIn model accepts, so the button disables
 *  rather than the server answering 422. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function Login() {
  const insets = useSafeAreaInsets();
  const { signIn, signInWithApple } = useAuth();
  const { width, height } = Dimensions.get("window");
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "ios") {
      AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
    }
  }, []);

  const ready = EMAIL.test(email.trim()) && !busy;

  const handleContinue = async () => {
    if (!ready) return;
    setError(null);
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await signIn(email.trim());
    } catch (e: any) {
      // The endpoint 404s unless DEV_AUTH_ENABLED is set on the server, which
      // is the case someone hitting this against production will meet — so
      // say that rather than "not found".
      setError(
        e?.status === 404
          ? "Sign-in isn't switched on for this server."
          : e?.message ?? "Couldn't sign in. Please try again."
      );
    } finally {
      setBusy(false);
    }
  };

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

      {/* The sign-in block sits at the bottom, where the keyboard would cover
          it. Avoiding on iOS and scrolling on Android is what keeps the field
          and the button visible while typing. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.kav}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.bottom, { paddingBottom: insets.bottom + spacing.xl }]}
        >
          <Text style={styles.h1}>Discover, book, and{"\n"}live your city.</Text>
          <Text style={styles.sub}>
            From candlelit dining to sunrise treks — book across restaurants, hotels, spas, events and more, all in one app.
          </Text>

          <TextInput
            testID="signin-email"
            value={email}
            onChangeText={(t) => { setEmail(t); setError(null); }}
            placeholder="you@example.com"
            placeholderTextColor="rgba(255,255,255,0.45)"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            returnKeyType="go"
            onSubmitEditing={handleContinue}
            editable={!busy}
            style={styles.input}
          />

          <Pressable
            testID="signin-continue"
            onPress={handleContinue}
            disabled={!ready}
            style={[styles.cta, !ready && styles.ctaDisabled]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onSurface} />
            ) : (
              <Text style={styles.ctaText}>Continue</Text>
            )}
          </Pressable>

          <Text testID="signin-placeholder-note" style={styles.devNote}>
            Temporary sign-in — no password, nothing verified. One-time passcodes are coming.
          </Text>

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
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  top: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "flex-start", paddingHorizontal: spacing.xl },
  brand: { color: "#FFF", fontSize: 14, letterSpacing: 4, fontWeight: "800" },
  tag: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 4, letterSpacing: 1 },
  kav: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "85%" },
  bottom: { paddingHorizontal: spacing.xl },
  h1: { color: "#FFF", fontSize: 34, fontWeight: "800", letterSpacing: -0.8, lineHeight: 40 },
  sub: { color: "rgba(255,255,255,0.85)", fontSize: 15, lineHeight: 22, marginTop: spacing.md },
  input: {
    marginTop: spacing.xl,
    height: 54,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    color: "#FFF",
    fontSize: 16,
  },
  cta: {
    marginTop: spacing.md,
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  devNote: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    marginTop: spacing.md,
  },
  appleBtn: { height: 54, width: "100%" },
  error: { color: "#FFC5C5", fontSize: 13, textAlign: "center", marginTop: spacing.md },
  legal: { color: "rgba(255,255,255,0.6)", fontSize: 12, textAlign: "center", marginTop: spacing.lg },
});
