/**
 * The set of icon names Ionicons accepts.
 *
 * Derived from the component's own props rather than spelled out, so it
 * cannot drift from the installed icon set.
 *
 * This replaces `keyof typeof Ionicons.glyphMap`, which stopped type-checking
 * in @react-native-vector-icons/ionicons 13 — the default export is now an
 * `IconComponent` that carries its glyph names in its props rather than in a
 * static `glyphMap`. The old form silently degraded to
 * `string | number | symbol`, so every icon name passed through it lost its
 * checking; nothing caught a typo'd name until it rendered as a blank square.
 */
import Ionicons from "@react-native-vector-icons/ionicons";
import type { ComponentProps } from "react";

export type IconName = ComponentProps<typeof Ionicons>["name"];
