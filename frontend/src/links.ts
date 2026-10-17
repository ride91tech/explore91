/**
 * Public URLs for shareable things.
 *
 * Shares used to send bare text, so a link had nowhere to land and nothing
 * previewed. These point at the server-rendered pages, which carry Open Graph
 * metadata — so a WhatsApp message shows a card — and which open the app
 * directly on a device that has it installed, via Universal Links on iOS and
 * App Links on Android.
 *
 * The origin has to match the domains declared in app.json
 * (`ios.associatedDomains` and `android.intentFilters`) and the ones serving
 * the association files, or the link opens a browser tab instead of the app.
 */
export const PUBLIC_SITE_URL = (
  process.env.EXPO_PUBLIC_SITE_URL ?? "https://explore91.com"
).replace(/\/+$/, "");

/** A place's public page. Null when the place predates slugs. */
export function placeUrl(slug?: string | null): string | null {
  return slug ? `${PUBLIC_SITE_URL}/place/${slug}` : null;
}

export function cityUrl(slug?: string | null): string | null {
  return slug ? `${PUBLIC_SITE_URL}/city/${slug}` : null;
}

/**
 * Build the payload for a native share sheet.
 *
 * iOS reads `url` and ignores a URL embedded in `message`; Android has no
 * `url` field at all and only sends `message`. Passing both, with the link
 * also appended to the message, is what makes the link survive on both.
 */
export function shareContent(text: string, url: string | null) {
  if (!url) return { message: text };
  return { message: `${text}\n${url}`, url };
}
