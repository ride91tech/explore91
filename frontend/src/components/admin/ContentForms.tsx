/**
 * Create forms for the admin console — a place, and a reel.
 *
 * These are the only way to add catalogue content from a browser. Everything
 * else in the console moderates what already exists.
 *
 * Category and city are chips rather than text inputs on purpose. Both are
 * matched as exact lowercase slugs server-side, so a typed "Cafes" or "cafe"
 * produces a record that belongs to no filter and is effectively invisible —
 * a mistake that is silent at the point of making it and confusing much
 * later. Picking from the real list makes it unrepresentable.
 */
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import { api, Business, CategoryT, CityT } from "@/src/api";
import { Card, Btn } from "@/src/components/admin/ui";
import { colors, fonts, radius, spacing, text as tText, type as tType } from "@/src/theme";

const PRICES = ["$", "$$", "$$$", "$$$$"];

/* ───────────────────────── shared bits ───────────────────────── */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginTop: spacing.lg }}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={{ marginTop: spacing.sm }}>{children}</View>
    </View>
  );
}

function Input(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor={colors.onSurfaceTertiary}
      {...props}
      style={[styles.input, props.multiline && styles.inputMulti, props.style]}
    />
  );
}

function Choice({
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  options: { key: string; label: string }[];
  value: string | null;
  onChange: (key: string) => void;
  testIDPrefix: string;
}) {
  return (
    <View style={styles.chipWrap}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            testID={`${testIDPrefix}-${o.key}`}
            onPress={() => onChange(o.key)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Collapsed until asked for, so it does not push the table off the screen. */
function Collapsible({
  title,
  blurb,
  openLabel,
  open,
  setOpen,
  children,
  testID,
}: {
  title: string;
  blurb: string;
  openLabel: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  children: React.ReactNode;
  testID: string;
}) {
  return (
    <Card style={{ marginBottom: spacing.xl }}>
      <Pressable
        testID={testID}
        onPress={() => setOpen(!open)}
        style={styles.collapseHead}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.section}>{title}</Text>
          <Text style={styles.hint}>{blurb}</Text>
        </View>
        <View style={styles.collapseBtn}>
          <Ionicons
            name={open ? "chevron-up" : "add"}
            size={16}
            color={colors.onBrandPrimary}
          />
          <Text style={styles.collapseBtnText}>{open ? "Close" : openLabel}</Text>
        </View>
      </Pressable>
      {open ? <View>{children}</View> : null}
    </Card>
  );
}

/** Categories and cities, fetched once and shared by both forms. */
function useCatalogue() {
  const [categories, setCategories] = useState<CategoryT[]>([]);
  const [cities, setCities] = useState<CityT[]>([]);
  useEffect(() => {
    api<CategoryT[]>("/categories").then(setCategories).catch(() => {});
    api<CityT[]>("/cities").then(setCities).catch(() => {});
  }, []);
  return { categories, cities };
}

/* ───────────────────────── add a place ───────────────────────── */

export function AddPlaceForm({ onCreated }: { onCreated: () => Promise<void> | void }) {
  const { categories, cities } = useCatalogue();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [area, setArea] = useState("");
  const [whyGo, setWhyGo] = useState("");
  const [description, setDescription] = useState("");
  const [cover, setCover] = useState("");
  const [price, setPrice] = useState("$$");
  const [tags, setTags] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  const reset = () => {
    setName(""); setAddress(""); setArea(""); setWhyGo(""); setDescription("");
    setCover(""); setTags(""); setLat(""); setLng(""); setPrice("$$");
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("A name is required.");
    if (!category) return setError("Pick a category — it is how the place is filtered.");
    if (!city) return setError("Pick a city.");
    if (!address.trim()) return setError("An address is required.");
    if (cover && !/^https:\/\//.test(cover)) {
      return setError("The cover image must be an https:// URL.");
    }
    // Both or neither: one coordinate on its own silently falls back to the
    // city centroid for the other, which puts the pin somewhere nobody chose.
    if ((lat && !lng) || (lng && !lat)) {
      return setError("Give both latitude and longitude, or neither.");
    }

    setBusy(true);
    try {
      await api("/admin/businesses", {
        method: "POST",
        auth: true,
        body: JSON.stringify({
          name: name.trim(),
          category,
          city,
          address: address.trim(),
          area: area.trim() || null,
          why_go: whyGo.trim() || null,
          description: description.trim(),
          cover_image: cover.trim() || null,
          price_range: price,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          ...(lat && lng ? { lat: Number(lat), lng: Number(lng) } : {}),
        }),
      });
      reset();
      await onCreated();
    } catch (e: any) {
      setError(e?.message ?? "Could not create the place.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Collapsible
      testID="add-place-toggle"
      title="Add a place"
      blurb="Goes live immediately, unclaimed — an owner can claim it later."
      openLabel="Add a place"
      open={open}
      setOpen={setOpen}
    >
      <Field label="Name">
        <Input testID="place-name" placeholder="e.g. Cafe Bodega" value={name} onChangeText={setName} />
      </Field>

      <Field label="Category" hint="How the place is filtered everywhere in the app.">
        <Choice
          testIDPrefix="place-cat"
          options={categories.map((c) => ({ key: c.slug, label: c.name }))}
          value={category}
          onChange={setCategory}
        />
      </Field>

      <Field label="City">
        <Choice
          testIDPrefix="place-city"
          options={cities.map((c) => ({ key: c.slug, label: c.name }))}
          value={city}
          onChange={setCity}
        />
      </Field>

      <View style={styles.row}>
        <Field label="Address">
          <Input testID="place-address" placeholder="Street, locality" value={address} onChangeText={setAddress} />
        </Field>
        <Field label="Area" hint="Shown above the name. Optional.">
          <Input testID="place-area" placeholder="e.g. Bandra West" value={area} onChangeText={setArea} />
        </Field>
      </View>

      <Field label="Why go" hint="One evocative line. Shown on the public page above the description.">
        <Input testID="place-whygo" placeholder="Sunset tables over the creek." value={whyGo} onChangeText={setWhyGo} />
      </Field>

      <Field label="Description">
        <Input testID="place-desc" placeholder="A paragraph about the place." value={description} onChangeText={setDescription} multiline />
      </Field>

      <Field label="Cover image" hint="https:// only. Leave blank for a stock image for the category.">
        <Input testID="place-cover" placeholder="https://…" value={cover} onChangeText={setCover} autoCapitalize="none" />
      </Field>

      <View style={styles.row}>
        <Field label="Price">
          <Choice
            testIDPrefix="place-price"
            options={PRICES.map((p) => ({ key: p, label: p }))}
            value={price}
            onChange={setPrice}
          />
        </Field>
        <Field label="Tags" hint="Comma separated.">
          <Input testID="place-tags" placeholder="Coffee, Brunch" value={tags} onChangeText={setTags} />
        </Field>
      </View>

      <Field
        label="Coordinates"
        hint="Optional. Without them the pin sits at the city centre, which is fine for one place and useless for fifty."
      >
        <View style={styles.row}>
          <Input testID="place-lat" placeholder="Latitude" value={lat} onChangeText={setLat} keyboardType="numeric" />
          <Input testID="place-lng" placeholder="Longitude" value={lng} onChangeText={setLng} keyboardType="numeric" />
        </View>
      </Field>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={{ marginTop: spacing.lg, alignItems: "flex-start" }}>
        <Btn testID="place-submit" label="Add place" busy={busy} onPress={submit} />
      </View>
    </Collapsible>
  );
}

/* ───────────────────────── add a reel ───────────────────────── */

export function AddReelForm({ onCreated }: { onCreated: () => Promise<void> | void }) {
  const { cities } = useCatalogue();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [city, setCity] = useState<string | null>(null);
  const [places, setPlaces] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [video, setVideo] = useState("");
  const [cover, setCover] = useState("");
  const [caption, setCaption] = useState("");
  const [author, setAuthor] = useState("");

  // The place list follows the chosen city, so the picker cannot offer a
  // venue from somewhere else.
  const loadPlaces = useCallback(async (slug: string) => {
    try {
      setPlaces(await api<Business[]>(`/businesses?city=${slug}&limit=100`));
    } catch {
      setPlaces([]);
    }
  }, []);

  useEffect(() => {
    setBusinessId(null);
    if (city) loadPlaces(city);
    else setPlaces([]);
  }, [city, loadPlaces]);

  const submit = async () => {
    setError(null);
    if (!city) return setError("Pick a city.");
    if (!/^https:\/\//.test(video)) return setError("The video must be an https:// URL.");
    if (!caption.trim()) return setError("A caption is required.");
    if (cover && !/^https:\/\//.test(cover)) {
      return setError("The cover image must be an https:// URL.");
    }

    setBusy(true);
    try {
      await api("/admin/reels", {
        method: "POST",
        auth: true,
        body: JSON.stringify({
          city,
          business_id: businessId,
          video_url: video.trim(),
          cover_image: cover.trim() || null,
          caption: caption.trim(),
          ...(author.trim() ? { author: author.trim() } : {}),
        }),
      });
      setVideo(""); setCover(""); setCaption(""); setAuthor(""); setBusinessId(null);
      await onCreated();
    } catch (e: any) {
      setError(e?.message ?? "Could not publish the reel.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Collapsible
      testID="add-reel-toggle"
      title="Publish a reel"
      blurb="Reels are the discovery mechanic. A city with places and no reels has an empty Reels tab."
      openLabel="Publish a reel"
      open={open}
      setOpen={setOpen}
    >
      <Field label="City">
        <Choice
          testIDPrefix="reel-city"
          options={cities.map((c) => ({ key: c.slug, label: c.name }))}
          value={city}
          onChange={setCity}
        />
      </Field>

      <Field
        label="Place"
        hint="Optional. A reel with a place links to it; one without is a city reel. Leave blank rather than attaching a venue the clip is not of."
      >
        {!city ? (
          <Text style={styles.hint}>Pick a city first.</Text>
        ) : places.length === 0 ? (
          <Text style={styles.hint}>
            No places listed in this city yet — publish it as a city reel, or add a place first.
          </Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipWrap}>
              <Pressable
                testID="reel-place-none"
                onPress={() => setBusinessId(null)}
                style={[styles.chip, businessId === null && styles.chipActive]}
              >
                <Text style={[styles.chipText, businessId === null && styles.chipTextActive]}>
                  City reel
                </Text>
              </Pressable>
              {places.map((p) => {
                const active = p.business_id === businessId;
                return (
                  <Pressable
                    key={p.business_id}
                    testID={`reel-place-${p.business_id}`}
                    onPress={() => setBusinessId(p.business_id)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {p.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        )}
      </Field>

      <Field label="Video URL" hint="https:// only. An mp4 the app can stream.">
        <Input testID="reel-video" placeholder="https://…/clip.mp4" value={video} onChangeText={setVideo} autoCapitalize="none" />
      </Field>

      <Field label="Cover image" hint="Optional. Falls back to the place's cover.">
        <Input testID="reel-cover" placeholder="https://…" value={cover} onChangeText={setCover} autoCapitalize="none" />
      </Field>

      <Field label="Caption">
        <Input testID="reel-caption" placeholder="What the clip shows." value={caption} onChangeText={setCaption} multiline />
      </Field>

      <Field label="Author" hint="Shown as the handle on the reel. Defaults to Explore91.">
        <Input testID="reel-author" placeholder="@explore91" value={author} onChangeText={setAuthor} autoCapitalize="none" />
      </Field>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={{ marginTop: spacing.lg, alignItems: "flex-start" }}>
        <Btn testID="reel-submit" label="Publish reel" busy={busy} onPress={submit} />
      </View>
    </Collapsible>
  );
}

const styles = StyleSheet.create({
  collapseHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  collapseBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
  },
  collapseBtnText: {
    fontFamily: fonts.bodySemi,
    fontSize: tType.sm,
    color: colors.onBrandPrimary,
  },

  section: { fontFamily: fonts.display, fontSize: tType.lg, color: colors.onSurface },
  label: { ...tText.eyebrow },
  hint: {
    fontFamily: fonts.body,
    fontSize: tType.sm,
    color: colors.onSurfaceTertiary,
    marginTop: 3,
    lineHeight: 18,
  },

  row: { flexDirection: "row", gap: spacing.lg, flexWrap: "wrap" },

  input: {
    flex: 1,
    minWidth: 180,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: tType.base,
    color: colors.onSurface,
  },
  inputMulti: { minHeight: 76, textAlignVertical: "top" },

  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { fontFamily: fonts.bodySemi, fontSize: tType.sm, color: colors.onSurface },
  chipTextActive: { color: colors.onBrandPrimary },

  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: tType.sm,
    color: colors.error,
    marginTop: spacing.lg,
  },
});
