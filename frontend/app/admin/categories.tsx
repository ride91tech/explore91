import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TextInput } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { api } from "@/src/api";
import { colors, spacing, type as tType } from "@/src/theme";
import { PageHeader, Btn, Pill, Table, TableHead, TableRow, Cell, Empty, Card } from "@/src/components/admin/ui";

type Cat = { slug: string; name: string; icon: string; source?: string };

export default function CategoriesAdmin() {
  const [items, setItems] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("apps-outline");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api<Cat[]>("/admin/categories", { auth: true });
      setItems(list);
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setErr(null);
    if (!/^[a-z0-9-]{2,32}$/.test(slug)) return setErr("Slug must be lowercase letters/numbers/hyphens, 2-32 chars.");
    if (!name.trim() || !icon.trim()) return setErr("Name and icon are required.");
    setBusy(true);
    try {
      await api("/admin/categories", { method: "POST", auth: true, body: JSON.stringify({ slug, name, icon }) });
      setSlug(""); setName(""); setIcon("apps-outline");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create category");
    } finally { setBusy(false); }
  };

  const del = async (s: string) => {
    if (typeof window !== "undefined" && !window.confirm(`Remove custom category '${s}'? (Built-ins can't be removed.)`)) return;
    try {
      await api(`/admin/categories/${s}`, { method: "DELETE", auth: true });
      await load();
    } catch (e: any) {
      if (typeof window !== "undefined") window.alert(e?.message ?? "Cannot delete");
    }
  };

  return (
    <View>
      <PageHeader title="Categories" subtitle={`${items.length} total (defaults + custom)`} />

      <Card style={{ marginBottom: 24 }}>
        <Text style={styles.section}>Add a new category</Text>
        <Text style={styles.hint}>New categories become available immediately in the customer app.</Text>
        <View style={styles.form}>
          <TextInput placeholder="slug (e.g. yoga-studios)" placeholderTextColor={colors.onSurfaceTertiary} value={slug} onChangeText={(s) => setSlug(s.toLowerCase())} style={styles.input} />
          <TextInput placeholder="Display name" placeholderTextColor={colors.onSurfaceTertiary} value={name} onChangeText={setName} style={styles.input} />
          <TextInput placeholder="Ionicons icon (e.g. leaf-outline)" placeholderTextColor={colors.onSurfaceTertiary} value={icon} onChangeText={setIcon} style={styles.input} />
          <Btn testID="cat-add" label={busy ? "Adding…" : "Add category"} onPress={add} disabled={busy} />
        </View>
        {err ? <Text style={styles.err}>{err}</Text> : null}
      </Card>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} />
      ) : (
        <Table>
          <TableHead cols={[{ label: "Icon", width: 0.6 }, { label: "Slug", width: 1.4 }, { label: "Name", width: 2 }, { label: "Source", width: 1 }, { label: "Actions", width: 1 }]} />
          {items.length === 0 ? <Empty /> : items.map((c) => (
            <TableRow key={c.slug}>
              <Cell width={0.6}><Ionicons name={c.icon as any} size={20} color={colors.onSurface} /></Cell>
              <Cell width={1.4}><Text style={styles.slug}>{c.slug}</Text></Cell>
              <Cell width={2}>{c.name}</Cell>
              <Cell width={1}><Pill label={c.source === "cms" ? "Custom" : "Built-in"} tone={c.source === "cms" ? "brand" : "neutral"} /></Cell>
              <Cell width={1}>
                {c.source === "cms" ? (
                  <Btn testID={`del-cat-${c.slug}`} small tone="danger" label="Remove" onPress={() => del(c.slug)} />
                ) : (
                  <Text style={styles.readonly}>Read-only</Text>
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
  section: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  hint: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 4 },
  form: { flexDirection: "row", gap: 12, marginTop: 16, flexWrap: "wrap", alignItems: "center" },
  input: { flex: 1, minWidth: 200, height: 40, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, color: colors.onSurface, fontSize: tType.base },
  slug: { fontFamily: "monospace", fontSize: tType.sm, color: colors.onSurface },
  readonly: { fontSize: tType.sm, color: colors.onSurfaceTertiary, fontStyle: "italic" },
  err: { color: colors.error, marginTop: 12, fontSize: tType.sm },
});
