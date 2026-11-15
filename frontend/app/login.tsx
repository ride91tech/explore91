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
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as AppleAuthentication from "expo-apple-authentication";
import { useAuth } from "@/src/auth";
import { useEmailOtp } from "@/src/useEmailOtp";
import { colors, fonts, radius, spacing } from "@/src/theme";

const HERO = "https://images.unsplash.com/photo-1685271552630-9bc169185566?crop=entropy&cs=srgb&fm=jpg&w=1600&q=85";

/** Same shape the backend's DevSignIn model accepts, so the button disables
 *  rather than the server answering 422. */
export default function Login() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signInWithApple } = useAuth();
  const otp = useEmailOtp();
  const [agreed, setAgreed] = useState(false);
  const { width, height } = Dimensions.get("window");
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "ios") {
      AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
    }
  }, []);

  // Consent is a precondition, not a formality: DPDP s6 wants a clear
  // affirmative action, which a pre-ticked box or an implied agreement in
  // small print is not. So no code is sent until it is ticked.
  const ready = otp.emailOk && agreed && !otp.busy;

  const handleApple = async () => {
    // Belt and braces with the dimmed wrapper below: the consent box gates
    // this path too. It did not, which meant one tap on the Apple button
    // created an account with nothing recorded - and Apple is the path that
    // outlives DEV_AUTH_ENABLED.
    if (!agreed) {
      setError("Please confirm you are 18 or older and agree to the Privacy Notice.");
      return;
    }
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await signInWithApple(agreed);
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
        colors={["rgba(14,22,15,0.15)", "rgba(14,22,15,0.55)", "rgba(14,22,15,0.95)"]}
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

          {otp.step === "email" ? (
            <>
              <TextInput
                testID="signin-email"
                value={otp.email}
                onChangeText={otp.setEmail}
                placeholder="you@example.com"
                placeholderTextColor="rgba(255,255,255,0.45)"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                returnKeyType="go"
                onSubmitEditing={() => ready && otp.send()}
                editable={!otp.busy}
                style={styles.input}
              />
              <Pressable
                testID="signin-send-code"
                onPress={() => otp.send()}
                disabled={!ready}
                style={[styles.cta, !ready && styles.ctaDisabled]}
              >
                {otp.busy ? (
                  <ActivityIndicator color={colors.onSurface} />
                ) : (
                  <Text style={styles.ctaText}>Email me a code</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <Text testID="signin-code-sent" style={styles.sentTo}>
                Enter the 6-digit code we sent to{"\n"}
                <Text style={styles.sentToEmail}>{otp.email.trim()}</Text>
              </Text>
              <TextInput
                testID="signin-code"
                value={otp.code}
                onChangeText={otp.setCode}
                placeholder="123456"
                placeholderTextColor="rgba(255,255,255,0.35)"
                keyboardType="number-pad"
                // Lets iOS and Android offer the code straight from the email.
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                returnKeyType="go"
                onSubmitEditing={() => otp.codeOk && otp.verify(agreed)}
                editable={!otp.busy}
                style={[styles.input, styles.codeInput]}
              />
              <Pressable
                testID="signin-verify"
                onPress={() => otp.verify(agreed)}
                disabled={!otp.codeOk || otp.busy}
                style={[styles.cta, (!otp.codeOk || otp.busy) && styles.ctaDisabled]}
              >
                {otp.busy ? (
                  <ActivityIndicator color={colors.onSurface} />
                ) : (
                  <Text style={styles.ctaText}>Sign in</Text>
                )}
              </Pressable>
              {otp.notice ? <Text style={styles.notice}>{otp.notice}</Text> : null}
              <View style={styles.codeLinks}>
                <Text testID="signin-resend" style={styles.codeLink} onPress={otp.resend}>
                  Send a new code
                </Text>
                <Text style={styles.codeLinkSep}>·</Text>
                <Text testID="signin-change-email" style={styles.codeLink} onPress={otp.changeEmail}>
                  Use a different email
                </Text>
              </View>
            </>
          )}

          {appleAvailable && otp.step === "email" ? (
            <View
              testID="apple-signin-wrap"
              pointerEvents={agreed ? "auto" : "none"}
              style={{ marginTop: spacing.md, opacity: agreed ? 1 : 0.4 }}
            >
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={27}
                style={styles.appleBtn}
                onPress={handleApple}
              />
            </View>
          ) : null}

          {otp.error ?? error ? <Text style={styles.error}>{otp.error ?? error}</Text> : null}

          {otp.step === "email" ? (
          <Pressable
            testID="consent-checkbox"
            onPress={() => setAgreed((v) => !v)}
            style={styles.consentRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
          >
            <View style={[styles.box, agreed && styles.boxOn]}>
              {agreed ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
            </View>
            <Text style={styles.legal}>
              I am 18 or older and I agree to the{" "}
              <Text style={styles.link} onPress={() => router.push("/privacy")}>
                Privacy Notice
              </Text>
              . It explains what Explore91 collects and how to delete it.
            </Text>
          </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  top: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "flex-start", paddingHorizontal: spacing.xl },
  brand: { color: "#FFF", fontSize: 14, letterSpacing: 4, fontFamily: fonts.display },
  tag: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 4, letterSpacing: 1 },
  kav: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "85%" },
  bottom: { paddingHorizontal: spacing.xl },
  h1: { color: "#FFF", fontSize: 34, fontFamily: fonts.display, letterSpacing: -0.8, lineHeight: 40 },
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
  ctaText: { color: colors.onSurface, fontSize: 16, fontFamily: fonts.bodyBold },
  sentTo: {
    color: "rgba(255,255,255,0.75)", fontSize: 14, lineHeight: 21,
    textAlign: "center", marginBottom: spacing.md,
  },
  sentToEmail: { color: "#fff", fontFamily: fonts.bodySemi },
  codeInput: { letterSpacing: 8, textAlign: "center", fontSize: 22 },
  notice: {
    color: "rgba(255,255,255,0.7)", fontSize: 12, textAlign: "center",
    marginTop: spacing.sm,
  },
  codeLinks: {
    flexDirection: "row", justifyContent: "center", alignItems: "center",
    gap: spacing.sm, marginTop: spacing.md,
  },
  codeLink: { color: "#fff", fontSize: 13, textDecorationLine: "underline" },
  codeLinkSep: { color: "rgba(255,255,255,0.4)", fontSize: 13 },
  appleBtn: { height: 54, width: "100%" },
  error: { color: "#FFC5C5", fontSize: 13, textAlign: "center", marginTop: spacing.md },
  consentRow: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.sm,
    marginTop: spacing.lg, paddingHorizontal: spacing.xs,
  },
  box: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.45)", alignItems: "center",
    justifyContent: "center", marginTop: 1,
  },
  boxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  legal: { flex: 1, color: "rgba(255,255,255,0.6)", fontSize: 12, lineHeight: 18 },
  link: { color: "#fff", textDecorationLine: "underline" },
});
