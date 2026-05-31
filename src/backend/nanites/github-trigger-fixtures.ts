import type {
  GitHubPullRequestTriggerAction,
  GitHubPullRequestWebhookPayload,
  GitHubPushWebhookPayload,
} from "#/backend/github-types.ts";

type DeepPartial<T> = T extends readonly (infer TItem)[]
  ? readonly DeepPartial<TItem>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type GitHubPullRequestFixtureId =
  | "github.pull_request.opened"
  | "github.pull_request.synchronize"
  | "github.pull_request.reopened"
  | "github.pull_request.closed";
export type GitHubPushFixtureId = "github.push";
export type GitHubTriggerFixtureId = GitHubPullRequestFixtureId | GitHubPushFixtureId;

export type GitHubPullRequestFixtureOverrides = DeepPartial<{
  action: GitHubPullRequestTriggerAction;
  installation: {
    id: number;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    default_branch: string;
    private: boolean;
    owner: {
      login: string;
    };
  };
  pull_request: {
    number: number;
    html_url: string;
    head: {
      sha: string;
      ref: string;
    };
    base: {
      ref: string;
    };
  };
}>;

export type GitHubPushFixtureOverrides = DeepPartial<{
  ref: string;
  after: string;
  installation: {
    id: number;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    default_branch: string;
    private: boolean;
    owner: {
      login: string;
    };
  };
  commits: Array<{
    id: string;
    added: string[];
    modified: string[];
    removed: string[];
  }>;
}>;

function actionFromFixture(fixture: GitHubPullRequestFixtureId): GitHubPullRequestTriggerAction {
  switch (fixture) {
    case "github.pull_request.opened":
      return "opened";
    case "github.pull_request.synchronize":
      return "synchronize";
    case "github.pull_request.reopened":
      return "reopened";
    case "github.pull_request.closed":
      return "closed";
  }
}

export function buildGitHubPullRequestFixture(input: {
  fixture: GitHubPullRequestFixtureId;
  installationId: number;
  overrides?: GitHubPullRequestFixtureOverrides;
}): GitHubPullRequestWebhookPayload {
  const overrides = input.overrides ?? {};
  const repository = overrides.repository ?? {};
  const repositoryOwner = repository.owner ?? {};
  const pullRequest = overrides.pull_request ?? {};
  const pullRequestHead = pullRequest.head ?? {};
  const pullRequestBase = pullRequest.base ?? {};
  const installation = overrides.installation ?? {};
  const repositoryFullName = repository.full_name ?? "WebMCP-org/nanites";
  const [, fallbackRepoName = "sigvelo"] = repositoryFullName.split("/", 2);
  const uniqueSha = crypto.randomUUID().replaceAll("-", "").slice(0, 12);

  const payload = {
    action: overrides.action ?? actionFromFixture(input.fixture),
    repository: {
      id: repository.id ?? 101,
      name: repository.name ?? fallbackRepoName,
      full_name: repositoryFullName,
      default_branch: repository.default_branch ?? "main",
      private: repository.private ?? true,
      owner: {
        login: repositoryOwner.login ?? repositoryFullName.split("/", 1)[0] ?? "WebMCP-org",
      },
    },
    installation: {
      id: installation.id ?? input.installationId,
    },
    pull_request: {
      number: pullRequest.number ?? 21,
      html_url:
        pullRequest.html_url ??
        `https://github.com/${repositoryFullName}/pull/${pullRequest.number ?? 21}`,
      head: {
        sha: pullRequestHead.sha ?? `test${uniqueSha}`,
        ref: pullRequestHead.ref ?? "sigvelo-trigger-test",
      },
      base: {
        ref: pullRequestBase.ref ?? "main",
      },
    },
  };

  return payload as unknown as GitHubPullRequestWebhookPayload;
}

export function buildGitHubPushFixture(input: {
  installationId: number;
  overrides?: GitHubPushFixtureOverrides;
}): GitHubPushWebhookPayload {
  const overrides = input.overrides ?? {};
  const repository = overrides.repository ?? {};
  const repositoryOwner = repository.owner ?? {};
  const installation = overrides.installation ?? {};
  const repositoryFullName = repository.full_name ?? "WebMCP-org/nanites";
  const [, fallbackRepoName = "sigvelo"] = repositoryFullName.split("/", 2);
  const uniqueSha = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const after = overrides.after ?? `test${uniqueSha}`;

  const payload = {
    ref: overrides.ref ?? "refs/heads/main",
    before: "0000000000000000000000000000000000000000",
    after,
    repository: {
      id: repository.id ?? 101,
      name: repository.name ?? fallbackRepoName,
      full_name: repositoryFullName,
      default_branch: repository.default_branch ?? "main",
      private: repository.private ?? true,
      owner: {
        login: repositoryOwner.login ?? repositoryFullName.split("/", 1)[0] ?? "WebMCP-org",
      },
    },
    installation: {
      id: installation.id ?? input.installationId,
    },
    commits: overrides.commits ?? [
      {
        id: after,
        added: [],
        modified: ["README.md"],
        removed: [],
      },
    ],
  };

  return payload as unknown as GitHubPushWebhookPayload;
}
