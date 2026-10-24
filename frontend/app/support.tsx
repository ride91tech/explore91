import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { useAction } from "@/src/components/Toast";
import { colors, fonts, radius, spacing, type as tType } from "@/src/theme";

type Ticket = {
  ticket_id: string;
  subject: string;
  message: string;
  status: "open" | "pending" | "resolved";
  admin_reply?: string | null;
  created_at: string;
};

const STATUS_COPY: Record<Ticket["status"], { label: string; tone: string }> = {
  open: { label: "Waiting for us", tone: colors.brandTertiary },
  pending: { label: "In progress", tone: colors.warning },
  resolved: { label: "Answered", tone: colors.success },
};

export default function Support() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const { run, busy } = useAction();

  const load = useCallback(async () => {
    try {
      setTickets(await api<Ticket[]>("/tickets/mine", { auth: true }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

  const submit = async () => {
    const ok = await run(
      async () => {
        if (!subject.trim()) throw new Error("Add a subject so we know what this is about.");
        if (!message.trim()) throw new Error("Tell us what happened and we'll take a look.");
        await api("/tickets", {
          method: "POST",
          auth: true,
          body: JSON.stringify({ subject: subject.trim(), message: message.trim() }),
        });
        await load();
      },
      { success: "Sent — we'll reply here.", failure: "Couldn't send that. Please try again." }
    );
    if (ok) {
      setSubject("");
      setMessage("");
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="close-support" onPress={() => router.back()} style={styles.close}>
          <Ionicons name="close" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Help &amp; Support</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.lede}>
          Something not working, or a listing looks wrong? Tell us and we&apos;ll get back to you here.
        </Text>

        <View style={styles.composer}>
          <Text style={styles.label}>Subject</Text>
          <TextInput
            testID="ticket-subject"
            value={subject}
            onChangeText={setSubject}
            placeholder="Booking didn't go through"
            placeholderTextColor={colors.onSurfaceTertiary}
            style={styles.input}
            maxLength={140}
          />

          <Text style={[styles.label, { marginTop: spacing.md }]}>What happened?</Text>
          <TextInput
            testID="ticket-message"
            value={message}
            onChangeText={setMessage}
            placeholder="Give us a few details — the place, what you tried, and what you saw."
            placeholderTextColor={colors.onSurfaceTertiary}
            multiline
            style={[styles.input, styles.textarea]}
            maxLength={2000}
          />

          <Pressable
            testID="ticket-submit"
            onPress={submit}
            disabled={busy}
            style={[styles.submit, busy && { opacity: 0.6 }]}
          >
            {busy ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.submitText}>Send message</Text>
            )}
          </Pressable>
        </View>

        <Text style={styles.section}>Your messages</Text>

        {loading ? (
          <ActivityIndicator style={{ marginTop: spacing.lg }} color={colors.brandPrimary} />
        ) : tickets.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={40} color={colors.borderStrong} />
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptySub}>Anything you send will show up here with our reply.</Text>
          </View>
        ) : (
          <View style={{ gap: spacing.md, marginTop: spacing.md }}>
            {tickets.map((t) => {
              const s = STATUS_COPY[t.status] ?? STATUS_COPY.open;
              return (
                <View key={t.ticket_id} style={styles.ticket} testID={`ticket-${t.ticket_id}`}>
                  <View style={styles.ticketHead}>
                    <Text style={styles.ticketSubject} numberOfLines={2}>{t.subject}</Text>
                    <View style={[styles.pill, { backgroundColor: s.tone }]}>
                      <Text style={styles.pillText}>{s.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.ticketDate}>
                    {new Date(t.created_at).toLocaleDateString(undefined, {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                  </Text>
                  <Text style={styles.ticketBody}>{t.message}</Text>
                  {t.admin_reply ? (
                    <View style={styles.reply}>
                      <Text style={styles.replyLabel}>Explore91 replied</Text>
                      <Text style={styles.replyText}>{t.admin_reply}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
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

  lede: { fontSize: tType.base, color: colors.onSurfaceTertiary, lineHeight: 21 },

  composer: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
  },
  label: { fontSize: tType.sm, fontFamily: fonts.bodyBold, color: colors.onSurfaceTertiary, marginBottom: 6 },
  input: {
    minHeight: 46,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.onSurface,
    fontSize: tType.base,
  },
  textarea: { minHeight: 110, textAlignVertical: "top" },
  submit: {
    marginTop: spacing.lg,
    height: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { color: "#FFF", fontSize: tType.lg, fontFamily: fonts.bodyBold },

  section: {
    fontSize: tType.xl, fontFamily: fonts.display, color: colors.onSurface,
    letterSpacing: -0.3, marginTop: spacing.xxl,
  },

  empty: { alignItems: "center", paddingVertical: spacing.xxl },
  emptyTitle: { fontSize: tType.lg, fontFamily: fonts.display, color: colors.onSurface, marginTop: spacing.md },
  emptySub: { fontSize: tType.base, color: colors.onSurfaceTertiary, marginTop: 4, textAlign: "center" },

  ticket: {
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  ticketHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  ticketSubject: { flex: 1, fontSize: tType.lg, fontFamily: fonts.bodyBold, color: colors.onSurface },
  pill: { paddingHorizontal: 10, height: 24, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  pillText: { color: "#FFF", fontSize: 11, fontFamily: fonts.bodyBold },
  ticketDate: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 4 },
  ticketBody: { fontSize: tType.base, color: colors.onSurfaceSecondary, marginTop: spacing.md, lineHeight: 21 },
  reply: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSecondary,
  },
  replyLabel: {
    fontSize: 11, fontFamily: fonts.bodyBold, color: colors.onSurfaceTertiary,
    textTransform: "uppercase", letterSpacing: 1,
  },
  replyText: { fontSize: tType.base, color: colors.onSurface, marginTop: 4, lineHeight: 21 },
});
