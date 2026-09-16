import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TextInput, Pressable } from "react-native";
import { Image } from "expo-image";
import { api, Business } from "@/src/api";
import { colors, spacing, type as tType } from "@/src/theme";
import { PageHeader, Btn, Pill, Table, TableHead, TableRow, Cell, Empty } from "@/src/components/admin/ui";

type Filter = "all" | "pending" | "featured";

export default function BusinessesAdmin() {
  const [items, setItems] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const qs = filter === "pending" ? "?pending=true" : "";
      const list = await api<Business[]>(`/admin/businesses${qs}`, { auth: true });
      const filtered = filter === "featured" ? list.filter((b: any) => b.is_featured) : list;
      setItems(filtered);
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const approve = async (id: string) => {
    await api(`/admin/businesses/${id}/approve`, { method: "PATCH", auth: true });
    load();
  };
  const feature = async (id: string) => {
    await api(`/admin/businesses/${id}/feature`, { method: "PATCH", auth: true });
    load();
  };
  const del = async (id: string) => {
    if (typeof window !== "undefined" && !window.confirm("Delete this business? Reels linked to it will also be removed.")) return;
    await api(`/admin/businesses/${id}`, { method: "DELETE", auth: true });
    load();
  };

  const filtered = q
    ? items.filter((b) => (b.name + " " + b.category + " " + b.city).toLowerCase().includes(q.toLowerCase()))
    : items;

  return (
    <View>
      <PageHeader
        title="Businesses"
        subtitle={`${items.length} listings · Approve, feature or remove`}
        right={
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <TextInput
              placeholder="Search"
              placeholderTextColor={colors.onSurfaceTertiary}
              value={q}
              onChangeText={setQ}
              style={styles.search}
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
        <ActivityIndicator color={colors.brandPrimary} />
      ) : (
        <Table>
          <TableHead
            cols={[
              { label: "Business", width: 3 },
              { label: "Category", width: 1 },
              { label: "City", width: 1 },
              { label: "Status", width: 1.4 },
              { label: "Actions", width: 2.5 },
            ]}
          />
          {filtered.length === 0 ? (
            <Empty label="No matching businesses." />
          ) : (
            filtered.map((b) => (
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
                      label={(b as any).is_approved ? "Approved" : "Pending"}
                      tone={(b as any).is_approved ? "ok" : "warn"}
                    />
                    {b.is_featured ? <Pill label="Featured" tone="brand" /> : null}
                  </View>
                </Cell>
                <Cell width={2.5}>
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    {!(b as any).is_approved ? (
                      <Btn testID={`approve-${b.business_id}`} small tone="success" label="Approve" onPress={() => approve(b.business_id)} />
                    ) : null}
                    <Btn testID={`feature-${b.business_id}`} small tone="primary" label={b.is_featured ? "Unfeature" : "Feature"} onPress={() => feature(b.business_id)} />
                    <Btn testID={`delete-${b.business_id}`} small tone="danger" label="Delete" onPress={() => del(b.business_id)} />
                  </View>
                </Cell>
              </TableRow>
            ))
          )}
        </Table>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    width: 200, height: 40, borderRadius: 999, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
    paddingHorizontal: 16, color: colors.onSurface, fontSize: tType.base,
  },
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
