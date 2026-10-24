/**
 * Explore91 design tokens.
 *
 * These mirror the Lovable prototype that explore91.com is built from, so the
 * native app and the website read as the same product. The colour values were
 * taken from the live site by resolving its CSS custom properties to sRGB in
 * the browser rather than converting the oklch() sources by hand, which is
 * where rounding drift would otherwise creep in.
 *
 * The key names are unchanged from the previous monochrome set on purpose:
 * forty-odd files already import `colors`, `spacing`, `radius` and `type`, and
 * keeping the names means they restyle by changing these values rather than by
 * being edited one at a time. New tokens are added alongside.
 */

/** The palette, straight from the prototype. */
const palette = {
  /** Explore Emerald — the brand colour. Was #1A1A1A, i.e. black. */
  emerald: "#3F8439",
  emeraldDark: "#2C6427",
  /** Journey Gold. Reserved for the journey map and "visited" moments. */
  gold: "#EEB747",
  /** Warm off-white page background, not pure white. */
  bone: "#FBFAF8",
  white: "#FFFFFF",
  /** Near-black with a green cast; the immersive base for reels, the tab bar
   *  and photo scrims. Pure black looks dead next to the emerald. */
  ink: "#0E160F",
  foreground: "#12120F",
  muted: "#F4F3F0",
  mutedForeground: "#646360",
  secondary: "#F3F2EC",
  secondaryForeground: "#1B1B18",
  border: "#E5E4E2",
  destructive: "#EE343B",
};

export const colors = {
  // --- surfaces ---
  /** Cards and sheets sit in white ON the bone background; that contrast is
   *  what gives the site its layered, editorial feel. */
  surface: palette.white,
  onSurface: palette.foreground,
  surfaceSecondary: palette.muted,
  onSurfaceSecondary: palette.secondaryForeground,
  surfaceTertiary: palette.secondary,
  onSurfaceTertiary: palette.mutedForeground,
  surfaceInverse: palette.ink,
  onSurfaceInverse: palette.white,

  /** The page behind the cards. */
  background: palette.bone,

  // --- brand ---
  brandPrimary: palette.emerald,
  onBrandPrimary: palette.white,
  brandSecondary: palette.emeraldDark,
  /** Accent. Was a terracotta (#E27D60); the prototype uses gold. */
  brandTertiary: palette.gold,
  onBrandTertiary: palette.foreground,

  // --- state ---
  success: palette.emerald,
  warning: palette.gold,
  error: palette.destructive,

  // --- lines ---
  border: palette.border,
  borderStrong: "#D5D4D1",
  divider: palette.muted,

  /** Immersive dark base. Named separately from surfaceInverse because scrims
   *  and the tab bar want the green-black, not merely "the opposite". */
  ink: palette.ink,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

/**
 * Radii. The prototype's base is 18px — noticeably rounder than the 12px this
 * app used, and most of why its cards read as soft rather than boxy.
 */
export const radius = {
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 26,
  /** Big photo cards and the sheet that overlaps the home hero. */
  xxxl: 30,
  pill: 999,
};

export const type = {
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  xxl: 24,
  display: 32,
  /** The oversized city name on the home hero. */
  hero: 44,
};

/**
 * Font families, registered by `useAppFonts`.
 *
 * Outfit for headings and anything display-sized, Figtree for body — the same
 * pairing as the site. Weight is selected by family name rather than
 * `fontWeight`, because on Android `fontWeight` on a custom family silently
 * falls back to the system face instead of picking the right file.
 */
export const fonts = {
  display: "Outfit_700Bold",
  displaySemi: "Outfit_600SemiBold",
  body: "Figtree_400Regular",
  bodyMedium: "Figtree_500Medium",
  bodySemi: "Figtree_600SemiBold",
  bodyBold: "Figtree_700Bold",
};

/**
 * Editorial text styles lifted from the prototype's stylesheet.
 *
 * `eyebrow` is the small tracked-out label above section titles ("EXPLORE",
 * "4 PLACES · ALL"); it appears on nearly every screen of the site and is a
 * large part of why it reads as editorial rather than as a generic app.
 */
export const text = {
  eyebrow: {
    fontFamily: fonts.bodySemi,
    fontSize: 10.5,
    letterSpacing: 1.9, // 0.18em at 10.5px
    textTransform: "uppercase" as const,
    color: palette.mutedForeground,
  },
  /** Display headings: tight tracking. */
  displayTight: {
    fontFamily: fonts.display,
    letterSpacing: -0.9,
  },
  displayLoose: {
    fontFamily: fonts.display,
    letterSpacing: -0.64,
  },
};

/**
 * Elevation. React Native needs both the iOS shadow* properties and an Android
 * `elevation`, so each tier carries the pair rather than a single value.
 */
export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  float: {
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  /** Green-tinted glow under the raised Reels button in the tab bar. */
  reels: {
    shadowColor: palette.emerald,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
};
