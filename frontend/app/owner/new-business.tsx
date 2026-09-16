import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { api, CategoryT } from "@/src/api";
import { colors, radius, spacing, type as tType } from "@/src/theme";

const CITIES = ["Goa", "Ahmedabad", "Pune"];
const PRICES = ["$", "$$", "$$$", "$$$$"];
const BOOKING_TYPES: { key: string; label: string; hint: string }[] = [
  { key: "reservation", label: "Reservation", hint: "Table, room or slot booking with a specific time" },
  { key: "appointment", label: "Appointment", hint: "1:1 service booking (spa, doctor, salon)" },
  { key: "instant", label: "Instant", hint: "No time slot — book & confirm right away" },
];

export default function NewBusiness() {
  const router = useRouter();
  const [categories, setCategories] = useState<CategoryT[]>([]);
  const [name, setName] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [city, setCity] = useState("Goa");
  const [address, setAddress] = useState("");
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState("$$");
  const [btype, setBtype] = useState("reservation");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<CategoryT[]>("/categories").then(setCategories).catch(() => {});
  }, []);

  const submit = async () => {
    if (!name.trim() || !cat) return;
    setSubmitting(true);
    try {
      await api("/owner/businesses", {
        method: "POST",
        auth: true,
        body: JSON.stringify({
          name: name.trim(),
          category: cat,
          city: city.toLowerCase(),
          address: address.trim() || `${city}, India`,
          description: desc.trim(),
          price_range: price,
          booking_type: btype,
          tags: [],
        }),
      });
      setDone(true);
    } catch (e) {
      console.log(e);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <View style={styles.successWrap}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark" size={40} color="#FFF" />
        </View>
        <Text style={styles.successTitle}>Business submitted for review</Text>
        <Text style={styles.successSub}>
          Our team will approve your listing within 24 hours. You{"’"}ll get an email as soon as it goes live.
        </Text>
        <View style={styles.successCtas}>
          <Pressable
            testID="submit-add-another"
            onPress={() => {
              setDone(false);
              setName("");
              setCat(null);
              setAddress("");
              setDesc("");
            }}
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryBtnText}>Add another</Text>
          </Pressable>
          <Pressable
            testID="submit-done"
            onPress={() => router.replace("/owner")}
            style={styles.primaryBtn}
          >
            <Text style={styles.primaryBtnText}>Back to dashboard</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.xl }}>
      <View>
        <Text style={styles.eyebrow}>LIST A LISTING</Text>
        <Text style={styles.h1}>Add a new business</Text>
        <Text style={styles.sub}>Your listing will go live after our team reviews the details.</Text>
      </View>

      <View style={styles.card}>
        <FormField label="Business name">
          <TextInput
            testID="nb-name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Casa Sarita"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.input}
          />
        </FormField>

        <FormField label="Category">
          <View style={styles.row}>
            {categories.map((c) => (
              <Pressable
                key={c.slug}
                testID={`nb-cat-${c.slug}`}
                onPress={() => setCat(c.slug)}
                style={[styles.chip, cat === c.slug && styles.chipActive]}
              >
                <Text style={[styles.chipText, cat === c.slug && styles.chipTextActive]}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </FormField>

        <FormField label="City">
          <View style={styles.row}>
            {CITIES.map((cty) => (
              <Pressable
                key={cty}
                testID={`nb-city-${cty.toLowerCase()}`}
                onPress={() => setCity(cty)}
                style={[styles.chip, city === cty && styles.chipActive]}
              >
                <Text style={[styles.chipText, city === cty && styles.chipTextActive]}>{cty}</Text>
              </Pressable>
            ))}
          </View>
        </FormField>

        <FormField label="Address">
          <TextInput
            testID="nb-address"
            value={address}
            onChangeText={setAddress}
            placeholder="Street, area, landmark"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.input}
          />
        </FormField>

        <FormField label="Description">
          <TextInput
            testID="nb-desc"
            value={desc}
            onChangeText={setDesc}
            multiline
            placeholder="What makes your business special? Menu highlights, ambience, signature offerings…"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={[styles.input, { minHeight: 120, textAlignVertical: "top", paddingTop: 12 }]}
          />
        </FormField>

        <FormField label="Price range">
          <View style={styles.row}>
            {PRICES.map((p) => (
              <Pressable
                key={p}
                testID={`nb-price-${p.length}`}
                onPress={() => setPrice(p)}
                style={[styles.chip, price === p && styles.chipActive]}
              >
                <Text style={[styles.chipText, price === p && styles.chipTextActive]}>{p}</Text>
              </Pressable>
            ))}
          </View>
        </FormField>

        <FormField label="Booking type">
          <View style={{ gap: 8 }}>
            {BOOKING_TYPES.map((t) => {
              const active = btype === t.key;
              return (
                <Pressable
                  key={t.key}
                  testID={`nb-btype-${t.key}`}
                  onPress={() => setBtype(t.key)}
                  style={[styles.btypeCard, active && styles.btypeCardActive]}
                >
                  <View style={[styles.btypeRadio, active && styles.btypeRadioActive]}>
                    {active ? <View style={styles.btypeDot} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.btypeLabel}>{t.label}</Text>
                    <Text style={styles.btypeHint}>{t.hint}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </FormField>

        <Pressable
          testID="nb-submit"
          disabled={submitting || !name.trim() || !cat}
          onPress={submit}
          style={[styles.primaryBtn, (!name.trim() || !cat) && { opacity: 0.5 }]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.primaryBtnText}>Submit for review</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 11, fontWeight: "800", color: colors.onSurfaceTertiary, letterSpacing: 2, textTransform: "uppercase" },
  h1: { fontSize: 28, fontWeight: "800", color: colors.onSurface, letterSpacing: -0.6, marginTop: 4 },
  sub: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: 4 },

  card: {
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },

  label: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.onSurfaceTertiary,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  input: {
    minHeight: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: 14,
    color: colors.onSurface,
    fontSize: tType.base,
  } as any,

  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontSize: tType.sm, fontWeight: "600", color: colors.onSurface },
  chipTextActive: { color: "#FFF" },

  btypeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  btypeCardActive: { borderColor: colors.brandPrimary, backgroundColor: colors.surfaceSecondary },
  btypeRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  btypeRadioActive: { borderColor: colors.brandPrimary },
  btypeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brandPrimary },
  btypeLabel: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface },
  btypeHint: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },

  primaryBtn: {
    marginTop: spacing.md,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  primaryBtnText: { color: "#FFF", fontSize: tType.base, fontWeight: "700" },
  secondaryBtn: {
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  secondaryBtnText: { color: colors.onSurface, fontSize: tType.base, fontWeight: "700" },

  successWrap: { alignItems: "center", padding: spacing.xl, gap: spacing.md },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.success,
    alignItems: "center",
    justifyContent: "center",
  },
  successTitle: { fontSize: 24, fontWeight: "800", color: colors.onSurface, marginTop: spacing.md, letterSpacing: -0.4, textAlign: "center" },
  successSub: { fontSize: tType.base, color: colors.onSurfaceTertiary, textAlign: "center", maxWidth: 480 },
  successCtas: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg, flexWrap: "wrap" as any },
});
