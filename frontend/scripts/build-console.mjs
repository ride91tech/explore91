/**
 * Build the admin console and place it where the API can serve it.
 *
 * `gcloud run deploy --source backend` uploads only the backend directory, so
 * the export has to live inside it at deploy time. This copies the Expo web
 * build to backend/web/console_dist/, which web/console.py serves.
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
const out = join(frontend, "dist");
const target = resolve(frontend, "..", "backend", "web", "console_dist");

rmSync(out, { recursive: true, force: true });

console.log("Exporting the web build…");
// Run the CLI through node rather than the npx shim. Node 24 on Windows
// refuses to spawn a .cmd without a shell, and going through a shell would
// mean quoting paths that contain spaces.
const expoCli = createRequire(import.meta.url).resolve("expo/bin/cli");
execFileSync(
  process.execPath,
  [expoCli, "export", "--platform", "web", "--output-dir", "dist"],
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
