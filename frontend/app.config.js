// Extends app.json. This lives in JS only so the Google Maps key can come from
// the environment instead of being committed.
//
// On Android, react-native-maps renders Google Maps, and the Google Maps SDK
// throws "API key not found" the moment a MapView mounts without
// com.google.android.geo.API_KEY in the manifest. That is a native crash, so
// JavaScript cannot catch it: every Android build before this one closed the
// app as soon as Explore switched to map view.
//
// Set GOOGLE_MAPS_ANDROID_API_KEY in .env for local builds and as an EAS
// environment variable for cloud builds. Without it the build still works,
// and MapPane shows the list of places instead of mounting the map.
// iOS uses Apple Maps and needs no key.
module.exports = ({ config }) => {
  const androidKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim();
  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ["react-native-maps", androidKey ? { androidGoogleMapsApiKey: androidKey } : {}],
    ],
    extra: {
      ...config.extra,
      // Read by MapPane to decide whether mounting MapView is safe on Android.
      androidMapsKeyConfigured: Boolean(androidKey),
    },
  };
};
