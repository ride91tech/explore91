import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { apiPaged, api } from "@/src/api";
import { colors, spacing, type as tType } from "@/src/theme";
import {
  PageHeader, Btn, Pill, Table, TableHead, TableRow, Cell, Empty, Card,
  Pagination, ResultCount, Loading,
} from "@/src/components/admin/ui";
import { useAsyncAction } from "@/src/components/admin/feedback";

type EntityType = "user" | "business" | "booking" | "review" | "reel";
type Flag = {
  flag_id: string;
  entity_type: EntityType;
  entity_id: string;
  reason: string;
  status: "open" | "resolved";
  created_at: string;
};

const TYPES: EntityType[] = ["user", "business", "booking", "review", "reel"];
const PAGE = 25;

export default function Flags() {
  // Populated when an admin hits "Flag" on a Users/Businesses/Reels row.
  const params = useLocalSearchParams<{ entity_type?: string; entity_id?: string }>();

  const [rows, setRows] = useState<Flag[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("open");
  const [offset, setOffset] = useState(0);

  const [entityType, setEntityType] = useState<EntityType>("business");
  const [entityId, setEntityId] = useState("");
  const [reason, setReason] = useState("");
  const { run, isBusy } = useAsyncAction();

  useEffect(() => {
    if (params.entity_id) setEntityId(String(params.entity_id));
    if (params.entity_type && TYPES.includes(params.entity_type as EntityType)) {
      setEntityType(params.entity_type as EntityType);
    }
  }, [params.entity_id, params.entity_type]);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (filter !== "all") qs.append("status", filter);
    const res = await apiPaged<Flag>(`/admin/flags?${qs}`, { auth: true });
    setRows(res.rows);
    setTotal(res.total);
  }, [filter, offset]);

  useEffect(() => {
    setLoading(true);
    run("load", load).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => { setOffset(0); }, [filter]);

  const add = () =>
    run(
      "add",
      async () => {
        if (!entityId.trim() || !reason.trim()) {
          throw new Error("Entity ID and reason are both required.");
        }
        await api("/admin/flags", {
          method: "POST",
          auth: true,
          body: JSON.stringify({
            entity_type: entityType,
            entity_id: entityId.trim(),
            reason: reason.trim(),
          }),
        });
        setEntityId("");
        setReason("");
        await load();
      },
      "Flag raised."
    );

  const resolve = (f: Flag) =>
    run(
      f.flag_id,
      async () => {
        await api(`/admin/flags/${f.flag_id}/resolve`, { method: "PATCH", auth: true });
        await load();
      },
      "Flag resolved."
    );

  const prefilled = !!params.entity_id;

  return (
    <View>
      <PageHeader
        title="Fraud flags"
        subtitle="Log suspicious entities and track resolution."
        right={
          <View style={styles.filters}>
            {(["all", "open", "resolved"] as const).map((f) => (
              <Pressable key={f} testID={`filter-${f}`} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
                <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
                  {f[0].toUpperCase() + f.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
        }
      />

      <Card style={{ marginBottom: 24, ...(prefilled ? { borderColor: colors.brandTertiary } : null) }}>
        <Text style={styles.section}>{prefilled ? "Flag this entity" : "Flag an entity"}</Text>
        <Text style={styles.hint}>
          {prefilled
            ? "Pre-filled from the row you came from — just add a reason."
            : "Tip: use the Flag button on a Users, Businesses or Reels row to skip typing the ID."}
        </Text>
        <View style={styles.form}>
          <View style={styles.typeRow}>
            {TYPES.map((t) => (
              <Btn
                key={t}
                small
                tone={entityType === t ? "primary" : "secondary"}
                label={t}
                onPress={() => setEntityType(t)}
              />
            ))}
          </View>
          <TextInput
            testID="flag-entity-id"
            placeholder="Entity ID (e.g. biz_xxx / user_xxx)"
            placeholderTextColor={colors.onSurfaceTertiary}
            value={entityId}
            onChangeText={setEntityId}
            style={styles.input}
          />
          <TextInput
            testID="flag-reason"
            placeholder="Reason"
            placeholderTextColor={colors.onSurfaceTertiary}
            value={reason}
            onChangeText={setReason}
            multiline
            style={[styles.input, { minHeight: 60, textAlignVertical: "top", paddingTop: 10 }]}
          />
          <View style={{ alignItems: "flex-start" }}>
            <Btn testID="flag-add" label="Raise flag" busy={isBusy("add")} onPress={add} />
          </View>
        </View>
      </Card>

      {loading ? (
        <Loading label="Loading flags…" />
      ) : (
        <>
          <ResultCount shown={rows.length} total={total} />
          <Table>
            <TableHead
              cols={[
                { label: "Type", width: 1 },
                { label: "Entity ID", width: 1.6 },
                { label: "Reason", width: 3 },
                { label: "Status", width: 1 },
                { label: "Created", width: 1.4 },
                { label: "Actions", width: 1 },
              ]}
            />
            {rows.length === 0 ? (
              <Empty label={filter === "open" ? "No open flags — nothing needs attention." : "No flags here."} />
            ) : (
              rows.map((f) => (
                <TableRow key={f.flag_id}>
                  <Cell width={1}><Pill label={f.entity_type} tone="neutral" /></Cell>
                  <Cell width={1.6}><Text style={styles.mono}>{f.entity_id}</Text></Cell>
                  <Cell width={3}>{f.reason}</Cell>
                  <Cell width={1}><Pill label={f.status} tone={f.status === "resolved" ? "ok" : "warn"} /></Cell>
                  <Cell width={1.4}>{new Date(f.created_at).toLocaleString()}</Cell>
                  <Cell width={1}>
                    {f.status === "open" ? (
                      <Btn
                        testID={`resolve-${f.flag_id}`}
                        small
                        tone="success"
                        label="Resolve"
                        busy={isBusy(f.flag_id)}
                        onPress={() => resolve(f)}
                      />
                    ) : (
                      <Text style={styles.readonly}>Closed</Text>
                    )}
                  </Cell>
                </TableRow>
              ))
            )}
          </Table>
          <Pagination offset={offset} limit={PAGE} total={total} onChange={setOffset} />
        </>
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
});
