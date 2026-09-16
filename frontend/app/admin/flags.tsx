import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TextInput, Pressable } from "react-native";
import { api } from "@/src/api";
import { colors, spacing, type as tType } from "@/src/theme";
import { PageHeader, Btn, Pill, Table, TableHead, TableRow, Cell, Empty, Card } from "@/src/components/admin/ui";

type Flag = {
  flag_id: string;
  entity_type: "user" | "business" | "booking" | "review" | "reel";
  entity_id: string;
  reason: string;
  status: "open" | "resolved";
  created_at: string;
};

const TYPES: Flag["entity_type"][] = ["user", "business", "booking", "review", "reel"];

export default function Flags() {
  const [items, setItems] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("open");

  const [entityType, setEntityType] = useState<Flag["entity_type"]>("business");
  const [entityId, setEntityId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = filter === "all" ? "" : `?status=${filter}`;
      const list = await api<Flag[]>(`/admin/flags${qs}`, { auth: true });
      setItems(list);
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const add = async () => {
    setErr(null);
    if (!entityId.trim() || !reason.trim()) return setErr("Entity ID and reason are required.");
    setBusy(true);
    try {
      await api("/admin/flags", {
        method: "POST", auth: true,
        body: JSON.stringify({ entity_type: entityType, entity_id: entityId.trim(), reason: reason.trim() }),
      });
      setEntityId(""); setReason("");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create flag");
    } finally { setBusy(false); }
  };

  const resolve = async (id: string) => {
    await api(`/admin/flags/${id}/resolve`, { method: "PATCH", auth: true });
    load();
  };

  return (
    <View>
      <PageHeader
        title="Fraud flags"
        subtitle={`${items.length} entries · Flag suspicious entities & track resolution`}
        right={
          <View style={styles.filters}>
            {(["all", "open", "resolved"] as const).map((f) => (
              <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
                <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f[0].toUpperCase() + f.slice(1)}</Text>
              </Pressable>
            ))}
          </View>
        }
      />

      <Card style={{ marginBottom: 24 }}>
        <Text style={styles.section}>Flag an entity</Text>
        <Text style={styles.hint}>Log suspicious users, businesses, bookings, reviews or reels here.</Text>
        <View style={styles.form}>
          <View style={styles.typeRow}>
            {TYPES.map((t) => (
              <Btn key={t} small tone={entityType === t ? "primary" : "secondary"} label={t} onPress={() => setEntityType(t)} />
            ))}
          </View>
          <TextInput placeholder="Entity ID (e.g. biz_xxx / user_xxx)" placeholderTextColor={colors.onSurfaceTertiary} value={entityId} onChangeText={setEntityId} style={styles.input} />
          <TextInput placeholder="Reason" placeholderTextColor={colors.onSurfaceTertiary} value={reason} onChangeText={setReason} multiline style={[styles.input, { minHeight: 60, textAlignVertical: "top", paddingTop: 10 }]} />
          <View style={{ alignItems: "flex-start" }}>
            <Btn testID="flag-add" label={busy ? "Flagging…" : "Flag"} onPress={add} disabled={busy} />
          </View>
        </View>
        {err ? <Text style={styles.err}>{err}</Text> : null}
      </Card>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} />
      ) : (
        <Table>
          <TableHead cols={[{ label: "Type", width: 1 }, { label: "Entity ID", width: 1.6 }, { label: "Reason", width: 3 }, { label: "Status", width: 1 }, { label: "Created", width: 1.4 }, { label: "Actions", width: 1 }]} />
          {items.length === 0 ? <Empty /> : items.map((f) => (
            <TableRow key={f.flag_id}>
              <Cell width={1}><Pill label={f.entity_type} tone="neutral" /></Cell>
              <Cell width={1.6}><Text style={styles.mono}>{f.entity_id}</Text></Cell>
              <Cell width={3}>{f.reason}</Cell>
              <Cell width={1}><Pill label={f.status} tone={f.status === "resolved" ? "ok" : "warn"} /></Cell>
              <Cell width={1.4}>{new Date(f.created_at).toLocaleString()}</Cell>
              <Cell width={1}>
                {f.status === "open" ? (
                  <Btn testID={`resolve-${f.flag_id}`} small tone="success" label="Resolve" onPress={() => resolve(f.flag_id)} />
                ) : (
                  <Text style={styles.readonly}>Closed</Text>
                )}
              </Cell>
            </TableRow>
          ))}
        </Table>
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

  section: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  hint: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 4 },
  form: { marginTop: 16, gap: 12 },
  typeRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  input: { minHeight: 40, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, color: colors.onSurface, fontSize: tType.base },
  mono: { fontFamily: "monospace", fontSize: tType.sm, color: colors.onSurface },
  readonly: { fontSize: tType.sm, color: colors.onSurfaceTertiary, fontStyle: "italic" },
  err: { color: colors.error, marginTop: 12, fontSize: tType.sm },
});
