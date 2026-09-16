// Icon font loader for Expo apps using @react-native-vector-icons.
// - Native dev/prod builds: the config plugin autolinks the .ttf at build time.
// - Expo Go & Web: the .ttf shipped inside the package is registered here via
//   expo-font so <Ionicons /> can resolve its glyphs.
// Usage: const [loaded, error] = useIconFonts();

import { useFonts } from "expo-font";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const IoniconsTtf = require("@react-native-vector-icons/ionicons/fonts/Ionicons.ttf");

export const useIconFonts = (): readonly [boolean, Error | null] =>
  useFonts({
    Ionicons: IoniconsTtf,
  });
