import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TextInput, Pressable } from "react-native";
import { api } from "@/src/api";
import { colors, spacing, type as tType } from "@/src/theme";
import { PageHeader, Btn, Pill, Table, TableHead, TableRow, Cell, Empty, Card } from "@/src/components/admin/ui";

type Ticket = {
  ticket_id: string;
  user_name: string;
  user_email: string;
  subject: string;
  message: string;
  status: "open" | "pending" | "resolved";
  admin_reply?: string | null;
  created_at: string;
};

export default function Tickets() {
  const [items, setItems] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Ticket["status"]>("all");
  const [replyOpen, setReplyOpen] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const load = useCallback(async () => {
    try {
      const qs = filter === "all" ? "" : `?status=${filter}`;
      const list = await api<Ticket[]>(`/admin/tickets${qs}`, { auth: true });
      setItems(list);
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const sendReply = async (id: string) => {
    if (!reply.trim()) return;
    await api(`/admin/tickets/${id}`, { method: "PATCH", auth: true, body: JSON.stringify({ admin_reply: reply, status: "resolved" }) });
    setReplyOpen(null); setReply("");
    load();
  };

  const setStatus = async (id: string, status: Ticket["status"]) => {
    await api(`/admin/tickets/${id}`, { method: "PATCH", auth: true, body: JSON.stringify({ status }) });
    load();
  };

  return (
    <View>
      <PageHeader
        title="Support tickets"
        subtitle={`${items.length} tickets in this view`}
        right={
          <View style={styles.filters}>
            {(["all", "open", "pending", "resolved"] as const).map((f) => (
              <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
                <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f[0].toUpperCase() + f.slice(1)}</Text>
              </Pressable>
            ))}
          </View>
        }
      />

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} />
      ) : items.length === 0 ? (
        <Empty label="No tickets yet." />
      ) : (
        <View style={{ gap: 16 }}>
          {items.map((t) => (
            <Card key={t.ticket_id}>
              <View style={styles.head}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subject}>{t.subject}</Text>
                  <Text style={styles.meta}>{t.user_name} · {t.user_email} · {new Date(t.created_at).toLocaleString()}</Text>
                </View>
                <Pill
                  label={t.status}
                  tone={t.status === "resolved" ? "ok" : t.status === "pending" ? "warn" : "brand"}
                />
              </View>
              <Text style={styles.body}>{t.message}</Text>
              {t.admin_reply ? (
                <View style={styles.replyBlock}>
                  <Text style={styles.replyLabel}>Admin reply</Text>
                  <Text style={styles.replyText}>{t.admin_reply}</Text>
                </View>
              ) : null}

              {replyOpen === t.ticket_id ? (
                <View style={{ marginTop: 12, gap: 8 }}>
                  <TextInput
                    testID={`ticket-reply-${t.ticket_id}`}
                    placeholder="Write a reply…"
                    placeholderTextColor={colors.onSurfaceTertiary}
                    value={reply}
                    onChangeText={setReply}
                    multiline
                    style={styles.replyInput}
                  />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Btn testID={`send-${t.ticket_id}`} tone="primary" label="Send & resolve" onPress={() => sendReply(t.ticket_id)} />
                    <Btn testID={`cancel-${t.ticket_id}`} tone="secondary" label="Cancel" onPress={() => { setReplyOpen(null); setReply(""); }} />
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                  <Btn testID={`reply-${t.ticket_id}`} small tone="primary" label={t.admin_reply ? "Update reply" : "Reply"} onPress={() => { setReplyOpen(t.ticket_id); setReply(t.admin_reply || ""); }} />
                  {t.status !== "resolved" ? (
                    <Btn testID={`resolve-${t.ticket_id}`} small tone="success" label="Mark resolved" onPress={() => setStatus(t.ticket_id, "resolved")} />
                  ) : null}
                  {t.status === "resolved" ? (
                    <Btn testID={`reopen-${t.ticket_id}`} small tone="secondary" label="Reopen" onPress={() => setStatus(t.ticket_id, "open")} />
                  ) : null}
                </View>
              )}
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: "row", gap: 6, backgroundColor: colors.surface, padding: 4, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chip: { paddingHorizontal: 14, height: 30, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  chipTextActive: { color: "#FFF" },

  head: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  subject: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  meta: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  body: { fontSize: tType.base, color: colors.onSurface, marginTop: 12, lineHeight: 22 },
  replyBlock: { marginTop: 12, padding: 12, backgroundColor: colors.surfaceSecondary, borderRadius: 8 },
  replyLabel: { fontSize: 11, fontWeight: "700", color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 1 },
  replyText: { fontSize: tType.base, color: colors.onSurface, marginTop: 4, lineHeight: 22 },
  replyInput: { minHeight: 80, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface, fontSize: tType.base, textAlignVertical: "top" },
});
