import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TextInput } from "react-native";
import { Image } from "expo-image";
import { api } from "@/src/api";
import { colors, spacing, type as tType } from "@/src/theme";
import { PageHeader, Btn, Pill, Table, TableHead, TableRow, Cell, Empty, Card } from "@/src/components/admin/ui";

type City = { slug: string; name: string; tagline: string; image: string; source?: string };

export default function CitiesAdmin() {
  const [items, setItems] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api<City[]>("/admin/cities", { auth: true });
      setItems(list);
    } catch (e) { console.log(e); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setErr(null);
    if (!/^[a-z0-9-]{2,32}$/.test(slug)) return setErr("Slug must be lowercase letters/numbers/hyphens, 2-32 chars.");
    if (!name.trim() || !tagline.trim()) return setErr("Name and tagline are required.");
    if (!/^https:\/\//.test(image)) return setErr("Image must be an https:// URL.");
    setBusy(true);
    try {
      await api("/admin/cities", { method: "POST", auth: true, body: JSON.stringify({ slug, name, tagline, image }) });
      setSlug(""); setName(""); setTagline(""); setImage("");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create city");
    } finally { setBusy(false); }
  };

  const del = async (s: string) => {
    if (typeof window !== "undefined" && !window.confirm(`Remove custom city '${s}'? (Built-ins can't be removed.)`)) return;
    try {
      await api(`/admin/cities/${s}`, { method: "DELETE", auth: true });
      await load();
    } catch (e: any) {
      if (typeof window !== "undefined") window.alert(e?.message ?? "Cannot delete");
    }
  };

  return (
    <View>
      <PageHeader title="Cities" subtitle={`${items.length} live cities`} />

      <Card style={{ marginBottom: 24 }}>
        <Text style={styles.section}>Launch a new city</Text>
        <Text style={styles.hint}>New cities show up on the customer app immediately, ready for business submissions.</Text>
        <View style={styles.form}>
          <TextInput placeholder="slug (e.g. bengaluru)" placeholderTextColor={colors.onSurfaceTertiary} value={slug} onChangeText={(s) => setSlug(s.toLowerCase())} style={[styles.input, { flex: 1 }]} />
          <TextInput placeholder="Display name" placeholderTextColor={colors.onSurfaceTertiary} value={name} onChangeText={setName} style={[styles.input, { flex: 1 }]} />
        </View>
        <TextInput placeholder="Tagline (e.g. Silicon Valley of India)" placeholderTextColor={colors.onSurfaceTertiary} value={tagline} onChangeText={setTagline} style={[styles.input, { marginTop: 12 }]} />
        <TextInput placeholder="Hero image URL (https://…)" placeholderTextColor={colors.onSurfaceTertiary} value={image} onChangeText={setImage} style={[styles.input, { marginTop: 12 }]} />
        <View style={{ marginTop: 12, alignItems: "flex-start" }}>
          <Btn testID="city-add" label={busy ? "Launching…" : "Launch city"} onPress={add} disabled={busy} />
        </View>
        {err ? <Text style={styles.err}>{err}</Text> : null}
      </Card>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} />
      ) : (
        <Table>
          <TableHead cols={[{ label: "City", width: 3 }, { label: "Slug", width: 1 }, { label: "Tagline", width: 3 }, { label: "Source", width: 1 }, { label: "Actions", width: 1 }]} />
          {items.length === 0 ? <Empty /> : items.map((c) => (
            <TableRow key={c.slug}>
              <Cell width={3}>
                <View style={styles.row}>
                  <Image source={{ uri: c.image }} style={styles.thumb} contentFit="cover" />
                  <Text style={styles.cityName}>{c.name}</Text>
                </View>
              </Cell>
              <Cell width={1}><Text style={styles.slug}>{c.slug}</Text></Cell>
              <Cell width={3}>{c.tagline}</Cell>
              <Cell width={1}><Pill label={c.source === "cms" ? "Custom" : "Built-in"} tone={c.source === "cms" ? "brand" : "neutral"} /></Cell>
              <Cell width={1}>
                {c.source === "cms" ? (
                  <Btn testID={`del-city-${c.slug}`} small tone="danger" label="Remove" onPress={() => del(c.slug)} />
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
  form: { flexDirection: "row", gap: 12, marginTop: 16 },
  input: { height: 40, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, color: colors.onSurface, fontSize: tType.base },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: 60, height: 40, borderRadius: 6, backgroundColor: colors.surfaceTertiary },
  cityName: { fontSize: tType.base, fontWeight: "700", color: colors.onSurface },
  slug: { fontFamily: "monospace", fontSize: tType.sm, color: colors.onSurface },
  readonly: { fontSize: tType.sm, color: colors.onSurfaceTertiary, fontStyle: "italic" },
  err: { color: colors.error, marginTop: 12, fontSize: tType.sm },
});
