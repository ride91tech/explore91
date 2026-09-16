import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { apiPaged, api, Business } from "@/src/api";
import { colors, spacing, type as tType } from "@/src/theme";
import {
  PageHeader, Btn, Pill, Table, TableHead, TableRow, Cell, Empty,
  SearchInput, Pagination, ResultCount, Loading,
} from "@/src/components/admin/ui";
import { useAsyncAction } from "@/src/components/admin/feedback";

type Row = Business & { is_approved?: boolean };
type Filter = "all" | "pending" | "featured";

const PAGE = 25;

export default function BusinessesAdmin() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>(
    params.filter === "pending" ? "pending" : "all"
  );
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const { run, isBusy } = useAsyncAction();

  const load = useCallback(async () => {
    const search = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (filter === "pending") search.append("pending", "true");
    if (filter === "featured") search.append("featured", "true");
    if (q.trim()) search.append("q", q.trim());
    const res = await apiPaged<Row>(`/admin/businesses?${search}`, { auth: true });
    setRows(res.rows);
    setTotal(res.total);
  }, [filter, q, offset]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      run("load", load).finally(() => setLoading(false));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => { setOffset(0); }, [filter, q]);

  const approve = (b: Row) =>
    run(
      b.business_id,
      async () => {
        await api(`/admin/businesses/${b.business_id}/approve`, { method: "PATCH", auth: true });
        await load();
      },
      `${b.name} approved and now live.`
    );

  const feature = (b: Row) =>
    run(
      b.business_id,
      async () => {
        await api(`/admin/businesses/${b.business_id}/feature`, { method: "PATCH", auth: true });
        await load();
      },
      b.is_featured ? `${b.name} removed from Featured.` : `${b.name} is now Featured.`
    );

  const remove = (b: Row) => {
    if (typeof window !== "undefined" &&
        !window.confirm(`Delete "${b.name}" permanently?\n\nAny reels linked to it will also be removed. This cannot be undone.`)) {
      return;
    }
    run(
      b.business_id,
      async () => {
        await api(`/admin/businesses/${b.business_id}`, { method: "DELETE", auth: true });
        await load();
      },
      `${b.name} deleted.`
    );
  };

  const flag = (b: Row) =>
    router.push(`/admin/flags?entity_type=business&entity_id=${b.business_id}` as any);

  return (
    <View>
      <PageHeader
        title="Businesses"
        subtitle="Approve, feature, flag or remove listings."
        right={
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <SearchInput
              testID="biz-search"
              value={q}
              onChangeText={setQ}
              placeholder="Search name, city, address…"
              width={250}
            />
            <View style={styles.filters}>
              {(["all", "pending", "featured"] as Filter[]).map((f) => (
                <Pressable
                  key={f}
                  testID={`filter-${f}`}
                  onPress={() => setFilter(f)}
                  style={[styles.filterChip, filter === f && styles.filterChipActive]}
                >
                  <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                    {f[0].toUpperCase() + f.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
      />

      {loading ? (
        <Loading label="Loading businesses…" />
      ) : (
        <>
          <ResultCount shown={rows.length} total={total} />
          <Table>
            <TableHead
              cols={[
                { label: "Business", width: 3 },
                { label: "Category", width: 1 },
                { label: "City", width: 1 },
                { label: "Status", width: 1.4 },
                { label: "Actions", width: 3 },
              ]}
            />
            {rows.length === 0 ? (
              <Empty
                label={
                  q ? `No businesses match "${q}".`
                    : filter === "pending" ? "Nothing awaiting review — you're all caught up."
                    : "No listings yet."
                }
              />
            ) : (
              rows.map((b) => (
                <TableRow key={b.business_id}>
                  <Cell width={3}>
                    <View style={styles.bizCell}>
                      <Image source={{ uri: b.cover_image }} style={styles.bizImg} contentFit="cover" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.bizName} numberOfLines={1}>{b.name}</Text>
                        <Text style={styles.bizSub} numberOfLines={1}>{b.address}</Text>
                      </View>
                    </View>
                  </Cell>
                  <Cell width={1}>{b.category}</Cell>
                  <Cell width={1}>{b.city}</Cell>
                  <Cell width={1.4}>
                    <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
                      <Pill
                        label={b.is_approved ? "Approved" : "Pending"}
                        tone={b.is_approved ? "ok" : "warn"}
                      />
                      {b.is_featured ? <Pill label="Featured" tone="brand" /> : null}
                    </View>
                  </Cell>
                  <Cell width={3}>
                    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                      {!b.is_approved ? (
                        <Btn
                          testID={`approve-${b.business_id}`}
                          small
                          tone="success"
                          label="Approve"
                          busy={isBusy(b.business_id)}
                          onPress={() => approve(b)}
                        />
                      ) : null}
                      <Btn
                        testID={`feature-${b.business_id}`}
                        small
                        tone="primary"
                        label={b.is_featured ? "Unfeature" : "Feature"}
                        busy={isBusy(b.business_id)}
                        onPress={() => feature(b)}
                      />
                      <Btn
                        testID={`flag-${b.business_id}`}
                        small
                        tone="secondary"
                        label="Flag"
                        onPress={() => flag(b)}
                      />
                      <Btn
                        testID={`delete-${b.business_id}`}
                        small
                        tone="danger"
                        label="Delete"
                        busy={isBusy(b.business_id)}
                        onPress={() => remove(b)}
                      />
                    </View>
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
  filterChip: { paddingHorizontal: 14, height: 30, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  filterChipActive: { backgroundColor: colors.brandPrimary },
  filterText: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  filterTextActive: { color: "#FFF" },

  bizCell: { flexDirection: "row", alignItems: "center", gap: 12 },
  bizImg: { width: 48, height: 48, borderRadius: 8, backgroundColor: colors.surfaceTertiary },
  bizName: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface },
  bizSub: { fontSize: tType.sm, color: colors.onSurfaceTertiary },
});
