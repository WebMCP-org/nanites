#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";

const configPath = "wrangler.jsonc";
const tempConfigPath = ".wrangler.d1-migrations.jsonc";
const databaseName = process.env.NANITES_D1_DATABASE_NAME ?? "nanites-db";

if (process.argv.includes("--self-check")) {
  const sample = `{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "nanites-db",
      "migrations_dir": "src/backend/db/migrations",
    },
  ],
}`;
  const patched = withDatabaseId(sample, "nanites-db", "test-db-id");

  assert.equal(configuredDatabaseId(sample, "nanites-db"), null);
  assert.equal(configuredDatabaseId(patched, "nanites-db"), "test-db-id");
  assert.equal(withDatabaseId(patched, "nanites-db", "other-db-id"), patched);
  console.log("apply-d1-migrations self-check passed");
  process.exit(0);
}

const config = await readFile(configPath, "utf8");
const databaseId =
  process.env.CLOUDFLARE_DATABASE_ID ??
  configuredDatabaseId(config, databaseName) ??
  (await findDatabaseId(databaseName));

await writeFile(tempConfigPath, withDatabaseId(config, databaseName, databaseId));

let exitCode = 1;
try {
  const result = spawnSync(
    "wrangler",
    ["d1", "migrations", "apply", "DB", "--remote", "--config", tempConfigPath],
    {
      shell: process.platform === "win32",
      stdio: "inherit",
    },
  );
  if (result.error) {
    throw result.error;
  }
  exitCode = result.status ?? 1;
} finally {
  await unlink(tempConfigPath).catch(() => {});
}

process.exit(exitCode);

function configuredDatabaseId(configText, name) {
  const lines = configText.split("\n");
  const start = lines.findIndex((line) => line.includes(`"database_name": "${name}"`));
  if (start === -1) {
    return null;
  }

  for (const line of lines.slice(start + 1, start + 8)) {
    const id = line.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1];
    if (id) {
      return id;
    }
    if (line.includes("}")) {
      return null;
    }
  }

  return null;
}

function withDatabaseId(configText, name, id) {
  if (configuredDatabaseId(configText, name) !== null) {
    return configText;
  }

  const lines = configText.split("\n");
  const index = lines.findIndex((line) => line.includes(`"database_name": "${name}"`));
  if (index === -1) {
    throw new Error(`Could not find D1 database "${name}" in ${configPath}`);
  }

  const indent = lines[index]?.match(/^\s*/)?.[0] ?? "";
  lines.splice(index + 1, 0, `${indent}"database_id": "${id}",`);
  return lines.join("\n");
}

async function findDatabaseId(name) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    throw new Error(
      "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or set CLOUDFLARE_DATABASE_ID.",
    );
  }

  for (let page = 1; ; page += 1) {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "100");

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const body = await response.json();
    if (!response.ok || body.success === false) {
      throw new Error(`Could not list D1 databases: ${JSON.stringify(body.errors ?? body)}`);
    }

    const database = body.result?.find((candidate) => candidate.name === name);
    if (database?.uuid) {
      return database.uuid;
    }

    if (page >= (body.result_info?.total_pages ?? 1)) {
      throw new Error(`Could not find D1 database "${name}"`);
    }
  }
}
