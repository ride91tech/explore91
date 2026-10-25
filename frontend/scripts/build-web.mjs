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
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(frontend, "dist");

// .env is read by the Expo CLI, not by node, so process.env does not carry it
// in this script. Because the script then passes both values explicitly to the
// export, a hardcoded fallback here silently OVERRIDES whatever .env says -
// editing .env looks like it works and changes nothing. Read it so the
// precedence is: real environment > .env > fallback.
const readDotEnv = () => {
  const f = join(frontend, ".env");
  if (!existsSync(f)) return {};
  const vars = {};
  for (const raw of readFileSync(f, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return vars;
};
const dotenv = readDotEnv();
const pick = (k, fallback) => process.env[k] || dotenv[k] || fallback;

const api = pick(
  "EXPO_PUBLIC_BACKEND_URL",
  "https://explore91-api-597388632883.asia-south1.run.app"
);
const site = pick("EXPO_PUBLIC_SITE_URL", api);

console.log(`API:  ${api}`);
console.log(`Site: ${site}`);

rmSync(out, { recursive: true, force: true });

// Through node, not the npx shim: Node 24 on Windows will not spawn a .cmd
// without a shell, and a shell would mean quoting paths containing spaces.
// --clear is not optional here. babel-preset-expo inlines each
// EXPO_PUBLIC_* read at transform time, but the value does not reliably
// reach Metro's transform cache key. The console build and this one set
// EXPO_PUBLIC_BACKEND_URL to opposite values, so without clearing, whichever
// ran first decides what src/api.ts carries - and a cache hit reproduces it
// byte for byte, identical bundle hash and all.
const expoCli = createRequire(import.meta.url).resolve("expo/bin/cli");
execFileSync(
  process.execPath,
  [expoCli, "export", "--platform", "web", "--clear", "--output-dir", "dist"],
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

// Prove the API base actually reached the bundle.
//
// Metro inlines each `process.env.EXPO_PUBLIC_*` read as a literal, and
// exactly two modules read one: src/api.ts (EXPO_PUBLIC_BACKEND_URL, the API
// base) and src/links.ts (EXPO_PUBLIC_SITE_URL, for share links). So when the
// two values are equal the origin must appear at least twice. Finding it once
// means one of them was blank — and a blank API base is silent: every request
// becomes a relative /api/..., which the SPA rewrite answers with index.html
// and a 200, so the app loads and simply shows no content.
const jsDir = join(out, "_expo", "static", "js", "web");
const bundles = readdirSync(jsDir).filter((f) => f.endsWith(".js"));
const js = bundles.map((f) => readFileSync(join(jsDir, f), "utf8")).join("");
const count = (needle) => js.split(needle).length - 1;

const wanted = site === api ? 2 : 1;
if (count(api) < wanted || count(site) < 1) {
  console.error(
    `Bundle does not carry the expected URLs: ${api} appears ${count(api)}x ` +
    `(wanted >= ${wanted}), ${site} appears ${count(site)}x (wanted >= 1).
` +
    "The API base is probably blank. Check EXPO_PUBLIC_BACKEND_URL."
  );
  process.exit(1);
}

// The Vercel CLI ignores every path containing a node_modules segment, and
// Expo exports font assets to dist/assets/node_modules/... So on a prebuilt
// upload all seven fonts were dropped, and the SPA rewrite answered each .ttf
// with index.html and a 200 - fonts failing to parse, every icon a tofu box,
// nothing in the console. This un-ignores them. It belongs in dist/, never in
// frontend/, where it would upload the real node_modules on a source deploy.
writeFileSync(join(out, ".vercelignore"), `!node_modules
`);

console.log(`Built to dist/ (API base present ${count(api)}x)`);
