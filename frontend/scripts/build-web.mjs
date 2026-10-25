/**
 * Build the web app for Vercel.
 *
 * Differs from build-console.mjs in one way that matters: that script blanks
 * EXPO_PUBLIC_BACKEND_URL so the console served *by* the API uses same-origin
 * relative requests. Here the app is served by Vercel and the API lives on
 * Cloud Run, so the absolute URL has to be baked in — and the API must allow
 * the Vercel origin via ALLOWED_ORIGINS.
 *
 * See docs/VERCEL_WEB_HOSTING.md for why /api is not proxied through Vercel.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(frontend, "dist");

const api = process.env.EXPO_PUBLIC_BACKEND_URL
  || "https://explore91-api-597388632883.asia-south1.run.app";
const site = process.env.EXPO_PUBLIC_SITE_URL || api;

console.log(`API:  ${api}`);
console.log(`Site: ${site}`);

rmSync(out, { recursive: true, force: true });

// Through node, not the npx shim: Node 24 on Windows will not spawn a .cmd
// without a shell, and a shell would mean quoting paths containing spaces.
const expoCli = createRequire(import.meta.url).resolve("expo/bin/cli");
execFileSync(
  process.execPath,
  [expoCli, "export", "--platform", "web", "--output-dir", "dist"],
  {
    cwd: frontend,
    stdio: "inherit",
    env: { ...process.env, EXPO_PUBLIC_BACKEND_URL: api, EXPO_PUBLIC_SITE_URL: site },
  }
);

if (!existsSync(join(out, "index.html"))) {
  console.error("Export produced no index.html.");
  process.exit(1);
}
console.log("Built to dist/");
