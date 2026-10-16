const fs = require("fs");
const path = require("path");
const {
  withAppBuildGradle,
  withGradleProperties,
  withDangerousMod,
} = require("@expo/config-plugins");

/**
 * Android build settings that have to live in the generated `android/` folder.
 *
 * That folder is prebuild output and is gitignored, so anything set there by
 * hand is lost on the next `expo prebuild`. This plugin re-applies the settings
 * every time the native project is generated.
 */

function setProperty(properties, key, value) {
  const existing = properties.find(
    (item) => item.type === "property" && item.key === key
  );
  if (existing) {
    existing.value = value;
  } else {
    properties.push({ type: "property", key, value });
  }
  return properties;
}

const withGradleMemory = (config) =>
  withGradleProperties(config, (cfg) => {
    // Android's lintVital pass across the RN module graph exhausts the default
    // 512m Metaspace and fails the release build.
    setProperty(
      cfg.modResults,
      "org.gradle.jvmargs",
      "-Xmx4096m -XX:MaxMetaspaceSize=2048m"
    );

    // arm64-only. Building armeabi-v7a on Windows blows past the 250-char limit
    // CMake allows for object-file paths, and reanimated's ninja build fails
    // with "manifest 'build.ninja' still dirty after 100 tries".
    // Revisit before a store release if 32-bit devices ever matter.
    setProperty(cfg.modResults, "reactNativeArchitectures", "arm64-v8a");

    return cfg;
  });

// There is no first-class mod for gradle-wrapper.properties, so patch the file.
// The generated 10s timeout is not enough to pull the ~200MB Gradle
// distribution on a slow connection, and the wrapper aborts the build.
const withGradleWrapperTimeout = (config) =>
  withDangerousMod(config, [
    "android",
    (cfg) => {
      const file = path.join(
        cfg.modRequest.platformProjectRoot,
        "gradle",
        "wrapper",
        "gradle-wrapper.properties"
      );
      if (fs.existsSync(file)) {
        const patched = fs
          .readFileSync(file, "utf8")
          .replace(/^networkTimeout=.*$/m, "networkTimeout=120000");
        fs.writeFileSync(file, patched);
      }
      return cfg;
    },
  ]);

const SIGNING_MARKER = "EXPLORE91_RELEASE_SIGNING";
const DEBUG_SIGNING = "signingConfig signingConfigs.debug";
const CONDITIONAL_SIGNING =
  "signingConfig project.hasProperty('EXPLORE91_UPLOAD_STORE_FILE') " +
  "? signingConfigs.release : signingConfigs.debug";

/**
 * Point the release build type at the release signingConfig.
 *
 * Done by walking the file rather than with a single regex: the template puts
 * comment lines between `release {` and the signingConfig line, and a pattern
 * that assumed they weren't there matched nothing and left release builds
 * debug-signed without complaining. Anchor on `buildTypes` so this can't hit
 * the identically-named block inside `signingConfigs`.
 */
function pointReleaseAtReleaseSigning(src) {
  const buildTypes = src.indexOf("buildTypes {");
  if (buildTypes === -1) return null;
  const release = src.indexOf("release {", buildTypes);
  if (release === -1) return null;
  const target = src.indexOf(DEBUG_SIGNING, release);
  if (target === -1) return null;
  return (
    src.slice(0, target) +
    CONDITIONAL_SIGNING +
    src.slice(target + DEBUG_SIGNING.length)
  );
}

/**
 * Release signing.
 *
 * The generated project signs release builds with the debug keystore, which
 * Play Store rejects. This swaps in a real one, read from Gradle properties so
 * the keystore and its password never enter the repo — put them in
 * ~/.gradle/gradle.properties, which sits outside the project entirely.
 * `frontend/scripts/make-release-keystore.ps1` creates both.
 *
 * If those properties are absent the build falls back to debug signing, so a
 * fresh clone still builds without the keystore.
 */
const withReleaseSigning = (config) =>
  withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") return cfg;
    let src = cfg.modResults.contents;
    if (src.includes(SIGNING_MARKER)) return cfg;

    const withConfig = src.replace(
      /signingConfigs \{\s*\n(\s*)debug \{/,
      `signingConfigs {
$1// ${SIGNING_MARKER} — injected by plugins/with-android-build-config.js
$1release {
$1    if (project.hasProperty('EXPLORE91_UPLOAD_STORE_FILE')) {
$1        storeFile file(EXPLORE91_UPLOAD_STORE_FILE)
$1        storePassword EXPLORE91_UPLOAD_STORE_PASSWORD
$1        keyAlias EXPLORE91_UPLOAD_KEY_ALIAS
$1        keyPassword EXPLORE91_UPLOAD_KEY_PASSWORD
$1    }
$1}
$1debug {`
    );
    if (withConfig === src) {
      throw new Error(
        "with-android-build-config: could not find the signingConfigs block in " +
          "app/build.gradle. The Expo template changed — update this plugin."
      );
    }

    const pointed = pointReleaseAtReleaseSigning(withConfig);
    if (pointed === null) {
      // Failing the prebuild is far better than shipping a debug-signed
      // release and finding out when Play rejects the upload.
      throw new Error(
        "with-android-build-config: injected the release signingConfig but " +
          "could not repoint the release build type at it. The Expo template " +
          "changed — update this plugin."
      );
    }

    cfg.modResults.contents = pointed;
    return cfg;
  });

module.exports = (config) =>
  withReleaseSigning(withGradleWrapperTimeout(withGradleMemory(config)));
