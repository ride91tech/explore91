import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { api } from "@/src/api";
import { colors, fonts, spacing, type as tType } from "@/src/theme";
import { PageHeader, Btn, Pill, Table, TableHead, TableRow, Cell, Empty, Card, Loading } from "@/src/components/admin/ui";
import { useAsyncAction } from "@/src/components/admin/feedback";

type Cat = {
  slug: string;
  name: string;
  icon: string;
  source?: string;
  is_active?: boolean;
  /** Approved places carrying this category, so disabling is not a blind act. */
  business_count?: number;
};

export default function CategoriesAdmin() {
  const [items, setItems] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("apps-outline");
  const { run, isBusy } = useAsyncAction();

  const load = useCallback(async () => {
    setItems(await api<Cat[]>("/admin/categories", { auth: true }));
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
        if (!name.trim() || !icon.trim()) throw new Error("Name and icon are both required.");
        await api("/admin/categories", { method: "POST", auth: true, body: JSON.stringify({ slug, name, icon }) });
        setSlug(""); setName(""); setIcon("apps-outline");
        await load();
      },
      "Category added — it's live in the app now."
    );

  const toggle = (c: Cat) => {
    const next = !(c.is_active ?? true);
    // Disabling is reversible and touches no places, so it asks only when
    // there is something behind it to lose — a category with listings is one
    // people are finding places through.
    const places = c.business_count ?? 0;
    if (
      !next &&
      places > 0 &&
      typeof window !== "undefined" &&
      !window.confirm(
        `Disable "${c.name}"?

${places} place${places === 1 ? "" : "s"} ` +
        `use this category. They stay listed and keep the tag, but customers ` +
        `will no longer see "${c.name}" as a filter.`
      )
    ) {
      return;
    }
    run(
      c.slug,
      async () => {
        await api(`/admin/categories/${c.slug}`, {
          method: "PATCH",
          auth: true,
          body: JSON.stringify({ is_active: next }),
        });
        await load();
      },
      next ? `"${c.name}" is back in the app.` : `"${c.name}" hidden from the app.`
    );
  };

  const del = (s: string) => {
    if (typeof window !== "undefined" &&
        !window.confirm(`Remove custom category "${s}"?\n\nBusinesses already using it will keep the tag.`)) {
      return;
    }
    run(s, async () => {
      await api(`/admin/categories/${s}`, { method: "DELETE", auth: true });
      await load();
    }, "Category removed.");
  };

  return (
    <View>
      <PageHeader
        title="Categories"
        subtitle={`${items.length} total · ${items.filter((c) => c.is_active ?? true).length} live in the app · ${items.filter((c) => !(c.is_active ?? true)).length} hidden`}
      />

      <Card style={{ marginBottom: 24 }}>
        <Text style={styles.section}>Add a new category</Text>
        <Text style={styles.hint}>New categories become available immediately in the customer app.</Text>
        <View style={styles.form}>
          <TextInput placeholder="slug (e.g. yoga-studios)" placeholderTextColor={colors.onSurfaceTertiary} value={slug} onChangeText={(s) => setSlug(s.toLowerCase())} style={styles.input} />
          <TextInput placeholder="Display name" placeholderTextColor={colors.onSurfaceTertiary} value={name} onChangeText={setName} style={styles.input} />
          <TextInput placeholder="Ionicons icon (e.g. leaf-outline)" placeholderTextColor={colors.onSurfaceTertiary} value={icon} onChangeText={setIcon} style={styles.input} />
          <Btn testID="cat-add" label="Add category" busy={isBusy("add")} onPress={add} />
        </View>
      </Card>

      {loading ? (
        <Loading label="Loading categories…" />
      ) : (
        <Table>
          <TableHead cols={[{ label: "Icon", width: 0.6 }, { label: "Slug", width: 1.4 }, { label: "Name", width: 1.8 }, { label: "Places", width: 0.8 }, { label: "Status", width: 1 }, { label: "Source", width: 1 }, { label: "Actions", width: 1.6 }]} />
          {items.length === 0 ? <Empty /> : items.map((c) => {
            const active = c.is_active ?? true;
            return (
              <TableRow key={c.slug}>
                <Cell width={0.6}>
                  <Ionicons
                    name={c.icon as any}
                    size={20}
                    color={active ? colors.onSurface : colors.onSurfaceTertiary}
                  />
                </Cell>
                <Cell width={1.4}><Text style={styles.slug}>{c.slug}</Text></Cell>
                <Cell width={1.8}>
                  <Text style={active ? undefined : styles.dimmed}>{c.name}</Text>
                </Cell>
                <Cell width={0.8}>
                  <Text style={styles.count}>{c.business_count ?? 0}</Text>
                </Cell>
                <Cell width={1}>
                  <Pill label={active ? "Live" : "Hidden"} tone={active ? "ok" : "warn"} />
                </Cell>
                <Cell width={1}><Pill label={c.source === "cms" ? "Custom" : "Built-in"} tone={c.source === "cms" ? "brand" : "neutral"} /></Cell>
                <Cell width={1.6}>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    {/* Available for built-ins too — they cannot be deleted, so
                        this is the only control they have ever had. */}
                    <Btn
                      testID={`toggle-cat-${c.slug}`}
                      small
                      tone={active ? "secondary" : "success"}
                      label={active ? "Disable" : "Enable"}
                      busy={isBusy(c.slug)}
                      onPress={() => toggle(c)}
                    />
                    {c.source === "cms" ? (
                      <Btn testID={`del-cat-${c.slug}`} small tone="danger" label="Remove" busy={isBusy(c.slug)} onPress={() => del(c.slug)} />
                    ) : null}
                  </View>
                </Cell>
              </TableRow>
            );
          })}
        </Table>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 16, fontFamily: fonts.bodyBold, color: colors.onSurface },
  hint: { fontSize: tType.sm, color: colors.onSurfaceTertiary, marginTop: 4 },
  form: { flexDirection: "row", gap: 12, marginTop: 16, flexWrap: "wrap", alignItems: "center" },
  input: { flex: 1, minWidth: 200, height: 40, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, color: colors.onSurface, fontSize: tType.base },
  slug: { fontFamily: "monospace", fontSize: tType.sm, color: colors.onSurface },
  dimmed: { color: colors.onSurfaceTertiary },
  count: { fontFamily: fonts.bodySemi, color: colors.onSurfaceSecondary },
  err: { color: colors.error, marginTop: 12, fontSize: tType.sm },
});
