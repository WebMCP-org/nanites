import {
  DEFAULT_GITHUB_APP_SLUG,
  SIGVELO_GITHUB_APP_INSTALL_PATH,
  SIGVELO_GITHUB_APP_PERMISSIONS_PATH,
} from "#/shared/constants.ts";
import { emitterEventNames } from "@octokit/webhooks";
import type { EmitterWebhookEvent, EmitterWebhookEventName } from "@octokit/webhooks";
import type { WebhookEvents } from "@octokit/webhooks/types";
import { z } from "zod";
import { isRecord } from "#/shared/utils/values.ts";

export function buildGitHubAppInstallHref({
  appSlug,
  state,
  suggestedTargetId,
  repositoryIds = [],
}: {
  readonly appSlug?: string | null;
  readonly state?: string | null;
  readonly suggestedTargetId?: number | null;
  readonly repositoryIds?: readonly number[];
} = {}): string {
  const githubAppUrl = `https://github.com/apps/${appSlug ?? DEFAULT_GITHUB_APP_SLUG}`;
  const path = suggestedTargetId
    ? SIGVELO_GITHUB_APP_PERMISSIONS_PATH
    : SIGVELO_GITHUB_APP_INSTALL_PATH;
  const url = new URL(`${githubAppUrl}${path}`);

  if (state) {
    url.searchParams.set("state", state);
  }

  if (suggestedTargetId) {
    url.searchParams.set("suggested_target_id", String(suggestedTargetId));
  }

  for (const repositoryId of repositoryIds) {
    url.searchParams.append("repository_ids[]", String(repositoryId));
  }

  return url.toString();
}

export type GitHubWebhookEventName = WebhookEvents;

export type GitHubWebhookEventSnapshot = {
  id: string;
  name: GitHubWebhookEventName;
  payload: Record<string, unknown>;
};

export type GitHubTriggerTestEventParseResult =
  | {
      ok: true;
      event: GitHubWebhookEventSnapshot;
    }
  | {
      ok: false;
      reason: string;
    };

export type GitHubWebhookEventLike = EmitterWebhookEvent | GitHubWebhookEventSnapshot;

export const MAX_GITHUB_TRIGGER_TEST_EVENT_BYTES = 256 * 1024;

const githubEmitterWebhookEventNameSet = new Set<string>(emitterEventNames);
const githubBaseWebhookEventNameSet = new Set(
  emitterEventNames.map((eventName) => eventName.split(".", 1)[0]),
);

function isGitHubEmitterWebhookEventName(value: string): value is EmitterWebhookEventName {
  return githubEmitterWebhookEventNameSet.has(value);
}

function isGitHubBaseWebhookEventName(value: string): value is GitHubWebhookEventName {
  return !value.includes(".") && githubBaseWebhookEventNameSet.has(value);
}

export const githubTriggerTestEventInputSchema = z.object(
  {
    id: z
      .string()
      .min(1, "event.id must be a non-empty GitHub delivery id without surrounding whitespace.")
      .refine(
        (value) => value.trim() === value,
        "event.id must be a non-empty GitHub delivery id without surrounding whitespace.",
      ),
    name: z.string().refine(isGitHubBaseWebhookEventName, {
      message:
        "event.name must be a base GitHub webhook event name such as push, issues, pull_request, or workflow_run.",
    }),
    payload: z.record(z.string(), z.unknown()),
  },
  { error: "event must be an object." },
);

export type GitHubTriggerTestEventInput = z.input<typeof githubTriggerTestEventInputSchema>;

function invalidGitHubTriggerTestEvent(reason: string): GitHubTriggerTestEventParseResult {
  return { ok: false, reason };
}

function describeGitHubTriggerTestEventParseError(error: z.ZodError): string {
  if (error.issues.some((issue) => issue.path[0] === "payload")) {
    return "event.payload must be an object.";
  }

  return error.issues[0]?.message ?? "event must be an object.";
}

export function parseGitHubTriggerTestEvent(
  input: unknown,
  expectedInstallationId: number,
): GitHubTriggerTestEventParseResult {
  const parsed = githubTriggerTestEventInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidGitHubTriggerTestEvent(describeGitHubTriggerTestEventParseError(parsed.error));
  }

  const event = {
    id: parsed.data.id,
    name: parsed.data.name as GitHubWebhookEventName,
    payload: parsed.data.payload,
  } satisfies GitHubWebhookEventSnapshot;
  const installationId = getGitHubWebhookInstallationId(event);
  if (installationId === null || !Number.isInteger(installationId) || installationId <= 0) {
    return invalidGitHubTriggerTestEvent(
      "event.payload.installation.id must be a positive integer.",
    );
  }
  if (installationId !== expectedInstallationId) {
    return invalidGitHubTriggerTestEvent(
      `event.payload.installation.id must match manager installation ${expectedInstallationId}; received ${installationId}.`,
    );
  }

  const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength;
  if (bytes > MAX_GITHUB_TRIGGER_TEST_EVENT_BYTES) {
    return invalidGitHubTriggerTestEvent(
      `event must serialize to ${MAX_GITHUB_TRIGGER_TEST_EVENT_BYTES} bytes or less; received ${bytes}.`,
    );
  }

  return { ok: true, event };
}

/**
 * Reads `payload.installation.id` from any Octokit webhook event.
 *
 * Use this at GitHub webhook intake boundaries when routing the event to an
 * installation-scoped manager. Not every GitHub webhook payload includes an installation object,
 * so callers must handle `null`.
 */
export function getGitHubWebhookInstallationId(event: GitHubWebhookEventLike): number | null {
  const { payload } = event;
  if (!("installation" in payload) || !isRecord(payload.installation)) {
    return null;
  }

  return typeof payload.installation.id === "number" ? payload.installation.id : null;
}

/**
 * Reads `payload.repository.full_name` from any Octokit webhook event.
 *
 * Use this for cheap repository-scoped logging, filtering, and display while preserving the
 * original Octokit event object. Some organization, app, and marketplace webhooks are not tied to
 * a repository, so callers must handle `null`.
 */
export function getGitHubWebhookRepositoryFullName(event: GitHubWebhookEventLike): string | null {
  const { payload } = event;
  if (!("repository" in payload) || !isRecord(payload.repository)) {
    return null;
  }

  return typeof payload.repository.full_name === "string" ? payload.repository.full_name : null;
}

/**
 * Reads `payload.repository.id` from any Octokit webhook event.
 *
 * Use this for metrics or persistence keys only when the incoming event actually has a repository.
 * Repository-less GitHub events return `null`.
 */
export function getGitHubWebhookRepositoryId(event: GitHubWebhookEventLike): number | null {
  const { payload } = event;
  if (!("repository" in payload) || !isRecord(payload.repository)) {
    return null;
  }

  return typeof payload.repository.id === "number" ? payload.repository.id : null;
}

/**
 * Reads `payload.action` from any Octokit webhook event.
 *
 * Use this for action-specific routing such as `pull_request.opened`. Payloads without GitHub's
 * `action` field return `null`; do not infer an action from the event name.
 */
export function getGitHubWebhookAction(event: GitHubWebhookEventLike): string | null {
  return "action" in event.payload && typeof event.payload.action === "string"
    ? event.payload.action
    : null;
}

/**
 * Returns the Octokit emitter event name for a webhook event.
 *
 * For action payloads this returns the action-specific name, such as `pull_request.opened`.
 * For events without an action, such as `push`, it returns `event.name`. Use this for candidate
 * filters, generated-trigger cache keys, and log attributes. It does not wrap or rename the event.
 */
export function getGitHubWebhookEventName(event: GitHubWebhookEventLike): EmitterWebhookEventName {
  const action = getGitHubWebhookAction(event);
  const eventName = action ? `${event.name}.${action}` : event.name;
  return isGitHubEmitterWebhookEventName(eventName) ? eventName : event.name;
}

/**
 * Reads the most useful branch name from common repository webhook events.
 *
 * `push` uses `payload.ref` and pull request events use `payload.pull_request.base.ref`. Events
 * without a branch-like field return `null`. Use this only as a cheap candidate filter or display
 * hint; generated trigger code should inspect the full Octokit payload when it needs exact event
 * semantics.
 */
export function getGitHubWebhookBranch(event: GitHubWebhookEventLike): string | null {
  const { payload } = event;
  if ("ref" in payload && typeof payload.ref === "string") {
    return payload.ref.replace(/^refs\/heads\//, "");
  }

  if (!("pull_request" in payload) || !isRecord(payload.pull_request)) {
    return null;
  }

  const base = payload.pull_request.base;
  return isRecord(base) && typeof base.ref === "string" ? base.ref : null;
}

/**
 * Reads `payload.pull_request.number` from pull request-like webhook events.
 *
 * Use this for display links and run dedupe keys. Non-pull-request events return `null`.
 */
export function getGitHubWebhookPullRequestNumber(event: GitHubWebhookEventLike): number | null {
  const { payload } = event;
  if (!("pull_request" in payload) || !isRecord(payload.pull_request)) {
    return null;
  }

  return typeof payload.pull_request.number === "number" ? payload.pull_request.number : null;
}

/**
 * Reads the most useful head commit SHA from common repository webhook events.
 *
 * `push` uses `payload.after` and pull request events use `payload.pull_request.head.sha`.
 * Events without either field return `null`. Use this for display links and dedupe keys, not as a
 * substitute for inspecting the full Octokit payload in generated trigger code.
 */
export function getGitHubWebhookHeadSha(event: GitHubWebhookEventLike): string | null {
  const { payload } = event;
  if ("after" in payload && typeof payload.after === "string") {
    return payload.after;
  }

  if (!("pull_request" in payload) || !isRecord(payload.pull_request)) {
    return null;
  }

  const head = payload.pull_request.head;
  return isRecord(head) && typeof head.sha === "string" ? head.sha : null;
}

/**
 * Builds the JSON-only webhook event stored in manager state and returned over Durable Object RPC.
 *
 * Generated trigger code still receives Octokit's `EmitterWebhookEvent` directly at intake time. This
 * snapshot is for persistence, UI display, and RPC return values, where Workers' RPC type system
 * requires statically serializable shapes.
 */
export function snapshotGitHubWebhookEvent(
  event: GitHubWebhookEventLike,
): GitHubWebhookEventSnapshot {
  return JSON.parse(
    JSON.stringify({
      id: event.id,
      name: event.name,
      payload: event.payload,
    }),
  ) as GitHubWebhookEventSnapshot;
}
