import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import type { NaniteGitHubCheckOutput, NaniteRunKey } from "@nanites/contracts/nanites";
import { NANITES_CHECK_RUN_NAME } from "#/shared/constants/nanites.ts";

type GitHubChecksCreateParameters = RestEndpointMethodTypes["checks"]["create"]["parameters"];
type GitHubChecksUpdateParameters = RestEndpointMethodTypes["checks"]["update"]["parameters"];
export type GitHubCheckRun = RestEndpointMethodTypes["checks"]["create"]["response"]["data"];

export type GitHubCheckRunCreateStatus = NonNullable<GitHubChecksCreateParameters["status"]>;
export type GitHubCheckRunUpdateStatus = NonNullable<GitHubChecksUpdateParameters["status"]>;
export type GitHubCheckRunConclusion = NonNullable<GitHubChecksUpdateParameters["conclusion"]>;

export function buildCreateGitHubCheckRunRequest(input: {
  owner: string;
  repo: string;
  name: string;
  headSha: string;
  runKey: NaniteRunKey;
  startedAt: string;
  detailsUrl: string | null;
  output: NaniteGitHubCheckOutput;
  status: GitHubCheckRunCreateStatus;
}): GitHubChecksCreateParameters {
  return {
    owner: input.owner,
    repo: input.repo,
    name: input.name || NANITES_CHECK_RUN_NAME,
    head_sha: input.headSha,
    external_id: input.runKey,
    started_at: input.startedAt,
    status: input.status,
    details_url: input.detailsUrl ?? undefined,
    output: {
      title: input.output.title,
      summary: input.output.summary,
      text: input.output.text,
    },
  };
}

export function buildUpdateGitHubCheckRunRequest(input: {
  owner: string;
  repo: string;
  checkRunId: number;
  detailsUrl: string | null;
  output: NaniteGitHubCheckOutput;
  status: GitHubCheckRunUpdateStatus;
  conclusion?: GitHubCheckRunConclusion | null;
  completedAt?: string | null;
}): GitHubChecksUpdateParameters {
  return {
    owner: input.owner,
    repo: input.repo,
    check_run_id: input.checkRunId,
    status: input.status,
    ...(input.status === "completed"
      ? {
          conclusion: input.conclusion ?? "neutral",
          completed_at: input.completedAt ?? new Date().toISOString(),
        }
      : {}),
    details_url: input.detailsUrl ?? undefined,
    output: {
      title: input.output.title,
      summary: input.output.summary,
      text: input.output.text,
    },
  };
}
