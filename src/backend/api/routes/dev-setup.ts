/**
 * Local-development setup: gives a developer a personal GitHub App without the
 * production wizard, whose Cloudflare ownership verification cannot run on
 * localhost.
 *
 * `GET /setup/local` drives GitHub's app-manifest flow (the same mechanism the
 * wizard uses) and the callback registers the `github_apps` row through the
 * production `registerGitHubApp` path. The one thing the worker cannot do is
 * write `.dev.vars`, so the callback prints the secret lines to paste there.
 * `POST /setup/local/restore` rebuilds rows after a `.wrangler` state wipe
 * from the secrets already in env — curl-able, no browser.
 *
 * These routes are mounted only when `import.meta.env.DEV` is true, so
 * production builds tree-shake this module away entirely; the loopback check
 * below is defense in depth, not the primary gate.
 */
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { createDbClient } from "#/backend/db/index.ts";
import { AppError } from "#/backend/errors.ts";
import {
  buildGitHubAppSecretBindings,
  listActiveGitHubApps,
  readAuthCookieSecret,
  readConfiguredSecret,
  registerGitHubApp,
  requireGitHubAppsTableReady,
  type GitHubAppMetadata,
} from "#/backend/github/apps.ts";
import {
  convertGitHubAppManifestCode,
  fetchAuthenticatedGitHubApp,
  type GitHubAppManifestConversion,
} from "#/backend/github/index.ts";
import {
  DEFAULT_GITHUB_APP_EVENTS,
  DEFAULT_GITHUB_APP_PERMISSIONS,
} from "#/backend/agents/NanitesSetupAgent.ts";
import { GITHUB_OAUTH_CALLBACK_PATH, GITHUB_OAUTH_LOGIN_PATH } from "#/auth.ts";
import { GITHUB_WEBHOOK_PATH } from "#/github.ts";
import type { WorkerHonoEnv } from "#/backend/api/apps.ts";

export const DEV_LOCAL_SETUP_PATH = "/setup/local";
const DEV_LOCAL_SETUP_CALLBACK_PATH = `${DEV_LOCAL_SETUP_PATH}/github/callback`;
export const DEV_LOCAL_SETUP_RESTORE_PATH = `${DEV_LOCAL_SETUP_PATH}/restore`;

const MANIFEST_STATE_COOKIE_NAME = "nanites_dev_setup_state";
const MANIFEST_STATE_COOKIE_MAX_AGE_SECONDS = 15 * 60;
const GITHUB_APP_PRIVATE_KEY_BINDING_PATTERN = /^GITHUB_APP_(\d+)_PRIVATE_KEY$/;

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".localhost")
  );
}

const loopbackOnly = createMiddleware<WorkerHonoEnv>(async (context, next) => {
  if (!isLoopbackHostname(new URL(context.req.url).hostname)) {
    return context.text("Not found", 404);
  }

  await next();
});

/**
 * GitHub OAuth state is pinned to `localhost` (loopback IPs get redirected
 * there before login), so the dev app's URLs must say `localhost` too even
 * when this page was opened via 127.0.0.1.
 */
function normalizeToLocalhostOrigin(requestUrl: URL): string {
  const origin = new URL(requestUrl.origin);
  if (origin.hostname !== "localhost") {
    origin.hostname = "localhost";
  }
  return origin.origin;
}

function listEnvGitHubAppIds(env: Env): number[] {
  const appIds = new Set<number>();
  for (const key of Object.keys(env)) {
    const match = GITHUB_APP_PRIVATE_KEY_BINDING_PATTERN.exec(key);
    if (match && readConfiguredSecret(env, key)) {
      appIds.add(Number(match[1]));
    }
  }
  return [...appIds].sort((left, right) => left - right);
}

function buildDevGitHubAppManifest(localhostOrigin: string, manifestState: string) {
  // GitHub enforces global app-name uniqueness, so a short random suffix keeps
  // re-runs from colliding; the name is editable on GitHub's confirmation page.
  const nameSuffix = manifestState
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 4);

  return {
    name: `nanites dev ${nameSuffix}`,
    url: localhostOrigin,
    description: "Personal local-development GitHub App for nanites.",
    // Unlike the wizard's deployment app, nobody but the owner ever signs in
    // to a personal localhost instance, so the app stays private.
    public: false,
    redirect_url: new URL(DEV_LOCAL_SETUP_CALLBACK_PATH, localhostOrigin).toString(),
    callback_urls: [new URL(GITHUB_OAUTH_CALLBACK_PATH, localhostOrigin).toString()],
    request_oauth_on_install: false,
    // GitHub cannot reach localhost, so deliveries stay off. A real webhook
    // secret is still stored because credential resolution requires all three
    // secrets; live local webhooks only need this URL repointed at a tunnel.
    hook_attributes: {
      url: new URL(GITHUB_WEBHOOK_PATH, localhostOrigin).toString(),
      active: false,
    },
    default_permissions: DEFAULT_GITHUB_APP_PERMISSIONS,
    default_events: DEFAULT_GITHUB_APP_EVENTS,
  };
}

function requireConversionString(
  conversion: GitHubAppManifestConversion,
  field: "client_id" | "client_secret" | "pem" | "slug",
): string {
  const value = conversion[field];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  throw new AppError("githubAppManifestConversionFailed", {
    details: { githubResponseStatus: null, reason: "missing_required_field", field },
  });
}

function readConversionPermissions(
  conversion: GitHubAppManifestConversion,
): Record<string, string> {
  const permissions: Record<string, string> = {};
  for (const [permission, access] of Object.entries(conversion.permissions ?? {})) {
    if (typeof access === "string") {
      permissions[permission] = access;
    }
  }
  return permissions;
}

function readConversionEvents(conversion: GitHubAppManifestConversion): readonly string[] {
  return Array.isArray(conversion.events)
    ? conversion.events.filter((event): event is string => typeof event === "string")
    : [];
}

function githubPermissionRank(permission: string | undefined): number {
  switch (permission) {
    case "read":
      return 1;
    case "write":
      return 2;
    case "admin":
      return 3;
    default:
      return 0;
  }
}

/**
 * The developer can edit permissions on GitHub's confirmation page, so unlike
 * the wizard this only warns: a weaker dev app fails loudly at nanite runtime,
 * which is itself a useful thing to exercise locally.
 */
function listManifestDriftWarnings(
  permissions: Record<string, string>,
  events: readonly string[],
): string[] {
  const warnings: string[] = [];
  for (const [permission, requiredAccess] of Object.entries(DEFAULT_GITHUB_APP_PERMISSIONS)) {
    if (githubPermissionRank(permissions[permission]) < githubPermissionRank(requiredAccess)) {
      warnings.push(`Missing default permission: ${permission} (${requiredAccess}).`);
    }
  }

  const grantedEvents = new Set(events);
  for (const event of DEFAULT_GITHUB_APP_EVENTS) {
    if (!grantedEvents.has(event)) {
      warnings.push(`Missing default webhook event: ${event}.`);
    }
  }
  return warnings;
}

function randomBase64UrlToken(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function randomHexToken(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toDevVarsLine(bindingName: string, value: string): string {
  // .dev.vars is dotenv-parsed: double quotes expand `\n`, which keeps the
  // multiline PEM on one line (the convention the repo already uses).
  return `${bindingName}="${value.replace(/\r?\n/g, "\\n").replaceAll('"', '\\"')}"`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderDevSetupPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 46rem; margin: 3rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  code, pre { font-family: ui-monospace, monospace; background: #f4f4f4; border-radius: 4px; }
  code { padding: 0.1rem 0.3rem; }
  pre { padding: 0.8rem; overflow-x: auto; }
  ul { padding-left: 1.2rem; }
  .ok { color: #1a7f37; }
  .missing { color: #b35900; }
  .warning { color: #b35900; }
  button { font: inherit; padding: 0.4rem 0.9rem; border-radius: 6px; border: 1px solid #d0d0d0; background: #f6f8fa; cursor: pointer; }
  button.primary { background: #1f883d; border-color: #1f883d; color: #fff; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function describeAppStatus(app: GitHubAppMetadata, env: Env): string {
  const bindings = buildGitHubAppSecretBindings(app.appId);
  const secretsResolved =
    readConfiguredSecret(env, bindings.privateKeyBinding) !== null &&
    readConfiguredSecret(env, bindings.clientSecretBinding) !== null &&
    readConfiguredSecret(env, bindings.webhookSecretBinding) !== null;
  const secretsLabel = secretsResolved
    ? `<span class="ok">secrets loaded</span>`
    : `<span class="missing">secrets missing from .dev.vars — paste the block from app creation and restart <code>vp run dev</code></span>`;

  return `<li><a href="${escapeHtml(app.htmlUrl)}">${escapeHtml(app.slug)}</a> (app ${app.appId}${app.isPrimary ? ", primary" : ""}): ${secretsLabel}</li>`;
}

function renderPasteBlockSection(input: {
  readonly appId: number;
  readonly slug: string;
  readonly privateKey: string;
  readonly clientSecret: string;
  readonly webhookSecret: string;
  readonly authCookieSecret: string | null;
  readonly warnings: readonly string[];
}): string {
  const bindings = buildGitHubAppSecretBindings(input.appId);
  const pasteLines = [
    toDevVarsLine(bindings.privateKeyBinding, input.privateKey),
    toDevVarsLine(bindings.clientSecretBinding, input.clientSecret),
    toDevVarsLine(bindings.webhookSecretBinding, input.webhookSecret),
    ...(input.authCookieSecret
      ? [toDevVarsLine("AUTH_COOKIE_SECRET", input.authCookieSecret)]
      : []),
  ].join("\n");
  const installUrl = `https://github.com/apps/${encodeURIComponent(input.slug)}/installations/new`;

  return `
<h1>GitHub App <code>${escapeHtml(input.slug)}</code> registered</h1>
${
  input.warnings.length > 0
    ? `<ul>${input.warnings.map((warning) => `<li class="warning">${escapeHtml(warning)}</li>`).join("")}</ul>`
    : ""
}
<p>The app row is saved in the local database. The worker cannot write
<code>.dev.vars</code>, so finish with these steps:</p>
<ol>
  <li>Append this block to <code>.dev.vars</code> (shown once — it holds the app's secrets):
    <pre id="paste-block">${escapeHtml(pasteLines)}</pre>
    <button onclick="navigator.clipboard.writeText(document.getElementById('paste-block').textContent)">Copy</button>
  </li>
  <li>Restart <code>vp run dev</code> so the new secrets load.</li>
  <li><a href="${installUrl}">Install the app</a> on at least one repository.</li>
  <li><a href="${GITHUB_OAUTH_LOGIN_PATH}">Sign in</a> and activate the installation.</li>
</ol>
<p>After a future <code>rm -rf .wrangler</code>, re-run migrations and
<code>curl -X POST http://localhost:5173${DEV_LOCAL_SETUP_RESTORE_PATH}</code> —
no browser flow needed while the secrets stay in <code>.dev.vars</code>.</p>`;
}

export const devLocalSetupRoutes = new Hono<WorkerHonoEnv>()
  .use(`${DEV_LOCAL_SETUP_PATH}/*`, loopbackOnly)
  .use(DEV_LOCAL_SETUP_PATH, loopbackOnly)
  .get(DEV_LOCAL_SETUP_PATH, async (context) => {
    const db = createDbClient(context.env.DB);
    try {
      await requireGitHubAppsTableReady(db);
    } catch {
      return context.html(
        renderDevSetupPage(
          "nanites local setup",
          `<h1>Database migrations missing</h1>
<p>Run <code>vp run db:migrate:local</code>, restart <code>vp run dev</code>, and reload this page.</p>`,
        ),
        503,
      );
    }

    const apps = await listActiveGitHubApps(db);
    const registeredAppIds = new Set(apps.map((app) => app.appId));
    const restorableAppIds = listEnvGitHubAppIds(context.env).filter(
      (appId) => !registeredAppIds.has(appId),
    );

    const manifestState = crypto.randomUUID();
    setCookie(context, MANIFEST_STATE_COOKIE_NAME, manifestState, {
      path: DEV_LOCAL_SETUP_PATH,
      httpOnly: true,
      sameSite: "Lax",
      maxAge: MANIFEST_STATE_COOKIE_MAX_AGE_SECONDS,
    });
    const localhostOrigin = normalizeToLocalhostOrigin(new URL(context.req.url));
    const manifest = buildDevGitHubAppManifest(localhostOrigin, manifestState);

    const statusSection =
      apps.length > 0
        ? `<h2>Registered apps</h2><ul>${apps.map((app) => describeAppStatus(app, context.env)).join("")}</ul>
<p><a href="${GITHUB_OAUTH_LOGIN_PATH}">Sign in with GitHub</a></p>`
        : `<p>No GitHub App is registered in the local database yet.</p>`;

    const restoreSection =
      restorableAppIds.length > 0
        ? `<h2>Restore from .dev.vars</h2>
<p>Secrets for app${restorableAppIds.length === 1 ? "" : "s"} ${restorableAppIds.join(", ")} are
already loaded but the database has no matching row (typical after
<code>rm -rf .wrangler</code>).</p>
<form method="post" action="${DEV_LOCAL_SETUP_RESTORE_PATH}">
  <button class="primary" type="submit">Restore app row${restorableAppIds.length === 1 ? "" : "s"}</button>
</form>
<p>Equivalent: <code>curl -X POST http://localhost:5173${DEV_LOCAL_SETUP_RESTORE_PATH}</code></p>`
        : "";

    const authCookieSecretNote = readAuthCookieSecret(context.env)
      ? ""
      : `<p class="missing"><code>AUTH_COOKIE_SECRET</code> is not set — creating an app below includes one in the paste block.</p>`;

    const createSection = `<h2>Create a personal dev GitHub App</h2>
<p>GitHub opens a confirmation page pre-filled with nanites' default
permissions; one click registers the app and returns here.</p>
<form method="post" action="https://github.com/settings/apps/new?state=${encodeURIComponent(manifestState)}">
  <input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}" />
  <button class="primary" type="submit">Create dev GitHub App on GitHub</button>
</form>`;

    return context.html(
      renderDevSetupPage(
        "nanites local setup",
        `<h1>Local development setup</h1>
${statusSection}
${authCookieSecretNote}
${restoreSection}
${createSection}`,
      ),
    );
  })
  .get(DEV_LOCAL_SETUP_CALLBACK_PATH, async (context) => {
    const url = new URL(context.req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const expectedState = getCookie(context, MANIFEST_STATE_COOKIE_NAME);
    deleteCookie(context, MANIFEST_STATE_COOKIE_NAME, { path: DEV_LOCAL_SETUP_PATH });

    if (!code || !state || !expectedState || state !== expectedState) {
      return context.html(
        renderDevSetupPage(
          "nanites local setup",
          `<h1>Manifest callback rejected</h1>
<p>The callback was missing its code or its state did not match this browser's
cookie. <a href="${DEV_LOCAL_SETUP_PATH}">Start over</a>.</p>`,
        ),
        400,
      );
    }

    let conversion: GitHubAppManifestConversion;
    try {
      conversion = await convertGitHubAppManifestCode(code);
    } catch (error) {
      const detail = error instanceof AppError ? error.message : "Unexpected error.";
      return context.html(
        renderDevSetupPage(
          "nanites local setup",
          `<h1>GitHub rejected the manifest code</h1>
<p>${escapeHtml(detail)} Manifest codes are single-use and short-lived.
<a href="${DEV_LOCAL_SETUP_PATH}">Start over</a>.</p>`,
        ),
        502,
      );
    }

    const slug = requireConversionString(conversion, "slug");
    const permissions = readConversionPermissions(conversion);
    const events = readConversionEvents(conversion);
    await registerGitHubApp(createDbClient(context.env.DB), {
      appId: conversion.id,
      slug,
      htmlUrl: conversion.html_url,
      ownerLogin: conversion.owner?.login ?? null,
      ownerType:
        conversion.owner && "type" in conversion.owner ? (conversion.owner.type ?? null) : null,
      clientId: requireConversionString(conversion, "client_id"),
      permissions,
      events,
    });

    return context.html(
      renderDevSetupPage(
        "nanites local setup",
        renderPasteBlockSection({
          appId: conversion.id,
          slug,
          privateKey: requireConversionString(conversion, "pem"),
          clientSecret: requireConversionString(conversion, "client_secret"),
          // GitHub may omit the webhook secret when hooks start inactive; the
          // runtime requires the binding regardless, so mint one — nothing
          // verifies against it until live webhooks are configured.
          webhookSecret:
            typeof conversion.webhook_secret === "string" && conversion.webhook_secret.length > 0
              ? conversion.webhook_secret
              : randomHexToken(32),
          authCookieSecret: readAuthCookieSecret(context.env) ? null : randomBase64UrlToken(48),
          warnings: listManifestDriftWarnings(permissions, events),
        }),
      ),
    );
  })
  .post(DEV_LOCAL_SETUP_RESTORE_PATH, async (context) => {
    const db = createDbClient(context.env.DB);
    await requireGitHubAppsTableReady(db);

    const appIds = listEnvGitHubAppIds(context.env);
    if (appIds.length === 0) {
      return context.json(
        {
          restored: [],
          failed: [],
          error:
            "No GITHUB_APP_<id>_PRIVATE_KEY secrets found in env. Create an app at /setup/local first.",
        },
        400,
      );
    }

    const restored: { appId: number; slug: string; missingSecrets: string[] }[] = [];
    const failed: { appId: number; error: string }[] = [];
    for (const appId of appIds) {
      const bindings = buildGitHubAppSecretBindings(appId);
      const privateKey = readConfiguredSecret(context.env, bindings.privateKeyBinding);
      if (!privateKey) {
        continue;
      }

      try {
        const profile = await fetchAuthenticatedGitHubApp({ appId, privateKey });
        await registerGitHubApp(db, profile);
        restored.push({
          appId,
          slug: profile.slug,
          missingSecrets: [bindings.clientSecretBinding, bindings.webhookSecretBinding].filter(
            (bindingName) => readConfiguredSecret(context.env, bindingName) === null,
          ),
        });
      } catch {
        failed.push({
          appId,
          error:
            "GitHub rejected the credentials — the app was deleted or its key rotated. " +
            `Remove the GITHUB_APP_${appId}_* lines from .dev.vars and create a fresh app.`,
        });
      }
    }

    // Browser form posts land back on the status page; curl gets the summary.
    if (context.req.header("accept")?.includes("text/html")) {
      return context.redirect(DEV_LOCAL_SETUP_PATH, 303);
    }

    return context.json(
      { restored, failed },
      failed.length > 0 && restored.length === 0 ? 502 : 200,
    );
  });
