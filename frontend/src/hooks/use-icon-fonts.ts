// Font loader.
//
// Two unrelated things need registering before first paint:
//
//   * Ionicons, so <Ionicons /> can resolve its glyphs. Native dev/prod builds
//     autolink the .ttf at build time via the config plugin; Expo Go and web
//     need the copy shipped inside the package registered here.
//   * Outfit and Figtree, the display/body pairing the design tokens name.
//     Without these every `fontFamily` in the app silently falls back to the
//     system face, which is the single biggest visual difference from the
//     website — so they load in the same gate as the icons rather than
//     asynchronously, to avoid a flash of the wrong typeface.
//
// Usage: const [loaded, error] = useAppFonts();

import { useFonts } from "expo-font";
import { Outfit_600SemiBold, Outfit_700Bold } from "@expo-google-fonts/outfit";
import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from "@expo-google-fonts/figtree";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const IoniconsTtf = require("@react-native-vector-icons/ionicons/fonts/Ionicons.ttf");

export const useAppFonts = (): readonly [boolean, Error | null] =>
  useFonts({
    Ionicons: IoniconsTtf,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });

/** Previous name, kept so existing call sites keep working. */
export const useIconFonts = useAppFonts;
