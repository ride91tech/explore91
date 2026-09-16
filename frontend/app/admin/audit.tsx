import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { apiPaged } from "@/src/api";
import { colors, spacing, type as tType } from "@/src/theme";
import {
  PageHeader, Pill, Table, TableHead, TableRow, Cell, Empty,
  SearchInput, Pagination, ResultCount, Loading,
} from "@/src/components/admin/ui";
import { useAsyncAction } from "@/src/components/admin/feedback";

type Entry = {
  audit_id: string;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  note: string;
  created_at: string;
};

const PAGE = 25;

// Destructive actions get a red pill so they stand out when scanning history.
const DESTRUCTIVE = ["delete", "block"];

function tone(action: string): "err" | "warn" | "ok" | "neutral" {
  if (DESTRUCTIVE.some((d) => action.includes(d))) return "err";
  if (action.includes("approve") || action.includes("resolve")) return "ok";
  if (action.includes("create")) return "neutral";
  return "warn";
}

function describe(value: Record<string, any> | null): string {
  if (!value || Object.keys(value).length === 0) return "—";
  return Object.entries(value)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("  ·  ");
}

export default function AuditLog() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [entityId, setEntityId] = useState("");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { run } = useAsyncAction();

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (entityId.trim()) params.append("entity_id", entityId.trim());
    const res = await apiPaged<Entry>(`/admin/audit?${params}`, { auth: true });
    setRows(res.rows);
    setTotal(res.total);
  }, [entityId, offset]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      run("load", load).finally(() => setLoading(false));
    }, entityId ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => { setOffset(0); }, [entityId]);

  return (
    <View>
      <PageHeader
        title="Audit log"
        subtitle="Every admin action, who did it, and what changed."
        right={
          <SearchInput
            testID="audit-entity-filter"
            value={entityId}
            onChangeText={setEntityId}
            placeholder="Filter by entity ID…"
            width={260}
          />
        }
      />

      {loading ? (
        <Loading label="Loading audit history…" />
      ) : (
        <>
          <ResultCount shown={rows.length} total={total} />
          <Table>
            <TableHead
              cols={[
                { label: "When", width: 1.5 },
                { label: "Actor", width: 2 },
                { label: "Action", width: 1.5 },
                { label: "Entity", width: 2 },
                { label: "Change", width: 3 },
              ]}
            />
            {rows.length === 0 ? (
              <Empty
                label={
                  entityId
                    ? `No audit entries for "${entityId}".`
                    : "No admin actions recorded yet."
                }
              />
            ) : (
              rows.map((e) => {
                const open = expanded === e.audit_id;
                return (
                  <Pressable
                    key={e.audit_id}
                    onPress={() => setExpanded(open ? null : e.audit_id)}
                    accessibilityRole="button"
                  >
                    <TableRow>
                      <Cell width={1.5}>
                        <Text style={styles.when}>
                          {new Date(e.created_at).toLocaleDateString()}
                          {"\n"}
                          <Text style={styles.time}>{new Date(e.created_at).toLocaleTimeString()}</Text>
                        </Text>
                      </Cell>
                      <Cell width={2}>
                        <Text style={styles.actor} numberOfLines={1}>{e.actor_name ?? "—"}</Text>
                        <Text style={styles.actorEmail} numberOfLines={1}>{e.actor_email ?? "—"}</Text>
                      </Cell>
                      <Cell width={1.5}><Pill label={e.action} tone={tone(e.action)} /></Cell>
                      <Cell width={2}>
                        <Text style={styles.entityType}>{e.entity_type}</Text>
                        <Text style={styles.mono} numberOfLines={1}>{e.entity_id}</Text>
                      </Cell>
                      <Cell width={3}>
                        <Text style={styles.change} numberOfLines={open ? undefined : 2}>
                          {describe(e.after)}
                        </Text>
                        {e.note ? <Text style={styles.note}>{e.note}</Text> : null}
                      </Cell>
                    </TableRow>
                    {open ? (
                      <View style={styles.detail}>
                        <Text style={styles.detailLabel}>Before</Text>
                        <Text style={styles.detailBody}>{describe(e.before)}</Text>
                        <Text style={[styles.detailLabel, { marginTop: 10 }]}>After</Text>
                        <Text style={styles.detailBody}>{describe(e.after)}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </Table>
          <Pagination offset={offset} limit={PAGE} total={total} onChange={setOffset} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  when: { fontSize: tType.sm, color: colors.onSurface, fontWeight: "600", lineHeight: 18 },
  time: { fontSize: 11, color: colors.onSurfaceTertiary, fontWeight: "400" },
  actor: { fontSize: tType.sm, fontWeight: "700", color: colors.onSurface },
  actorEmail: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2 },
  entityType: { fontSize: 11, color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 1, fontWeight: "700" },
  mono: { fontFamily: "monospace", fontSize: 11, color: colors.onSurface, marginTop: 2 },
  change: { fontSize: tType.sm, color: colors.onSurface, lineHeight: 18 },
  note: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 4, fontStyle: "italic" },
  detail: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: colors.surfaceSecondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  detailLabel: { fontSize: 11, fontWeight: "700", color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 1, marginTop: 12 },
  detailBody: { fontSize: tType.sm, color: colors.onSurface, marginTop: 4, fontFamily: "monospace", lineHeight: 18 },
});
