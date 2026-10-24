import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, Booking } from "@/src/api";
import { useAction } from "@/src/components/Toast";
import { colors, fonts, radius, spacing, type as tType } from "@/src/theme";

/** A booking is upcoming only until its date has passed — status alone isn't enough. */
function isUpcoming(b: Booking): boolean {
  if (b.status !== "confirmed") return false;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return b.date >= todayStr;
}

const inr = (n?: number) => (n ? `₹${n.toLocaleString("en-IN")}` : null);

export default function Bookings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const { run } = useAction();

  const load = useCallback(async () => {
    try {
      setBookings(await api<Booking[]>("/bookings", { auth: true }));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load().catch(() => setLoading(false)); }, [load]));

  const cancel = async (b: Booking) => {
    setCancellingId(b.booking_id);
    await run(
      async () => {
        await api(`/bookings/${b.booking_id}`, { method: "DELETE", auth: true });
        await load();
      },
      { success: `Cancelled your booking at ${b.business_name}.`, failure: "Couldn't cancel that booking." }
    );
    setCancellingId(null);
  };

  const upcoming = bookings.filter(isUpcoming);
  const past = bookings.filter((b) => !isUpcoming(b));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-bookings" onPress={() => router.back()} style={styles.close}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>All bookings</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xxl }} color={colors.brandPrimary} />
      ) : bookings.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={48} color={colors.borderStrong} />
          <Text style={styles.emptyTitle}>No bookings yet</Text>
          <Text style={styles.emptySub}>When you book a place, it&apos;ll show up here.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}
          showsVerticalScrollIndicator={false}
        >
          {upcoming.length > 0 ? (
            <>
              <Text style={styles.section}>Upcoming</Text>
              <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                {upcoming.map((b) => (
                  <BookingCard
                    key={b.booking_id}
                    b={b}
                    onOpen={() => router.push(`/business/${b.business_id}`)}
                    onCancel={() => cancel(b)}
                    cancelling={cancellingId === b.booking_id}
                  />
                ))}
              </View>
            </>
          ) : null}

          {past.length > 0 ? (
            <>
              <Text style={[styles.section, { marginTop: upcoming.length ? spacing.xxl : 0 }]}>
                Past &amp; cancelled
              </Text>
              <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                {past.map((b) => (
                  <BookingCard
                    key={b.booking_id}
                    b={b}
                    dimmed
                    onOpen={() => router.push(`/business/${b.business_id}`)}
                  />
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function BookingCard({
  b, onOpen, onCancel, cancelling, dimmed,
}: {
  b: Booking;
  onOpen: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
  dimmed?: boolean;
}) {
  const amount = inr(b.amount_inr);
  return (
    <View style={[styles.card, dimmed && { opacity: 0.68 }]} testID={`booking-${b.booking_id}`}>
      <Pressable onPress={onOpen} style={styles.cardMain}>
        <Image source={{ uri: b.business_image }} style={styles.image} contentFit="cover" />
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{b.business_name}</Text>
          <Text style={styles.meta}>
            {b.date} · {b.time} · {b.guests} guest{b.guests === 1 ? "" : "s"}
          </Text>
          {b.service_name ? <Text style={styles.meta}>{b.service_name}</Text> : null}
          <View style={styles.row}>
            {b.status === "cancelled" ? (
              <Text style={[styles.status, { color: colors.error }]}>Cancelled</Text>
            ) : (
              <Text style={[styles.status, { color: colors.success }]}>Confirmed</Text>
            )}
            {amount && b.status !== "cancelled" ? (
              <Text style={styles.amount}>{amount}</Text>
            ) : null}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceTertiary} />
      </Pressable>

      {onCancel ? (
        <Pressable
          testID={`cancel-${b.booking_id}`}
          onPress={onCancel}
          disabled={cancelling}
          style={styles.cancel}
        >
          {cancelling ? (
            <ActivityIndicator size="small" color={colors.error} />
          ) : (
            <Text style={styles.cancelText}>Cancel booking</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  close: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: tType.lg, fontFamily: fonts.display, color: colors.onSurface },

  section: { fontSize: tType.xl, fontFamily: fonts.display, color: colors.onSurface, letterSpacing: -0.3 },

  card: { borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, overflow: "hidden" },
  cardMain: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  image: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  title: { fontSize: tType.lg, fontFamily: fonts.display, color: colors.onSurface },
  meta: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 6 },
  status: { fontSize: tType.sm, fontFamily: fonts.bodyBold },
  amount: { fontSize: tType.sm, fontFamily: fonts.bodyBold, color: colors.onSurface },

  cancel: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  cancelText: { color: colors.error, fontSize: tType.base, fontFamily: fonts.bodyBold },

  empty: { alignItems: "center", paddingTop: spacing.xxxl * 2, paddingHorizontal: spacing.xl },
  emptyTitle: { fontSize: tType.lg, fontFamily: fonts.display, color: colors.onSurface, marginTop: spacing.md },
  emptySub: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: 4, textAlign: "center" },
});
