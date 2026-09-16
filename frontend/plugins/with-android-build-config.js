const fs = require("fs");
const path = require("path");
const { withGradleProperties, withDangerousMod } = require("@expo/config-plugins");

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

module.exports = (config) => withGradleWrapperTimeout(withGradleMemory(config));
