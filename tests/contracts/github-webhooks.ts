import type { EmitterWebhookEvent } from "@octokit/webhooks";

type PullRequestWebhookPayload = EmitterWebhookEvent<"pull_request.opened">["payload"];
type PushWebhookPayload = EmitterWebhookEvent<"push">["payload"];
type CheckRunCompletedWebhookPayload = EmitterWebhookEvent<"check_run.completed">["payload"];
type DeploymentStatusWebhookPayload = EmitterWebhookEvent<"deployment_status">["payload"];
const emptyCheckRunPullRequests: CheckRunCompletedWebhookPayload["check_run"]["pull_requests"] = [];

type GitHubPullRequestWebhookFixture = {
  action: PullRequestWebhookPayload["action"];
  installation: {
    id: NonNullable<PullRequestWebhookPayload["installation"]>["id"];
  };
  repository: {
    id: PullRequestWebhookPayload["repository"]["id"];
    name: PullRequestWebhookPayload["repository"]["name"];
    full_name: PullRequestWebhookPayload["repository"]["full_name"];
    default_branch: PullRequestWebhookPayload["repository"]["default_branch"];
    private: PullRequestWebhookPayload["repository"]["private"];
    owner: {
      login: PullRequestWebhookPayload["repository"]["owner"]["login"];
    };
  };
  pull_request: {
    number: PullRequestWebhookPayload["pull_request"]["number"];
    html_url: PullRequestWebhookPayload["pull_request"]["html_url"];
    head: {
      sha: PullRequestWebhookPayload["pull_request"]["head"]["sha"];
      ref: PullRequestWebhookPayload["pull_request"]["head"]["ref"];
    };
    base: {
      ref: PullRequestWebhookPayload["pull_request"]["base"]["ref"];
    };
  };
};

type GitHubCheckRunCompletedWebhookFixture = {
  action: CheckRunCompletedWebhookPayload["action"];
  installation: {
    id: NonNullable<CheckRunCompletedWebhookPayload["installation"]>["id"];
  };
  repository: {
    id: CheckRunCompletedWebhookPayload["repository"]["id"];
  };
  check_run: {
    id: CheckRunCompletedWebhookPayload["check_run"]["id"];
    name: CheckRunCompletedWebhookPayload["check_run"]["name"];
    head_sha: CheckRunCompletedWebhookPayload["check_run"]["head_sha"];
    details_url: CheckRunCompletedWebhookPayload["check_run"]["details_url"];
    status: CheckRunCompletedWebhookPayload["check_run"]["status"];
    conclusion: CheckRunCompletedWebhookPayload["check_run"]["conclusion"];
    app: {
      id: number;
    };
    check_suite: {
      id: number;
      head_sha: string;
    };
    pull_requests: readonly DeepPartial<
      CheckRunCompletedWebhookPayload["check_run"]["pull_requests"][number]
    >[];
  };
};

type GitHubPushWebhookFixture = {
  ref: PushWebhookPayload["ref"];
  after: PushWebhookPayload["after"];
  installation: {
    id: NonNullable<PushWebhookPayload["installation"]>["id"];
  };
  repository: {
    id: PushWebhookPayload["repository"]["id"];
    name: PushWebhookPayload["repository"]["name"];
    full_name: PushWebhookPayload["repository"]["full_name"];
    default_branch: PushWebhookPayload["repository"]["default_branch"];
    private: PushWebhookPayload["repository"]["private"];
    owner: {
      login: NonNullable<PushWebhookPayload["repository"]["owner"]>["login"];
    };
  };
};

type GitHubDeploymentStatusWebhookFixture = {
  action: DeploymentStatusWebhookPayload["action"];
  installation: {
    id: NonNullable<DeploymentStatusWebhookPayload["installation"]>["id"];
  };
  repository: {
    id: DeploymentStatusWebhookPayload["repository"]["id"];
  };
  deployment: {
    id: DeploymentStatusWebhookPayload["deployment"]["id"];
    sha: DeploymentStatusWebhookPayload["deployment"]["sha"];
  };
  deployment_status: {
    id: DeploymentStatusWebhookPayload["deployment_status"]["id"];
    state: DeploymentStatusWebhookPayload["deployment_status"]["state"];
    log_url: DeploymentStatusWebhookPayload["deployment_status"]["log_url"];
    target_url: DeploymentStatusWebhookPayload["deployment_status"]["target_url"];
    environment_url: DeploymentStatusWebhookPayload["deployment_status"]["environment_url"];
  };
};

type DeepPartial<T> = T extends readonly (infer TItem)[]
  ? readonly DeepPartial<TItem>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export function buildPullRequestWebhookPayload(
  overrides: DeepPartial<GitHubPullRequestWebhookFixture> = {},
): GitHubPullRequestWebhookFixture {
  const repository = overrides.repository ?? {};
  const repositoryOwner = repository.owner ?? {};
  const pullRequest = overrides.pull_request ?? {};
  const pullRequestHead = pullRequest.head ?? {};
  const pullRequestBase = pullRequest.base ?? {};
  const installation = overrides.installation ?? {};

  return {
    action: overrides.action ?? "opened",
    repository: {
      id: repository.id ?? 101,
      name: repository.name ?? "nanites",
      full_name: repository.full_name ?? "WebMCP-org/nanites",
      default_branch: repository.default_branch ?? "main",
      private: repository.private ?? true,
      owner: {
        login: repositoryOwner.login ?? "WebMCP-org",
      },
    },
    installation: {
      id: installation.id ?? 1,
    },
    pull_request: {
      number: pullRequest.number ?? 21,
      html_url: pullRequest.html_url ?? "https://github.com/WebMCP-org/nanites/pull/21",
      head: {
        sha: pullRequestHead.sha ?? "abc123def456",
        ref: pullRequestHead.ref ?? "feature/testing-foundation",
      },
      base: {
        ref: pullRequestBase.ref ?? "main",
      },
    },
  };
}

export function buildPushWebhookPayload(
  overrides: DeepPartial<GitHubPushWebhookFixture> = {},
): GitHubPushWebhookFixture {
  const repository = overrides.repository ?? {};
  const repositoryOwner = repository.owner ?? {};
  const installation = overrides.installation ?? {};

  return {
    ref: overrides.ref ?? "refs/heads/main",
    after: overrides.after ?? "def456abc123",
    repository: {
      id: repository.id ?? 101,
      name: repository.name ?? "nanites",
      full_name: repository.full_name ?? "WebMCP-org/nanites",
      default_branch: repository.default_branch ?? "main",
      private: repository.private ?? true,
      owner: {
        login: repositoryOwner.login ?? "WebMCP-org",
      },
    },
    installation: {
      id: installation.id ?? 1,
    },
  };
}

export function buildCheckRunCompletedWebhookPayload(
  overrides: DeepPartial<GitHubCheckRunCompletedWebhookFixture> = {},
): GitHubCheckRunCompletedWebhookFixture {
  const installation = overrides.installation ?? {};
  const repository = overrides.repository ?? {};
  const checkRun = overrides.check_run ?? {};
  const checkRunApp = checkRun.app ?? {};
  const checkSuite = checkRun.check_suite ?? {};

  return {
    action: overrides.action ?? "completed",
    repository: {
      id: repository.id ?? 101,
    },
    installation: {
      id: installation.id ?? 1,
    },
    check_run: {
      id: checkRun.id ?? 123,
      name: checkRun.name ?? "Nanites",
      head_sha: checkRun.head_sha ?? "abc123def456",
      details_url: checkRun.details_url ?? "https://github.com/WebMCP-org/nanites/runs/123",
      status: checkRun.status ?? "completed",
      conclusion: checkRun.conclusion ?? "success",
      app: {
        id: checkRunApp.id ?? 1,
      },
      check_suite: {
        id: checkSuite.id ?? 10,
        head_sha: checkSuite.head_sha ?? "abc123def456",
      },
      pull_requests: checkRun.pull_requests ?? emptyCheckRunPullRequests,
    },
  };
}

export function buildDeploymentStatusWebhookPayload(
  overrides: DeepPartial<GitHubDeploymentStatusWebhookFixture> = {},
): GitHubDeploymentStatusWebhookFixture {
  const installation = overrides.installation ?? {};
  const repository = overrides.repository ?? {};
  const deployment = overrides.deployment ?? {};
  const deploymentStatus = overrides.deployment_status ?? {};

  return {
    action: overrides.action ?? "created",
    repository: {
      id: repository.id ?? 101,
    },
    installation: {
      id: installation.id ?? 1,
    },
    deployment: {
      id: deployment.id ?? 501,
      sha: deployment.sha ?? "abc123def456",
    },
    deployment_status: {
      id: deploymentStatus.id ?? 601,
      state: deploymentStatus.state ?? "success",
      log_url: deploymentStatus.log_url ?? "https://example.com/logs/601",
      target_url: deploymentStatus.target_url ?? "https://example.com/preview/601",
      environment_url: deploymentStatus.environment_url ?? "https://example.com/env/601",
    },
  };
}
