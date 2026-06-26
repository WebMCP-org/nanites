#!/usr/bin/env node
/**
 * Assembles the prebuilt Nanites artifact into `dist/artifact/` in the exact R2
 * layout the SigVelo provisioner reads (sigvelo `apps/landing/src/lib/provision/artifact.ts`):
 *
 *   nanites/<version>/wrangler-meta.json    binding + migration metadata
 *   nanites/<version>/worker/index.js       ESM Worker entry + sibling modules
 *   nanites/<version>/assets-manifest.json  { "/<path>": { hash, size } }
 *   nanites/<version>/assets/<path...>       SPA client build
 *   nanites/<version>/migrations/*.sql      D1 migrations, applied in filename order
 *   nanites/latest.json                     { version } pointer
 *
 * Pure Node, no deps. Run AFTER `vp build`. Reads the build's own resolved
 * `dist/nanites_app_production/wrangler.json` so the metadata can't drift from
 * what actually shipped.
 */
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import assert from "node:assert/strict";

const version = process.env.ARTIFACT_VERSION || process.argv[2];
if (!version) {
  console.error("usage: assemble.mjs <version>   (or set ARTIFACT_VERSION)");
  process.exit(1);
}

const root = process.cwd();
const distDir = join(root, "dist");
const workerDir = join(distDir, "nanites_app_production");
const clientDir = join(distDir, "client");
const migrationsDir = join(root, "src/backend/db/migrations");

const outRoot = join(distDir, "artifact");
const prefixDir = join(outRoot, "nanites", version);
rmSync(prefixDir, { recursive: true, force: true });
mkdirSync(prefixDir, { recursive: true });

/** Absolute paths of every file under `dir`, recursively. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

const rel = (from, abs) => relative(from, abs).split(sep).join("/");

// Cloudflare module type by extension. .wasm uploads as CompiledWasm, JS as ESModule.
const moduleType = (p) =>
  p.endsWith(".wasm")
    ? "CompiledWasm"
    : p.endsWith(".mjs") || p.endsWith(".js")
      ? "ESModule"
      : "Data";

// --- 1. Worker modules ------------------------------------------------------
// The Cloudflare build emits a multi-module worker (no_bundle): index.js plus
// sibling modules under assets/. Module NAME is the path relative to the worker
// dir (index.js, assets/esbuild-*.wasm); we store each under `worker/<name>` so
// the provisioner can read it and upload it under that name.
const WORKER_EXCLUDE = new Set([".dev.vars", "wrangler.json"]);
const modules = [];
for (const abs of walk(workerDir)) {
  const name = rel(workerDir, abs);
  if (name.startsWith(".vite/")) continue;
  // Never ship source maps — they reconstruct the readable source we sell.
  if (name.endsWith(".map")) continue;
  if (WORKER_EXCLUDE.has(name.split("/").pop())) continue;
  const dest = join(prefixDir, "worker", name);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(abs, dest);
  modules.push({ name, path: `worker/${name}`, type: moduleType(name) });
}
const mainModuleName = "index.js";
assert(
  modules.some((m) => m.name === mainModuleName),
  `worker entry ${mainModuleName} not found in ${workerDir}`,
);

// --- 2. SPA assets + Cloudflare assets manifest -----------------------------
const assetManifest = {};
for (const abs of walk(clientDir)) {
  const name = rel(clientDir, abs);
  if (name === ".assetsignore") continue;
  if (name.endsWith(".map")) continue;
  const buf = readFileSync(abs);
  // ponytail: Cloudflare assets manifest hash = sha256(contents) hex, first 32
  // chars. Exact algorithm is confirmed by the throwaway-account upload-session
  // smoke test; if it rejects, match wrangler's hashing here.
  assetManifest[`/${name}`] = {
    hash: createHash("sha256").update(buf).digest("hex").slice(0, 32),
    size: buf.length,
  };
  const dest = join(prefixDir, "assets", name);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
}
assert(Object.keys(assetManifest).length > 0, "no SPA assets found — did `vp build` run?");
writeFileSync(
  join(prefixDir, "assets-manifest.json"),
  `${JSON.stringify(assetManifest, null, 2)}\n`,
);

// --- 3. D1 migrations -------------------------------------------------------
const migOut = join(prefixDir, "migrations");
mkdirSync(migOut, { recursive: true });
let migrationCount = 0;
for (const f of readdirSync(migrationsDir).sort()) {
  if (!f.endsWith(".sql")) continue;
  cpSync(join(migrationsDir, f), join(migOut, f));
  migrationCount += 1;
}
assert(migrationCount > 0, `no .sql migrations found in ${migrationsDir}`);

// --- 4. wrangler-meta.json (derived from the build's resolved config) -------
const gen = JSON.parse(readFileSync(join(workerDir, "wrangler.json"), "utf8"));
const arr = (x) => (Array.isArray(x) ? x : []);
const migrationMeta = (m) => {
  const out = { tag: m.tag };
  for (const k of ["new_sqlite_classes", "new_classes", "renamed_classes", "deleted_classes"]) {
    if (m[k]) out[k] = m[k];
  }
  return out;
};

const meta = {
  // mainModule keeps the legacy single-file reader working; `modules` carries
  // the full multi-module worker the provisioner must upload.
  mainModule: `worker/${mainModuleName}`,
  mainModuleName,
  modules,
  compatibilityDate: gen.compatibility_date,
  compatibilityFlags: arr(gen.compatibility_flags),
  durableObjects: arr(gen.durable_objects?.bindings).map((b) => ({
    name: b.name,
    class_name: b.class_name,
  })),
  durableObjectMigrations: arr(gen.migrations).map(migrationMeta),
  bindings: {
    kv: arr(gen.kv_namespaces).map((k) => k.binding),
    d1: arr(gen.d1_databases).map((d) => d.binding),
    r2: arr(gen.r2_buckets).map((r) => r.binding),
    ai: gen.ai?.binding ?? null,
    browser: gen.browser?.binding ?? null,
    workerLoaders: arr(gen.worker_loaders).map((w) => w.binding),
  },
  workflows: arr(gen.workflows).map((w) => ({
    binding: w.binding,
    name: w.name,
    class_name: w.class_name,
  })),
  assets: gen.assets
    ? {
        notFoundHandling: gen.assets.not_found_handling,
        htmlHandling: gen.assets.html_handling,
        runWorkerFirst: gen.assets.run_worker_first,
      }
    : undefined,
};
writeFileSync(join(prefixDir, "wrangler-meta.json"), `${JSON.stringify(meta, null, 2)}\n`);

// --- 5. latest.json pointer -------------------------------------------------
mkdirSync(join(outRoot, "nanites"), { recursive: true });
writeFileSync(
  join(outRoot, "nanites", "latest.json"),
  `${JSON.stringify({ version, publishedAt: new Date().toISOString() }, null, 2)}\n`,
);

const totalBytes = walk(prefixDir).reduce((n, f) => n + statSync(f).size, 0);
console.log(
  `assembled nanites@${version}: ${modules.length} worker modules, ` +
    `${Object.keys(assetManifest).length} assets, ${migrationCount} migrations, ` +
    `${(totalBytes / 1e6).toFixed(1)} MB → ${prefixDir}`,
);
