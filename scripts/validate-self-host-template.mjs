// fallow-ignore-file unused-file
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const cwd = join(dirname(fileURLToPath(import.meta.url)), "..");
const deployButtonHref =
  "https://deploy.workers.cloudflare.com/?url=https://github.com/WebMCP-org/nanites";
const generatedSecretNames = new Set([
  "AUTH_COOKIE_SECRET",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_WEBHOOK_SECRET",
]);

function readText(path) {
  return readFileSync(join(cwd, path), "utf8");
}

function fail(message) {
  throw new Error(`Self-host template validation failed: ${message}`);
}

function parseJsonc(path) {
  const text = readText(path);
  const parsed = ts.parseConfigFileTextToJson(path, text);
  if (parsed.error) {
    fail(ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"));
  }
  return parsed.config;
}

function expect(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function hasBinding(entries, binding) {
  return Array.isArray(entries) && entries.some((entry) => entry?.binding === binding);
}

function validateExampleFile(path) {
  const assignmentLine = readText(path)
    .split(/\r?\n/)
    .find((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("#") && trimmed.includes("=");
    });

  expect(!assignmentLine, `${path} must not contain deploy-time secret prompts.`);
}

function validateWranglerConfig() {
  const config = parseJsonc("wrangler.jsonc");
  const vars = config.vars ?? {};
  const d1 = config.d1_databases ?? [];
  const db = d1.find((entry) => entry?.binding === "DB");
  const runWorkerFirst = config.assets?.run_worker_first ?? [];

  expect(
    config.name === "nanites-app-production",
    "default Worker name must stay nanites-app-production.",
  );
  expect(
    vars.NANITES_CLOUDFLARE_SCRIPT_NAME === config.name,
    "NANITES_CLOUDFLARE_SCRIPT_NAME must match the default Worker name.",
  );
  expect(hasBinding(config.worker_loaders, "LOADER"), "LOADER Worker Loader binding is required.");
  expect(config.browser?.binding === "BROWSER", "BROWSER binding is required.");
  expect(config.ai?.binding === "AI", "AI binding is required.");
  expect(db, "DB D1 binding is required.");
  expect(db.database_name === "nanites-db", "DB database_name must stay nanites-db.");
  expect(!("database_id" in db), "default DB binding must omit account-specific database_id.");
  expect(
    hasBinding(config.r2_buckets, "WORKSPACE_FILES"),
    "WORKSPACE_FILES R2 binding is required.",
  );
  expect(hasBinding(config.kv_namespaces, "OAUTH_KV"), "OAUTH_KV KV binding is required.");
  expect(hasBinding(config.kv_namespaces, "TOOL_OUTPUTS"), "TOOL_OUTPUTS KV binding is required.");
  expect(
    config.durable_objects?.bindings?.some(
      (entry) => entry?.name === "NanitesSetupAgent" && entry?.class_name === "NanitesSetupAgent",
    ),
    "NanitesSetupAgent Durable Object binding is required.",
  );
  expect(
    config.migrations?.some(
      (migration) =>
        migration?.tag === "v1-durable-object-baseline" &&
        Array.isArray(migration.new_sqlite_classes) &&
        migration.new_sqlite_classes.includes("NanitesSetupAgent"),
    ),
    "NanitesSetupAgent Durable Object migration is required.",
  );

  for (const secretName of generatedSecretNames) {
    expect(!(secretName in vars), `default vars must not include generated secret ${secretName}.`);
  }

  for (const path of ["/agents/*", "/auth/*", "/setup/*", "/mcp"]) {
    expect(runWorkerFirst.includes(path), `assets.run_worker_first must include ${path}.`);
  }
}

function validatePackageScripts() {
  const packageJson = JSON.parse(readText("package.json"));
  const hasVitePlus =
    "vite-plus" in (packageJson.dependencies ?? {}) ||
    "vite-plus" in (packageJson.devDependencies ?? {});
  const hasWrangler =
    "wrangler" in (packageJson.dependencies ?? {}) ||
    "wrangler" in (packageJson.devDependencies ?? {});

  expect(
    typeof packageJson.packageManager === "string" &&
      packageJson.packageManager.startsWith("pnpm@"),
    "packageManager must pin pnpm so Workers Builds installs the same package manager.",
  );
  expect(existsSync(join(cwd, "pnpm-lock.yaml")), "pnpm-lock.yaml is required for public deploys.");
  expect(hasVitePlus, "vite-plus must stay installed so deploy can use node_modules/.bin/vp.");
  expect(hasWrangler, "wrangler must stay installed so deploy can use the local Wrangler version.");
  expect(
    packageJson.scripts?.deploy === "node scripts/deploy-self-host.mjs",
    "package deploy script must run scripts/deploy-self-host.mjs.",
  );
  expect(
    packageJson.scripts?.["deploy:validate"] === "node scripts/deploy-self-host.mjs --validate",
    "package deploy:validate script must run the self-host deploy validator.",
  );
}

function validateReadme() {
  const readme = readText("README.md");
  expect(readme.includes(deployButtonHref), "README must include the Deploy to Cloudflare link.");
  expect(
    readme.includes("https://deploy.workers.cloudflare.com/button"),
    "README must include the Deploy to Cloudflare badge image.",
  );
}

validateExampleFile(".dev.vars.example");
validateExampleFile(".env.example");
validateWranglerConfig();
validatePackageScripts();
validateReadme();

console.log("Self-host template validation passed.");
