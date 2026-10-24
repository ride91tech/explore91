import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/auth";
import { api, Business } from "@/src/api";
import { colors, fonts, radius, spacing, type as tType } from "@/src/theme";

const MOODS = ["Romantic", "Adventurous", "Relaxed", "Party", "Family", "Foodie"];
const BUDGETS = [
  { key: "low", label: "$" },
  { key: "medium", label: "$$" },
  { key: "luxury", label: "$$$" },
];
const PARTY = ["Solo", "Couple", "Family", "Friends"];

type Pick = { business: Business; reason: string };

export default function AIConcierge() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [mood, setMood] = useState<string | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const [party, setParty] = useState<string | null>(null);
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const r = await api<{ picks: Pick[] }>("/ai/recommend", {
        method: "POST", auth: true,
        body: JSON.stringify({
          mood: mood?.toLowerCase() ?? null,
          budget,
          party: party?.toLowerCase() ?? null,
          city: (user?.home_city ?? "Goa").toLowerCase(),
        }),
      });
      setPicks(r.picks);
    } catch (e) { console.log("ai", e); }
    finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="ai-close" onPress={() => router.back()} style={styles.close}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Explore91 Concierge</Text>
        <Pressable onPress={() => router.push("/ai/itinerary")} style={styles.itinBtn}>
          <Ionicons name="calendar" size={16} color={colors.brandPrimary} />
          <Text style={styles.itinBtnText}>Itinerary</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}>
        {picks === null ? (
          <>
            <Text style={styles.h1}>Tell me what you're in the mood for.</Text>
            <Text style={styles.sub}>I'll pick 5 places tailored to you, right now, in {user?.home_city ?? "your city"}.</Text>

            <Section title="Mood">
              <ChipRow options={MOODS} value={mood} onChange={setMood} testPrefix="mood" />
            </Section>
            <Section title="Budget">
              <View style={styles.row}>
                {BUDGETS.map((b) => (
                  <Pressable
                    key={b.key}
                    testID={`ai-budget-${b.key}`}
                    onPress={() => setBudget(budget === b.key ? null : b.key)}
                    style={[styles.chip, budget === b.key && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, budget === b.key && styles.chipTextActive]}>{b.label}</Text>
                  </Pressable>
                ))}
              </View>
            </Section>
            <Section title="Party">
              <ChipRow options={PARTY} value={party} onChange={setParty} testPrefix="party" />
            </Section>

            <Pressable
              testID="ai-submit"
              disabled={loading}
              onPress={submit}
              style={styles.cta}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="sparkles" size={18} color="#FFF" />
                  <Text style={styles.ctaText}>Curate my picks</Text>
                </>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.pickHeader}>
              <Text style={styles.h1}>Curated for you</Text>
              <Pressable testID="ai-reset" onPress={() => setPicks(null)}>
                <Text style={styles.reset}>Refine</Text>
              </Pressable>
            </View>
            {picks.map((p, i) => (
              <Pressable
                key={p.business.business_id}
                testID={`ai-pick-${i}`}
                onPress={() => router.push(`/business/${p.business.business_id}`)}
                style={styles.pickCard}
              >
                <Image source={{ uri: p.business.cover_image }} style={StyleSheet.absoluteFill} contentFit="cover" />
                <LinearGradient
                  colors={["rgba(14,22,15,0.15)", "rgba(14,22,15,0.9)"]}
                  style={StyleSheet.absoluteFill}
                />
                <View style={styles.pickBadge}>
                  <Ionicons name="sparkles" size={11} color="#FFF" />
                  <Text style={styles.pickBadgeText}>Pick {i + 1}</Text>
                </View>
                <View style={styles.pickInfo}>
                  <Text style={styles.pickName}>{p.business.name}</Text>
                  <Text style={styles.pickMeta}>
                    ★ {p.business.rating.toFixed(1)} · {p.business.category} · {p.business.price_range}
                  </Text>
                  <Text style={styles.pickReason}>{p.reason}</Text>
                </View>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: spacing.xl }}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.row}>{children}</View>
    </View>
  );
}

function ChipRow({
  options,
  value,
  onChange,
  testPrefix,
}: {
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
  testPrefix: string;
}) {
  return (
    <>
      {options.map((o) => (
        <Pressable
          key={o}
          testID={`ai-${testPrefix}-${o.toLowerCase()}`}
          onPress={() => onChange(value === o ? null : o)}
          style={[styles.chip, value === o && styles.chipActive]}
        >
          <Text style={[styles.chipText, value === o && styles.chipTextActive]}>{o}</Text>
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    justifyContent: "space-between",
  },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: tType.lg, fontFamily: fonts.display, color: colors.onSurface },
  itinBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  itinBtnText: { fontSize: tType.sm, fontFamily: fonts.bodyBold, color: colors.brandPrimary },

  h1: { fontSize: 26, fontFamily: fonts.display, color: colors.onSurface, letterSpacing: -0.6 },
  sub: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: spacing.sm, lineHeight: 22 },
  sectionLabel: { fontSize: tType.sm, fontFamily: fonts.bodyBold, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, height: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: tType.base, fontFamily: fonts.bodySemi, color: colors.onSurface },
  chipTextActive: { color: "#FFF" },

  cta: { marginTop: spacing.xxl, height: 54, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  ctaText: { color: "#FFF", fontSize: tType.lg, fontFamily: fonts.bodyBold },

  pickHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  reset: { color: colors.brandPrimary, fontFamily: fonts.bodyBold, fontSize: tType.base },
  pickCard: {
    height: 200,
    borderRadius: radius.lg,
    overflow: "hidden",
    marginBottom: spacing.md,
    justifyContent: "flex-end",
  },
  pickBadge: { position: "absolute", top: spacing.md, left: spacing.md, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brandTertiary, paddingHorizontal: 10, height: 26, borderRadius: radius.pill },
  pickBadgeText: { color: "#FFF", fontSize: 11, fontFamily: fonts.bodyBold },
  pickInfo: { padding: spacing.lg },
  pickName: { color: "#FFF", fontSize: tType.xl, fontFamily: fonts.display, letterSpacing: -0.3 },
  pickMeta: { color: "rgba(255,255,255,0.8)", fontSize: tType.sm, marginTop: 4 },
  pickReason: { color: "#FFF", fontSize: tType.base, marginTop: 8, lineHeight: 20 },
});
