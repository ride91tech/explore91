import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput } from "react-native";
import { Image } from "expo-image";
import { api } from "@/src/api";
import { colors, fonts, spacing, type as tType } from "@/src/theme";
import { PageHeader, Btn, Pill, Table, TableHead, TableRow, Cell, Empty, Card, Loading } from "@/src/components/admin/ui";
import { useAsyncAction } from "@/src/components/admin/feedback";

type Banner = {
  banner_id: string;
  title: string;
  subtitle?: string;
  image: string;
  link_url?: string | null;
  city?: string | null;
  position: string;
  is_active: boolean;
  sort_order: number;
};

const POSITIONS = ["home_hero", "home_promo", "reels_promo"];

export default function BannersAdmin() {
  const [items, setItems] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [image, setImage] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [city, setCity] = useState("");
  const [position, setPosition] = useState("home_promo");
  const { run, isBusy } = useAsyncAction();

  const load = useCallback(async () => {
    setItems(await api<Banner[]>("/admin/banners", { auth: true }));
  }, []);

  useEffect(() => {
    run("load", load).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = () =>
    run(
      "add",
      async () => {
        if (!title.trim()) throw new Error("Title is required.");
        if (!/^https:\/\//.test(image)) throw new Error("Image must be an https:// URL.");
        if (linkUrl && !/^https:\/\//.test(linkUrl)) throw new Error("Link URL must be an https:// URL.");
        await api("/admin/banners", {
          method: "POST", auth: true,
          body: JSON.stringify({
            title, subtitle: subtitle || null, image,
            link_url: linkUrl || null, city: city || null, position,
            is_active: true, sort_order: 0,
          }),
        });
        setTitle(""); setSubtitle(""); setImage(""); setLinkUrl(""); setCity("");
        await load();
      },
      "Banner published."
    );

  const toggle = (b: Banner) =>
    run(
      b.banner_id,
      async () => {
        await api(`/admin/banners/${b.banner_id}`, {
          method: "PATCH", auth: true, body: JSON.stringify({ is_active: !b.is_active }),
        });
        await load();
      },
      b.is_active ? "Banner paused." : "Banner is live again."
    );

  const del = (b: Banner) => {
    if (typeof window !== "undefined" &&
        !window.confirm(`Delete the banner "${b.title}"?\n\nThis cannot be undone.`)) {
      return;
    }
    run(b.banner_id, async () => {
      await api(`/admin/banners/${b.banner_id}`, { method: "DELETE", auth: true });
      await load();
    }, "Banner deleted.");
  };

  return (
    <View>
      <PageHeader title="Banners & Ads" subtitle={`${items.length} configured campaigns`} />

      <Card style={{ marginBottom: 24 }}>
        <Text style={styles.section}>New banner</Text>
        <Text style={styles.hint}>Promo & sponsored placements shown on Home / Reels feed.</Text>
        <View style={styles.grid}>
          <TextInput placeholder="Title" placeholderTextColor={colors.onSurfaceTertiary} value={title} onChangeText={setTitle} style={styles.input} />
          <TextInput placeholder="Subtitle (optional)" placeholderTextColor={colors.onSurfaceTertiary} value={subtitle} onChangeText={setSubtitle} style={styles.input} />
          <TextInput placeholder="Image URL (https://…)" placeholderTextColor={colors.onSurfaceTertiary} value={image} onChangeText={setImage} style={styles.input} />
          <TextInput placeholder="Link URL (optional)" placeholderTextColor={colors.onSurfaceTertiary} value={linkUrl} onChangeText={setLinkUrl} style={styles.input} />
          <TextInput placeholder="City (blank = all)" placeholderTextColor={colors.onSurfaceTertiary} value={city} onChangeText={(s) => setCity(s.toLowerCase())} style={styles.input} />
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            {POSITIONS.map((p) => (
              <Btn
                key={p}
                small
                tone={position === p ? "primary" : "secondary"}
                label={p}
                onPress={() => setPosition(p)}
              />
            ))}
          </View>
        </View>
        <View style={{ marginTop: 12, alignItems: "flex-start" }}>
          <Btn testID="banner-add" label="Publish banner" busy={isBusy("add")} onPress={add} />
        </View>
      </Card>

      {loading ? (
        <Loading label="Loading banners…" />
      ) : (
        <Table>
          <TableHead cols={[{ label: "Banner", width: 3 }, { label: "Position", width: 1.2 }, { label: "City", width: 1 }, { label: "Status", width: 1 }, { label: "Actions", width: 2 }]} />
          {items.length === 0 ? <Empty /> : items.map((b) => (
            <TableRow key={b.banner_id}>
              <Cell width={3}>
                <View style={styles.row}>
                  <Image source={{ uri: b.image }} style={styles.thumb} contentFit="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bTitle}>{b.title}</Text>
                    {b.subtitle ? <Text style={styles.bSub} numberOfLines={1}>{b.subtitle}</Text> : null}
                  </View>
                </View>
              </Cell>
              <Cell width={1.2}><Text style={styles.slug}>{b.position}</Text></Cell>
              <Cell width={1}>{b.city ?? "all"}</Cell>
              <Cell width={1}>
                <Pill label={b.is_active ? "Live" : "Paused"} tone={b.is_active ? "ok" : "neutral"} />
              </Cell>
              <Cell width={2}>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <Btn testID={`bn-toggle-${b.banner_id}`} small tone="secondary" label={b.is_active ? "Pause" : "Resume"} busy={isBusy(b.banner_id)} onPress={() => toggle(b)} />
                  <Btn testID={`bn-del-${b.banner_id}`} small tone="danger" label="Delete" busy={isBusy(b.banner_id)} onPress={() => del(b)} />
                </View>
              </Cell>
            </TableRow>
          ))}
        </Table>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 16, fontFamily: fonts.bodyBold, color: colors.onSurface },
  hint: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 16 },
  input: { minWidth: 240, flexGrow: 1, height: 40, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, color: colors.onSurface, fontSize: tType.base },

  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: 64, height: 40, borderRadius: 6, backgroundColor: colors.surfaceTertiary },
  bTitle: { fontSize: tType.base, fontFamily: fonts.display, color: colors.onSurface },
  bSub: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 2 },
  slug: { fontFamily: "monospace", fontSize: tType.sm, color: colors.onSurface },
  err: { color: colors.error, marginTop: 12, fontSize: tType.sm },
});
