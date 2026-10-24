import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { apiPaged, api, ReelT } from "@/src/api";
import { colors, fonts, spacing, type as tType } from "@/src/theme";
import {
  PageHeader, Btn, Pill, Table, TableHead, TableRow, Cell, Empty,
  SearchInput, Pagination, ResultCount, Loading,
} from "@/src/components/admin/ui";
import { useAsyncAction } from "@/src/components/admin/feedback";

type ReelRow = ReelT & { is_hidden?: boolean };
type Filter = "all" | "visible" | "hidden";

const PAGE = 25;

export default function ReelsAdmin() {
  const router = useRouter();
  const [rows, setRows] = useState<ReelRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const { run, isBusy } = useAsyncAction();

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (filter === "visible") params.append("hidden", "false");
    if (filter === "hidden") params.append("hidden", "true");
    if (q.trim()) params.append("q", q.trim());
    const res = await apiPaged<ReelRow>(`/admin/reels?${params}`, { auth: true });
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

  const toggle = (r: ReelRow) =>
    run(
      r.reel_id,
      async () => {
        await api(`/admin/reels/${r.reel_id}/visibility`, { method: "PATCH", auth: true });
        await load();
      },
      r.is_hidden ? "Reel is visible again." : "Reel hidden from the feed."
    );

  const remove = (r: ReelRow) => {
    if (typeof window !== "undefined" &&
        !window.confirm(`Delete this reel permanently?\n\n"${r.caption}"\n\nLikes on it will also be removed. This cannot be undone.`)) {
      return;
    }
    run(
      r.reel_id,
      async () => {
        await api(`/admin/reels/${r.reel_id}`, { method: "DELETE", auth: true });
        await load();
      },
      "Reel deleted."
    );
  };

  const flag = (r: ReelRow) =>
    router.push(`/admin/flags?entity_type=reel&entity_id=${r.reel_id}` as any);

  return (
    <View>
      <PageHeader
        title="Reels"
        subtitle="Moderate the short-video feed — hide, delete or flag."
        right={
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <SearchInput
              testID="reels-search"
              value={q}
              onChangeText={setQ}
              placeholder="Search caption, business…"
              width={240}
            />
            <View style={styles.filters}>
              {(["all", "visible", "hidden"] as Filter[]).map((f) => (
                <Pressable
                  key={f}
                  testID={`filter-${f}`}
                  onPress={() => setFilter(f)}
                  style={[styles.chip, filter === f && styles.chipActive]}
                >
                  <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
                    {f[0].toUpperCase() + f.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
      />

      {loading ? (
        <Loading label="Loading reels…" />
      ) : (
        <>
          <ResultCount shown={rows.length} total={total} />
          <Table>
            <TableHead
              cols={[
                { label: "Reel", width: 3 },
                { label: "Business", width: 1.6 },
                { label: "City", width: 1 },
                { label: "Engagement", width: 1.2 },
                { label: "Status", width: 1 },
                { label: "Actions", width: 2.4 },
              ]}
            />
            {rows.length === 0 ? (
              <Empty label={q ? `No reels match "${q}".` : "No reels yet."} />
            ) : (
              rows.map((r) => (
                <TableRow key={r.reel_id}>
                  <Cell width={3}>
                    <View style={styles.reelCell}>
                      <Image source={{ uri: r.cover_image }} style={styles.thumb} contentFit="cover" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.caption} numberOfLines={2}>{r.caption}</Text>
                        <Text style={styles.meta}>@{r.author}</Text>
                      </View>
                    </View>
                  </Cell>
                  <Cell width={1.6}>{r.business_name ?? "—"}</Cell>
                  <Cell width={1}>{r.city}</Cell>
                  <Cell width={1.2}>
                    <Text style={styles.meta}>
                      {(r.likes ?? 0).toLocaleString()} likes{"\n"}
                      {(r.views ?? 0).toLocaleString()} views
                    </Text>
                  </Cell>
                  <Cell width={1}>
                    <Pill label={r.is_hidden ? "Hidden" : "Live"} tone={r.is_hidden ? "err" : "ok"} />
                  </Cell>
                  <Cell width={2.4}>
                    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                      <Btn
                        testID={`visibility-${r.reel_id}`}
                        small
                        tone={r.is_hidden ? "success" : "secondary"}
                        label={r.is_hidden ? "Unhide" : "Hide"}
                        busy={isBusy(r.reel_id)}
                        onPress={() => toggle(r)}
                      />
                      <Btn
                        testID={`flag-${r.reel_id}`}
                        small
                        tone="secondary"
                        label="Flag"
                        onPress={() => flag(r)}
                      />
                      <Btn
                        testID={`delete-${r.reel_id}`}
                        small
                        tone="danger"
                        label="Delete"
                        busy={isBusy(r.reel_id)}
                        onPress={() => remove(r)}
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
  chip: { paddingHorizontal: 14, height: 30, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { fontSize: 12, fontFamily: fonts.bodyBold, color: colors.onSurface },
  chipTextActive: { color: "#FFF" },

  reelCell: { flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: 44, height: 60, borderRadius: 6, backgroundColor: colors.surfaceTertiary },
  caption: { fontSize: tType.sm, fontFamily: fonts.bodySemi, color: colors.onSurface, lineHeight: 18 },
  meta: { fontSize: 11, color: colors.onSurfaceTertiary, marginTop: 2, lineHeight: 15 },
});
