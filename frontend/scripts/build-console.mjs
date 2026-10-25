/**
 * Build the admin console and place it where the API can serve it.
 *
 * `gcloud run deploy --source backend` uploads only the backend directory, so
 * the export has to live inside it at deploy time. This copies the Expo web
 * build to backend/web/console_dist/, which web/console.py serves.
 *
 * It exports to dist-console/, NOT dist/. Both builds used to write to dist/
 * with opposite EXPO_PUBLIC_BACKEND_URL values, so whichever ran last decided
 * what a later `vercel deploy dist` shipped. That is how a console build -
 * with a blank API base, every request relative - once went out as the public
 * site, where relative /api/... is answered by the SPA fallback with
 * index.html and a 200. Separate directories, so the question cannot arise.
 *
 * EXPO_PUBLIC_BACKEND_URL is deliberately blanked for this build: the console
 * is served from the API's own origin, so an empty base makes every request a
 * relative /api/..., which works on whatever host it is deployed to and needs
 * no CORS allowance.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(frontend, "dist-console");
const target = resolve(frontend, "..", "backend", "web", "console_dist");

rmSync(out, { recursive: true, force: true });

console.log("Exporting the web build…");
// Run the CLI through node rather than the npx shim. Node 24 on Windows
// refuses to spawn a .cmd without a shell, and going through a shell would
// mean quoting paths that contain spaces.
// --clear is not optional here. babel-preset-expo inlines each
// EXPO_PUBLIC_* read at transform time, but the value does not reliably
// reach Metro's transform cache key. The console build and this one set
// EXPO_PUBLIC_BACKEND_URL to opposite values, so without clearing, whichever
// ran first decides what src/api.ts carries - and a cache hit reproduces it
// byte for byte, identical bundle hash and all.
const expoCli = createRequire(import.meta.url).resolve("expo/bin/cli");
execFileSync(
  process.execPath,
  [expoCli, "export", "--platform", "web", "--clear", "--output-dir", "dist-console"],
  { cwd: frontend, stdio: "inherit", env: { ...process.env, EXPO_PUBLIC_BACKEND_URL: "" } }
);

if (!existsSync(join(out, "index.html"))) {
  console.error("Export produced no index.html — refusing to copy.");
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(out, target, { recursive: true });
console.log(`Copied to ${target}`);
