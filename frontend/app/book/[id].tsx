import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useGoBack } from "@/src/routing";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api, Business } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { colors, fonts, radius, spacing, type as tType } from "@/src/theme";

const TIMES = ["12:30", "13:00", "13:30", "19:00", "19:30", "20:00", "20:30", "21:00"];

/** True when `time` on `day` is already behind the device clock. The date row
 *  starts at today, so without this you could pick 12:30 at 14:00. The API
 *  refuses past slots too; this just stops people reaching that error. */
function slotPassed(day: Date, time: string): boolean {
  const [h, m] = time.split(":").map(Number);
  const slot = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
  return slot.getTime() < Date.now();
}

export default function BookScreen() {
  const { id, service } = useLocalSearchParams<{ id: string; service?: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useGoBack();
  const { show } = useToast();
  const [biz, setBiz] = useState<Business | null>(null);
  const [step, setStep] = useState<0 | 1>(0);
  const [date, setDate] = useState<Date>(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); return d;
  });
  const [time, setTime] = useState<string>("19:30");
  const [guests, setGuests] = useState(2);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<{ id: string } | null>(null);
  const [loadFailure, setLoadFailure] = useState<null | "missing" | "error">(null);

  // Without the catch, a failed fetch left `biz` null forever: release builds
  // showed a spinner with no way out, and dev builds an uncaught rejection.
  // Same rule as the place page: a 404 will not fix itself, anything else is
  // probably the network and is worth retrying.
  const load = useCallback(async () => {
    setLoadFailure(null);
    try {
      setBiz(await api<Business>(`/businesses/${id}`));
    } catch (e: any) {
      setLoadFailure(e?.status === 404 ? "missing" : "error");
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const days = useMemo(() => {
    const arr: Date[] = [];
    const base = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, []);

  // Local calendar date, not UTC. toISOString() shifts the day backwards for
  // anyone east of UTC (IST is +5:30), so a booking made after midnight would
  // be saved against the previous day.
  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const submit = async () => {
    if (!biz || submitting) return;
    setSubmitting(true);
    try {
      const r = await api<{ booking_id: string }>("/bookings", {
        method: "POST", auth: true,
        body: JSON.stringify({
          business_id: biz.business_id,
          date: fmtDate(date),
          time,
          guests,
          notes,
          service_name: service ?? null,
        }),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setConfirmed({ id: r.booking_id });
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      show(
        e?.status === 401
          ? "Your session expired. Sign in and try again."
          : e?.message || "We couldn't complete that booking. Please try again.",
        "error"
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!biz && loadFailure) {
    const missing = loadFailure === "missing";
    return (
      <View style={[styles.loader, { padding: spacing.xl, gap: spacing.md }]}>
        <Ionicons
          name={missing ? "compass-outline" : "cloud-offline-outline"}
          size={30}
          color={colors.onSurfaceTertiary}
        />
        <Text style={styles.gone} testID="book-unavailable">
          {missing ? "This place isn't taking bookings on Explore91." : "Couldn't load this place."}
        </Text>
        <Text style={styles.goneSub}>
          {missing
            ? "It may have been removed, or the link may be out of date."
            : "Check your connection and try again."}
        </Text>
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
          {!missing ? (
            <Pressable testID="book-retry" onPress={load} style={styles.goneBtn}>
              <Text style={styles.goneBtnText}>Try again</Text>
            </Pressable>
          ) : null}
          <Pressable
            testID="book-explore"
            onPress={() => router.replace("/(tabs)/explore")}
            style={[styles.goneBtn, missing && styles.goneBtnPrimary]}
          >
            <Text style={[styles.goneBtnText, missing && styles.goneBtnTextPrimary]}>
              Explore nearby
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!biz) {
    return <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>;
  }

  if (confirmed) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.xxl }]}>
        <View style={styles.successWrap}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={48} color="#FFF" />
          </View>
          <Text style={styles.successTitle}>Booking confirmed</Text>
          <Text style={styles.successSub}>
            You're all set at {biz.name} on {fmtDate(date)} at {time}.
          </Text>
          <View style={styles.successCard}>
            <Image source={{ uri: biz.cover_image }} style={styles.successImg} contentFit="cover" />
            <View style={{ flex: 1 }}>
              <Text style={styles.successBiz}>{biz.name}</Text>
              <Text style={styles.successMeta}>{fmtDate(date)} · {time} · {guests} guest{guests === 1 ? "" : "s"}</Text>
              {service ? <Text style={styles.successMeta}>{service}</Text> : null}
              <Text style={styles.successPoints}>+50 reward points earned</Text>
            </View>
          </View>
        </View>
        <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg }}>
          <Pressable
            testID="done-button"
            onPress={() => router.replace("/(tabs)/profile")}
            style={styles.primaryBtn}
          >
            <Text style={styles.primaryBtnText}>View my bookings</Text>
          </Pressable>
          <Pressable onPress={() => router.replace("/(tabs)")} style={{ marginTop: spacing.md, alignSelf: "center" }}>
            <Text style={{ color: colors.onSurfaceTertiary, fontFamily: fonts.bodySemi }}>Back to home</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={goBack} testID="close-book" style={styles.close}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{step === 0 ? "Select date & time" : "Guest details"}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Business summary */}
      <View style={styles.summary}>
        <Image source={{ uri: biz.cover_image }} style={styles.summaryImg} contentFit="cover" />
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryName}>{biz.name}</Text>
          <Text style={styles.summarySub} numberOfLines={1}>{biz.address}</Text>
          {service ? <Text style={styles.svcTag}>Service: {service}</Text> : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        {step === 0 ? (
          <>
            <Text style={styles.label}>Choose date</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {days.map((d) => {
                const active = fmtDate(d) === fmtDate(date);
                return (
                  <Pressable
                    key={d.toISOString()}
                    testID={`date-${fmtDate(d)}`}
                    onPress={() => setDate(d)}
                    style={[styles.dateCell, active && styles.dateCellActive]}
                  >
                    <Text style={[styles.dateDow, active && styles.dateActiveText]}>
                      {d.toLocaleDateString("en", { weekday: "short" })}
                    </Text>
                    <Text style={[styles.dateNum, active && styles.dateActiveText]}>
                      {d.getDate()}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={[styles.label, { marginTop: spacing.xl }]}>Choose time</Text>
            <View style={styles.timeGrid}>
              {TIMES.map((t) => {
                const passed = slotPassed(date, t);
                const active = t === time && !passed;
                return (
                  <Pressable
                    key={t}
                    testID={`time-${t}`}
                    onPress={() => setTime(t)}
                    disabled={passed}
                    accessibilityState={{ disabled: passed, selected: active }}
                    style={[styles.timeCell, active && styles.timeCellActive, passed && styles.timeCellPast]}
                  >
                    <Text style={[styles.timeText, active && styles.dateActiveText]}>{t}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.label, { marginTop: spacing.xl }]}>Guests</Text>
            <View style={styles.stepper}>
              <Pressable
                testID="guests-minus"
                onPress={() => setGuests(Math.max(1, guests - 1))}
                style={styles.stepBtn}
              >
                <Ionicons name="remove" size={20} color={colors.onSurface} />
              </Pressable>
              <Text style={styles.stepValue}>{guests}</Text>
              <Pressable
                testID="guests-plus"
                onPress={() => setGuests(Math.min(20, guests + 1))}
                style={styles.stepBtn}
              >
                <Ionicons name="add" size={20} color={colors.onSurface} />
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.label}>Special notes (optional)</Text>
            <TextInput
              testID="notes-input"
              value={notes}
              onChangeText={setNotes}
              maxLength={500}
              placeholder="Anniversary dinner, window seat, allergies…"
              placeholderTextColor={colors.onSurfaceTertiary}
              multiline
              style={styles.notesInput}
            />
            <View style={styles.recap}>
              <RecapRow icon="calendar-outline" label="Date" value={fmtDate(date)} />
              <RecapRow icon="time-outline" label="Time" value={time} />
              <RecapRow icon="people-outline" label="Guests" value={String(guests)} />
              {service ? <RecapRow icon="briefcase-outline" label="Service" value={service} /> : null}
            </View>
          </>
        )}
      </ScrollView>

      {/* Sticky action */}
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + spacing.sm }]}>
        {step === 1 ? (
          <Pressable
            testID="book-back"
            onPress={() => setStep(0)}
            style={[styles.secondaryBtn, { flex: 0.4 }]}
          >
            <Text style={styles.secondaryText}>Back</Text>
          </Pressable>
        ) : null}
        <Pressable
          testID={step === 0 ? "book-continue" : "book-confirm"}
          disabled={submitting}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            if (step === 0 && slotPassed(date, time)) {
              // Happens after switching the date to today with a time that
              // has already gone; the greyed-out cell is not highlighted.
              show("That time has already passed. Pick a later slot.", "error");
              return;
            }
            if (step === 0) setStep(1); else submit();
          }}
          style={[styles.primaryBtn, { flex: 1 }]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.primaryBtnText}>{step === 0 ? "Continue" : "Confirm booking"}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function RecapRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.recapRow}>
      <Ionicons name={icon} size={18} color={colors.onSurfaceTertiary} />
      <Text style={styles.recapLabel}>{label}</Text>
      <Text style={styles.recapValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  gone: { fontSize: tType.lg, fontFamily: fonts.bodyBold, color: colors.onSurface, textAlign: "center" },
  goneSub: { fontSize: tType.base, color: colors.onSurfaceSecondary, textAlign: "center" },
  goneBtn: {
    paddingHorizontal: spacing.lg,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  goneBtnPrimary: { backgroundColor: colors.brandPrimary },
  goneBtnText: { fontSize: tType.base, fontFamily: fonts.bodyBold, color: colors.onSurface },
  goneBtnTextPrimary: { color: "#FFF" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    justifyContent: "space-between",
  },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: tType.lg, fontFamily: fonts.display, color: colors.onSurface },

  summary: {
    flexDirection: "row",
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    gap: spacing.md,
    alignItems: "center",
  },
  summaryImg: { width: 56, height: 56, borderRadius: radius.md },
  summaryName: { fontSize: tType.lg, fontFamily: fonts.bodyBold, color: colors.onSurface },
  summarySub: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  svcTag: { fontSize: tType.sm, color: colors.brandTertiary, marginTop: 2, fontFamily: fonts.bodySemi },

  label: { fontSize: tType.lg, fontFamily: fonts.bodyBold, color: colors.onSurface, marginBottom: spacing.sm },
  dateCell: {
    width: 62, height: 78, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  dateCellActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  dateDow: { fontSize: 11, color: colors.onSurfaceTertiary, fontFamily: fonts.bodySemi, textTransform: "uppercase" },
  dateNum: { fontSize: 22, color: colors.onSurface, fontFamily: fonts.display, marginTop: 2 },
  dateActiveText: { color: "#FFF" },

  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeCell: {
    width: "23%", height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  timeCellActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  timeCellPast: { opacity: 0.35 },
  timeText: { fontSize: tType.base, color: colors.onSurface, fontFamily: fonts.bodySemi },

  stepper: {
    flexDirection: "row", alignItems: "center", gap: spacing.xl,
    alignSelf: "flex-start", backgroundColor: colors.surfaceSecondary, padding: spacing.sm, borderRadius: radius.pill,
  },
  stepBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#FFF", alignItems: "center", justifyContent: "center" },
  stepValue: { fontSize: 20, fontFamily: fonts.display, color: colors.onSurface, minWidth: 24, textAlign: "center" },

  notesInput: {
    minHeight: 120,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.md,
    color: colors.onSurface,
    fontSize: tType.base,
    textAlignVertical: "top",
  },
  recap: { marginTop: spacing.xl, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  recapRow: { flexDirection: "row", alignItems: "center", height: 48, paddingHorizontal: spacing.md, gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  recapLabel: { flex: 1, fontSize: tType.base, color: colors.onSurfaceTertiary },
  recapValue: { fontSize: tType.base, fontFamily: fonts.bodyBold, color: colors.onSurface },

  actionBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", gap: spacing.md, padding: spacing.lg,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider,
  },
  primaryBtn: {
    height: 54, borderRadius: radius.pill, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  primaryBtnText: { color: "#FFF", fontSize: tType.lg, fontFamily: fonts.bodyBold },
  secondaryBtn: {
    height: 54, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  secondaryText: { color: colors.onSurface, fontSize: tType.lg, fontFamily: fonts.bodyBold },

  successWrap: { flex: 1, alignItems: "center", padding: spacing.xl, justifyContent: "center" },
  successIcon: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: colors.success,
    alignItems: "center", justifyContent: "center",
  },
  successTitle: { fontSize: 26, fontFamily: fonts.display, color: colors.onSurface, marginTop: spacing.xl, letterSpacing: -0.4 },
  successSub: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: spacing.sm, textAlign: "center" },
  successCard: { flexDirection: "row", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, gap: spacing.md, marginTop: spacing.xl, alignItems: "center", alignSelf: "stretch" },
  successImg: { width: 64, height: 64, borderRadius: radius.md },
  successBiz: { fontSize: tType.lg, fontFamily: fonts.bodyBold, color: colors.onSurface },
  successMeta: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  successPoints: { fontSize: tType.sm, fontFamily: fonts.bodyBold, color: colors.success, marginTop: 6 },
});
