/**
 * What a reel's call-to-action should be, given what it's a reel of.
 *
 * explore91.com varies this per reel rather than showing one button: a beach
 * offers "Get Directions", a restaurant "View Restaurant", a villa "Book
 * Stay". The current app showed "Book" on everything, which is wrong for a
 * product whose place pages say "No booking. Just a note for later." — only
 * stays and deals are bookable.
 *
 * Directions matter beyond the label: the site describes the journey map
 * filling in on its own as you open reels and get directions, so that action
 * is what records a city visit.
 */

export type ReelCtaKind = "directions" | "dine" | "stay" | "place";

export type ReelCta = {
  kind: ReelCtaKind;
  label: string;
  icon: "navigate" | "restaurant" | "calendar" | "arrow-forward";
};

/** Somewhere you go to be there — the reel is the destination. */
const DIRECTIONS = new Set([
  "adventure",
  "tours",
  "events",
]);

/** Somewhere you eat or drink. */
const DINE = new Set([
  "restaurants",
  "cafes",
  "bars",
]);

/** Somewhere you sleep — the one genuinely bookable kind. */
const STAY = new Set([
  "hotels",
  "resorts",
  "homestays",
]);

export function reelCta(category?: string | null): ReelCta {
  const c = (category || "").toLowerCase();
  if (DIRECTIONS.has(c)) {
    return { kind: "directions", label: "Get Directions", icon: "navigate" };
  }
  if (DINE.has(c)) {
    return { kind: "dine", label: "View Restaurant", icon: "restaurant" };
  }
  if (STAY.has(c)) {
    return { kind: "stay", label: "Book Stay", icon: "calendar" };
  }
  return { kind: "place", label: "View Place", icon: "arrow-forward" };
}

/**
 * A maps link for a place.
 *
 * Reels carry a business name and city but no coordinates, so this searches
 * rather than pinning an exact point. Good enough to start walking, and it
 * degrades to the city if the name is missing.
 */
export function mapsUrl(name?: string | null, city?: string | null): string {
  const query = [name, city].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
