import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable } from "react-native";
import { apiPaged, api } from "@/src/api";
import { colors, spacing, type as tType } from "@/src/theme";
import {
  PageHeader, Btn, Pill, Empty, Card,
  Pagination, ResultCount, Loading,
} from "@/src/components/admin/ui";
import { useAsyncAction } from "@/src/components/admin/feedback";

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

const PAGE = 25;

/** Surfaces how long a ticket has been waiting — the thing that actually matters. */
function age(iso: string): { label: string; stale: boolean } {
  const hours = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (hours < 1) return { label: "just now", stale: false };
  if (hours < 24) return { label: `${Math.floor(hours)}h old`, stale: hours >= 12 };
  const days = Math.floor(hours / 24);
  return { label: `${days}d old`, stale: true };
}

export default function Tickets() {
  const [items, setItems] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Ticket["status"]>("all");
  const [offset, setOffset] = useState(0);
  const [replyOpen, setReplyOpen] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const { run, isBusy } = useAsyncAction();

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (filter !== "all") qs.append("status", filter);
    const res = await apiPaged<Ticket>(`/admin/tickets?${qs}`, { auth: true });
    setItems(res.rows);
    setTotal(res.total);
  }, [filter, offset]);

  useEffect(() => {
    setLoading(true);
    run("load", load).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => { setOffset(0); }, [filter]);

  const sendReply = (id: string) =>
    run(
      id,
      async () => {
        if (!reply.trim()) throw new Error("Write a reply before sending.");
        await api(`/admin/tickets/${id}`, {
          method: "PATCH", auth: true,
          body: JSON.stringify({ admin_reply: reply, status: "resolved" }),
        });
        setReplyOpen(null);
        setReply("");
        await load();
      },
      "Reply sent and ticket resolved."
    );

  const setStatus = (id: string, status: Ticket["status"]) =>
    run(
      id,
      async () => {
        await api(`/admin/tickets/${id}`, {
          method: "PATCH", auth: true, body: JSON.stringify({ status }),
        });
        await load();
      },
      `Ticket marked ${status}.`
    );

  return (
    <View>
      <PageHeader
        title="Support tickets"
        subtitle="Reply, resolve and keep an eye on what's been waiting."
        right={
          <View style={styles.filters}>
            {(["all", "open", "pending", "resolved"] as const).map((f) => (
              <Pressable key={f} testID={`filter-${f}`} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
                <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f[0].toUpperCase() + f.slice(1)}</Text>
              </Pressable>
            ))}
          </View>
        }
      />

      {loading ? (
        <Loading label="Loading tickets…" />
      ) : items.length === 0 ? (
        <Empty label={filter === "open" ? "No open tickets — inbox zero." : "No tickets here."} />
      ) : (
        <View style={{ gap: 16 }}>
          <ResultCount shown={items.length} total={total} />
          {items.map((t) => {
            const a = age(t.created_at);
            return (
            <Card key={t.ticket_id}>
              <View style={styles.head}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subject}>{t.subject}</Text>
                  <Text style={styles.meta}>{t.user_name} · {t.user_email} · {new Date(t.created_at).toLocaleString()}</Text>
                </View>
                {t.status !== "resolved" ? (
                  <Pill label={a.label} tone={a.stale ? "err" : "neutral"} />
                ) : null}
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
                    <Btn testID={`send-${t.ticket_id}`} tone="primary" label="Send & resolve" busy={isBusy(t.ticket_id)} onPress={() => sendReply(t.ticket_id)} />
                    <Btn testID={`cancel-${t.ticket_id}`} tone="secondary" label="Cancel" onPress={() => { setReplyOpen(null); setReply(""); }} />
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                  <Btn testID={`reply-${t.ticket_id}`} small tone="primary" label={t.admin_reply ? "Update reply" : "Reply"} onPress={() => { setReplyOpen(t.ticket_id); setReply(t.admin_reply || ""); }} />
                  {t.status !== "resolved" ? (
                    <Btn testID={`resolve-${t.ticket_id}`} small tone="success" label="Mark resolved" busy={isBusy(t.ticket_id)} onPress={() => setStatus(t.ticket_id, "resolved")} />
                  ) : null}
                  {t.status === "resolved" ? (
                    <Btn testID={`reopen-${t.ticket_id}`} small tone="secondary" label="Reopen" busy={isBusy(t.ticket_id)} onPress={() => setStatus(t.ticket_id, "open")} />
                  ) : null}
                </View>
              )}
            </Card>
            );
          })}
          <Pagination offset={offset} limit={PAGE} total={total} onChange={setOffset} />
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
