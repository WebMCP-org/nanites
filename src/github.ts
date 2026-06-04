import type { EmitterWebhookEvent, EmitterWebhookEventName } from "@octokit/webhooks";

const SIGVELO_GITHUB_APP_SLUG = "sigvelo";
export const SIGVELO_GITHUB_APP_URL = `https://github.com/apps/${SIGVELO_GITHUB_APP_SLUG}`;

const SIGVELO_GITHUB_APP_INSTALL_PATH = "/installations/new";
const SIGVELO_GITHUB_APP_PERMISSIONS_PATH = `${SIGVELO_GITHUB_APP_INSTALL_PATH}/permissions`;

export const GITHUB_WEBHOOK_PATH = "/api/github/webhook";

interface BuildGitHubAppInstallHrefOptions {
  readonly state?: string | null;
  readonly suggestedTargetId?: number | null;
  readonly repositoryIds?: readonly number[];
}

export function buildGitHubAppInstallHref({
  state,
  suggestedTargetId,
  repositoryIds = [],
}: BuildGitHubAppInstallHrefOptions = {}): string {
  const path = suggestedTargetId
    ? SIGVELO_GITHUB_APP_PERMISSIONS_PATH
    : SIGVELO_GITHUB_APP_INSTALL_PATH;
  const url = new URL(`${SIGVELO_GITHUB_APP_URL}${path}`);

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

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };

export type GitHubWebhookEventSnapshot = {
  id: string;
  name: EmitterWebhookEvent["name"];
  payload: {
    [key: string]: JsonValue;
  };
};

type GitHubWebhookEventLike = EmitterWebhookEvent | GitHubWebhookEventSnapshot;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  return (action ? `${event.name}.${action}` : event.name) as EmitterWebhookEventName;
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
export function snapshotGitHubWebhookEvent(event: EmitterWebhookEvent): GitHubWebhookEventSnapshot {
  return JSON.parse(
    JSON.stringify({
      id: event.id,
      name: event.name,
      payload: event.payload,
    }),
  ) as GitHubWebhookEventSnapshot;
}
