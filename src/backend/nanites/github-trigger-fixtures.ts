import type { EmitterWebhookEvent } from "@octokit/webhooks";

type DeepPartial<T> = T extends readonly (infer TItem)[]
  ? readonly DeepPartial<TItem>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type GitHubPullRequestFixtureId =
  | "pull_request.opened"
  | "pull_request.synchronize"
  | "pull_request.reopened"
  | "pull_request.closed";
export type GitHubPushFixtureId = "push";
export type GitHubTriggerFixtureId = GitHubPullRequestFixtureId | GitHubPushFixtureId;

export const githubPullRequestFixtureIds = [
  "pull_request.opened",
  "pull_request.synchronize",
  "pull_request.reopened",
  "pull_request.closed",
] as const satisfies readonly GitHubPullRequestFixtureId[];
export const githubPushFixtureIds = ["push"] as const satisfies readonly GitHubPushFixtureId[];
export const githubTriggerFixtureIds = [
  ...githubPullRequestFixtureIds,
  ...githubPushFixtureIds,
] as const satisfies readonly GitHubTriggerFixtureId[];

export type GitHubPullRequestFixtureOverrides = DeepPartial<
  EmitterWebhookEvent<GitHubPullRequestFixtureId>["payload"]
>;

export type GitHubPushFixtureOverrides = DeepPartial<EmitterWebhookEvent<"push">["payload"]>;

export type GitHubTriggerFixtureOverrides =
  | GitHubPullRequestFixtureOverrides
  | GitHubPushFixtureOverrides;

const DEFAULT_REPOSITORY_FULL_NAME = "WebMCP-org/nanites";
const DEFAULT_REPOSITORY_ID = 101;
const DEFAULT_REPOSITORY_OWNER = "WebMCP-org";
const DEFAULT_REPOSITORY_NAME = "nanites";
const DEFAULT_BRANCH = "main";
const DEFAULT_PULL_REQUEST_NUMBER = 21;
const DEFAULT_TRIGGER_BRANCH = "sigvelo-trigger-test";
const EMPTY_SHA = "0000000000000000000000000000000000000000";

function valueOr<T>(value: T | null | undefined, fallback: T): T {
  return value ?? fallback;
}

function randomTestSha(): string {
  return `test${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function buildFixtureRepository(
  repository?:
    | GitHubPullRequestFixtureOverrides["repository"]
    | GitHubPushFixtureOverrides["repository"],
) {
  const full_name = valueOr(repository?.full_name, DEFAULT_REPOSITORY_FULL_NAME);
  return {
    id: valueOr(repository?.id, DEFAULT_REPOSITORY_ID),
    name: valueOr(repository?.name, DEFAULT_REPOSITORY_NAME),
    full_name,
    default_branch: valueOr(repository?.default_branch, DEFAULT_BRANCH),
    private: valueOr(repository?.private, true),
    owner: {
      login: valueOr(repository?.owner?.login, DEFAULT_REPOSITORY_OWNER),
    },
  };
}

function buildFixtureInstallation(
  installation:
    | GitHubPullRequestFixtureOverrides["installation"]
    | GitHubPushFixtureOverrides["installation"],
  installationId: number,
) {
  return {
    id: valueOr(installation?.id, installationId),
  };
}

function actionFromFixture(
  fixture: GitHubPullRequestFixtureId,
): EmitterWebhookEvent<GitHubPullRequestFixtureId>["payload"]["action"] {
  switch (fixture) {
    case "pull_request.opened":
      return "opened";
    case "pull_request.synchronize":
      return "synchronize";
    case "pull_request.reopened":
      return "reopened";
    case "pull_request.closed":
      return "closed";
  }
}

export function buildGitHubPullRequestFixture(input: {
  fixture: GitHubPullRequestFixtureId;
  deliveryId: string;
  installationId: number;
  overrides?: GitHubPullRequestFixtureOverrides;
}): EmitterWebhookEvent<GitHubPullRequestFixtureId> {
  const overrides = input.overrides ?? {};
  const pullRequest = overrides.pull_request ?? {};
  const pullRequestHead = pullRequest.head ?? {};
  const pullRequestBase = pullRequest.base ?? {};
  const repository = buildFixtureRepository(overrides.repository);
  const pullRequestNumber = valueOr(pullRequest.number, DEFAULT_PULL_REQUEST_NUMBER);

  const payload = {
    action: valueOr(overrides.action, actionFromFixture(input.fixture)),
    repository,
    installation: buildFixtureInstallation(overrides.installation, input.installationId),
    pull_request: {
      number: pullRequestNumber,
      html_url:
        pullRequest.html_url ??
        `https://github.com/${repository.full_name}/pull/${pullRequestNumber}`,
      head: {
        sha: valueOr(pullRequestHead.sha, randomTestSha()),
        ref: valueOr(pullRequestHead.ref, DEFAULT_TRIGGER_BRANCH),
      },
      base: {
        ref: valueOr(pullRequestBase.ref, DEFAULT_BRANCH),
      },
    },
  } satisfies GitHubPullRequestFixtureOverrides;

  return {
    id: input.deliveryId,
    name: "pull_request",
    payload,
  } as EmitterWebhookEvent<GitHubPullRequestFixtureId>;
}

export function buildGitHubPushFixture(input: {
  deliveryId: string;
  installationId: number;
  overrides?: GitHubPushFixtureOverrides;
}): EmitterWebhookEvent<"push"> {
  const overrides = input.overrides ?? {};
  const after = valueOr(overrides.after, randomTestSha());

  const payload = {
    ref: valueOr(overrides.ref, `refs/heads/${DEFAULT_BRANCH}`),
    before: EMPTY_SHA,
    after,
    repository: buildFixtureRepository(overrides.repository),
    installation: buildFixtureInstallation(overrides.installation, input.installationId),
    commits: valueOr(overrides.commits, [
      {
        id: after,
        added: [],
        modified: ["README.md"],
        removed: [],
      },
    ]),
  } satisfies GitHubPushFixtureOverrides;

  return {
    id: input.deliveryId,
    name: "push",
    payload,
  } as EmitterWebhookEvent<"push">;
}

export function buildGitHubTriggerFixture(input: {
  fixture: GitHubTriggerFixtureId;
  deliveryId: string;
  installationId: number;
  overrides?: GitHubTriggerFixtureOverrides;
}): EmitterWebhookEvent {
  return input.fixture === "push"
    ? buildGitHubPushFixture({
        deliveryId: input.deliveryId,
        installationId: input.installationId,
        overrides: input.overrides as GitHubPushFixtureOverrides | undefined,
      })
    : buildGitHubPullRequestFixture({
        fixture: input.fixture,
        deliveryId: input.deliveryId,
        installationId: input.installationId,
        overrides: input.overrides as GitHubPullRequestFixtureOverrides | undefined,
      });
}
