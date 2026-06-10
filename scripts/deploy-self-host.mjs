import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const cwd = join(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerConfig = "wrangler.jsonc";
const workerEntry = "dist/nanites_app/index.js";
const assetsDirectory = "dist/client";
const migrationBinding = "DB";
const generatedMigrationConfig = join(cwd, ".wrangler/nanites-d1-migrations.jsonc");
const vpBin = resolveLocalBin("vp");
const validateOnly =
  process.argv.includes("--validate") ||
  process.argv.includes("--dry-run") ||
  process.env.NANITES_DEPLOY_VALIDATE_ONLY === "1" ||
  process.env.NANITES_DEPLOY_DRY_RUN === "1";
const migrateOnly = process.argv.includes("--migrate-only");

function readText(path) {
  return readFileSync(join(cwd, path), "utf8");
}

function parseJsonc(path) {
  const parsed = ts.parseConfigFileTextToJson(path, readText(path));
  if (parsed.error) {
    throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"));
  }
  return parsed.config;
}

function resolveFromCwd(path) {
  return isAbsolute(path) ? path : join(cwd, path);
}

function resolveLocalBin(name) {
  const extension = process.platform === "win32" ? ".cmd" : "";
  const localBin = join(cwd, "node_modules", ".bin", `${name}${extension}`);
  return existsSync(localBin) ? localBin : name;
}

function readMigrationBindingConfig() {
  const config = parseJsonc(wranglerConfig);
  const database = config.d1_databases?.find((entry) => entry?.binding === migrationBinding);
  const databaseName = database?.database_name;
  if (typeof databaseName !== "string" || databaseName.trim().length === 0) {
    throw new Error(`Could not find D1 database_name for binding "${migrationBinding}".`);
  }

  const migrationsDir =
    typeof database.migrations_dir === "string" && database.migrations_dir.trim().length > 0
      ? database.migrations_dir.trim()
      : "migrations";

  return {
    compatibilityDate: config.compatibility_date ?? "2026-03-02",
    databaseName: databaseName.trim(),
    migrationsDirectory: resolveFromCwd(migrationsDir),
  };
}

const migrationConfig = readMigrationBindingConfig();

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function runWithCapturedOutput(command, args) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  return result;
}

function wrangler(args) {
  run(vpBin, ["exec", "wrangler", ...args]);
}

function captureWrangler(args) {
  return capture(vpBin, ["exec", "wrangler", ...args]);
}

function deployArgs({ dryRun = false, provision = true } = {}) {
  return [
    "deploy",
    workerEntry,
    "--assets",
    assetsDirectory,
    "--config",
    wranglerConfig,
    "--env",
    "",
    ...(provision ? ["--experimental-provision", "--experimental-auto-create"] : []),
    ...(dryRun ? ["--dry-run"] : []),
  ];
}

function parseJsonOutput(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Could not find a JSON array in wrangler output.");
  }
  return JSON.parse(output.slice(start, end + 1));
}

function resolveD1DatabaseId() {
  const databases = parseJsonOutput(
    captureWrangler(["d1", "list", "--json", "--config", wranglerConfig]),
  );
  const database = databases.find((candidate) => candidate.name === migrationConfig.databaseName);
  const databaseId = database?.uuid ?? database?.id ?? database?.database_id;
  if (!databaseId) {
    throw new Error(
      `Could not find D1 database "${migrationConfig.databaseName}" after provisioning.`,
    );
  }
  return databaseId;
}

function writeMigrationConfig(databaseId) {
  mkdirSync(dirname(generatedMigrationConfig), { recursive: true });
  writeFileSync(
    generatedMigrationConfig,
    `${JSON.stringify(
      {
        $schema: "../node_modules/wrangler/config-schema.json",
        name: "nanites-d1-migrations",
        compatibility_date: migrationConfig.compatibilityDate,
        d1_databases: [
          {
            binding: migrationBinding,
            database_name: migrationConfig.databaseName,
            database_id: databaseId,
            migrations_dir: migrationConfig.migrationsDirectory,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

function applyD1Migrations() {
  const result = runWithCapturedOutput(vpBin, [
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    migrationBinding,
    "--remote",
    "--config",
    generatedMigrationConfig,
  ]);
  if (result.status === 0) {
    return;
  }

  console.error(
    [
      "",
      "Nanites self-host deploy stopped while applying D1 migrations.",
      `V1 assumes one Nanites deployment per Cloudflare account and a fresh default D1 database named "${migrationConfig.databaseName}", or a database already created by this template's migration history.`,
      "If this account contains older or conflicting Nanites resources, use a fresh Cloudflare account or remove the conflicting default resources before retrying the zero-config deploy.",
    ].join("\n"),
  );
  process.exit(result.status ?? 1);
}

if (!migrateOnly) {
  run("node", ["scripts/validate-self-host-template.mjs"]);
  run(vpBin, ["build"]);
  wrangler(deployArgs({ dryRun: validateOnly, provision: !validateOnly }));
}

if (validateOnly) {
  process.exit(0);
}

const databaseId = resolveD1DatabaseId();
writeMigrationConfig(databaseId);
applyD1Migrations();

if (!migrateOnly) {
  wrangler(deployArgs());
}
