const appJson = require("./app.json");

/**
 * Expo config.
 *
 * app.json stays the source of truth for everything static; this file exists
 * only to add the one plugin that cannot be declared statically.
 *
 * `@react-native-google-signin/google-signin`'s config plugin registers the
 * iOS URL scheme that Google redirects back through, and it *throws* if
 * `iosUrlScheme` is missing or malformed. The value is the iOS OAuth client ID
 * with its dot-separated parts reversed — it only exists once that client has
 * been created in the Google Cloud console. Declaring the plugin in app.json
 * before then would break every `expo prebuild`, including Android builds that
 * do not need it at all (the plugin touches iOS only).
 *
 * So it is added only when the scheme is present. To enable iOS sign-in, set
 * in frontend/.env:
 *
 *   EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME=com.googleusercontent.apps.<reversed-ios-client-id>
 *
 * Android needs nothing here: Google matches the app by package name and
 * signing certificate, not by a redirect.
 */
module.exports = () => {
  const config = { ...appJson.expo };
  const iosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;

  if (iosUrlScheme) {
    config.plugins = [
      ...(config.plugins ?? []),
      ["@react-native-google-signin/google-signin", { iosUrlScheme }],
    ];
  }

  return config;
};
