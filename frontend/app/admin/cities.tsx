import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput } from "react-native";
import { Image } from "expo-image";
import { api } from "@/src/api";
import { colors, spacing, type as tType } from "@/src/theme";
import { PageHeader, Btn, Pill, Table, TableHead, TableRow, Cell, Empty, Card, Loading } from "@/src/components/admin/ui";
import { useAsyncAction } from "@/src/components/admin/feedback";

type City = {
  slug: string; name: string; state?: string; region?: string;
  tagline: string; image: string; source?: string;
  // How much there is to see. A city with no businesses shows as
  // "coming soon" in the app rather than as a browsable city.
  business_count?: number; reel_count?: number; is_live?: boolean;
};

export default function CitiesAdmin() {
  const [items, setItems] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const [region, setRegion] = useState("");
  const [tagline, setTagline] = useState("");
  const [image, setImage] = useState("");
  const { run, isBusy } = useAsyncAction();

  // Older API versions don't send is_live; treat those cities as live so the
  // console never under-reports against a backend that predates the field.
  const liveCount = items.filter((c) => c.is_live !== false).length;

  const load = useCallback(async () => {
    setItems(await api<City[]>("/admin/cities", { auth: true }));
  }, []);

  useEffect(() => {
    run("load", load).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = () =>
    run(
      "add",
      async () => {
        if (!/^[a-z0-9-]{2,32}$/.test(slug)) {
          throw new Error("Slug must be lowercase letters, numbers or hyphens (2–32 chars).");
        }
        if (!name.trim() || !tagline.trim()) throw new Error("Name and tagline are both required.");
        if (!state.trim()) throw new Error("State is required — it's what counts toward a traveller's journey.");
        if (!/^https:\/\//.test(image)) throw new Error("Image must be an https:// URL.");
        await api("/admin/cities", {
          method: "POST", auth: true,
          body: JSON.stringify({
            slug, name, tagline, image,
            state: state.trim(),
            // Blank region falls back to the state on the server.
            region: region.trim() || null,
          }),
        });
        setSlug(""); setName(""); setState(""); setRegion(""); setTagline(""); setImage("");
        await load();
      },
      "City launched — it's live in the app now."
    );

  const del = (s: string) => {
    if (typeof window !== "undefined" &&
        !window.confirm(`Remove custom city "${s}"?\n\nBusinesses already listed there will keep the city tag.`)) {
      return;
    }
    run(s, async () => {
      await api(`/admin/cities/${s}`, { method: "DELETE", auth: true });
      await load();
    }, "City removed.");
  };

  return (
    <View>
      <PageHeader
        title="Cities"
        subtitle={`${items.length} cities · ${liveCount} live · ${items.length - liveCount} awaiting content`}
      />

      <Card style={{ marginBottom: 24 }}>
        <Text style={styles.section}>Launch a new city</Text>
        <Text style={styles.hint}>
          A new city is listed as &ldquo;coming soon&rdquo; in the app until it has at least
          one business. Add listings before announcing it.
        </Text>
        <View style={styles.form}>
          <TextInput placeholder="slug (e.g. bengaluru)" placeholderTextColor={colors.onSurfaceTertiary} value={slug} onChangeText={(s) => setSlug(s.toLowerCase())} style={[styles.input, { flex: 1 }]} />
          <TextInput placeholder="Display name" placeholderTextColor={colors.onSurfaceTertiary} value={name} onChangeText={setName} style={[styles.input, { flex: 1 }]} />
        </View>
        <View style={[styles.form, { marginTop: 12 }]}>
          <TextInput testID="city-state" placeholder="State or UT (e.g. Karnataka)" placeholderTextColor={colors.onSurfaceTertiary} value={state} onChangeText={setState} style={[styles.input, { flex: 1 }]} />
          <TextInput testID="city-region" placeholder="Picker heading (blank = state)" placeholderTextColor={colors.onSurfaceTertiary} value={region} onChangeText={setRegion} style={[styles.input, { flex: 1 }]} />
        </View>
        <Text style={styles.subhint}>
          State counts toward a traveller&apos;s states-visited total. The heading is
          only how the city is grouped in the picker — Goa sits under &ldquo;West Coast&rdquo;,
          Delhi under &ldquo;Capital Region&rdquo;.
        </Text>
        <TextInput placeholder="Tagline (e.g. Silicon Valley of India)" placeholderTextColor={colors.onSurfaceTertiary} value={tagline} onChangeText={setTagline} style={[styles.input, { marginTop: 12 }]} />
        <TextInput placeholder="Hero image URL (https://…)" placeholderTextColor={colors.onSurfaceTertiary} value={image} onChangeText={setImage} style={[styles.input, { marginTop: 12 }]} />
        <View style={{ marginTop: 12, alignItems: "flex-start" }}>
          <Btn testID="city-add" label="Launch city" busy={isBusy("add")} onPress={add} />
        </View>
      </Card>

      {loading ? (
        <Loading label="Loading cities…" />
      ) : (
        <Table>
          <TableHead cols={[{ label: "City", width: 2.6 }, { label: "State", width: 1.3 }, { label: "Picker heading", width: 1.3 }, { label: "Content", width: 1.8 }, { label: "Tagline", width: 1.8 }, { label: "Source", width: 1 }, { label: "Actions", width: 1 }]} />
          {items.length === 0 ? <Empty /> : items.map((c) => (
            <TableRow key={c.slug}>
              <Cell width={2.6}>
                <View style={styles.row}>
                  <Image source={{ uri: c.image }} style={styles.thumb} contentFit="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cityName}>{c.name}</Text>
                    <Text style={styles.slug}>{c.slug}</Text>
                  </View>
                </View>
              </Cell>
              <Cell width={1.3}>
                {c.state ? c.state : <Text style={styles.missing}>Not set</Text>}
              </Cell>
              <Cell width={1.3}>{c.region || c.state || "—"}</Cell>
              <Cell width={1.8}>
                {c.is_live === false ? (
                  <Pill label="Coming soon" tone="warn" />
                ) : (
                  <Text style={styles.counts}>
                    {c.business_count ?? "—"} places · {c.reel_count ?? "—"} reels
                  </Text>
                )}
              </Cell>
              <Cell width={1.8}>{c.tagline}</Cell>
              <Cell width={1}><Pill label={c.source === "cms" ? "Custom" : "Built-in"} tone={c.source === "cms" ? "brand" : "neutral"} /></Cell>
              <Cell width={1}>
                {c.source === "cms" ? (
                  <Btn testID={`del-city-${c.slug}`} small tone="danger" label="Remove" busy={isBusy(c.slug)} onPress={() => del(c.slug)} />
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
  missing: { fontSize: tType.sm, color: colors.warning, fontStyle: "italic" },
  counts: { fontSize: tType.sm, color: colors.onSurfaceSecondary },
  subhint: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 8, lineHeight: 19 },
  readonly: { fontSize: tType.sm, color: colors.onSurfaceTertiary, fontStyle: "italic" },
  err: { color: colors.error, marginTop: 12, fontSize: tType.sm },
});
