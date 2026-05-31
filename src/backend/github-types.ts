import type { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";
import type { EmitterWebhookEvent, EmitterWebhookEventName } from "@octokit/webhooks";

export const SUPPORTED_GITHUB_PULL_REQUEST_EVENT_NAMES = [
  "pull_request.opened",
  "pull_request.reopened",
  "pull_request.synchronize",
  "pull_request.closed",
] as const satisfies readonly Extract<EmitterWebhookEventName, `pull_request.${string}`>[];

export const GITHUB_PUSH_EVENT_NAME = "push" as const satisfies Extract<
  EmitterWebhookEventName,
  "push"
>;

export type GitHubPullRequestWebhookEvent = EmitterWebhookEvent<
  (typeof SUPPORTED_GITHUB_PULL_REQUEST_EVENT_NAMES)[number]
>;
export type GitHubPushWebhookEvent = EmitterWebhookEvent<typeof GITHUB_PUSH_EVENT_NAME>;

export type GitHubPullRequestWebhookPayload = GitHubPullRequestWebhookEvent["payload"];
export type GitHubPushWebhookPayload = GitHubPushWebhookEvent["payload"];

export type GitHubPullRequestTriggerAction = GitHubPullRequestWebhookPayload["action"];
export const githubPullRequestTriggerActions = [
  "opened",
  "reopened",
  "synchronize",
  "closed",
] as const satisfies readonly GitHubPullRequestTriggerAction[];

export type GitHubInstallationTokenPermissions = NonNullable<
  RestEndpointMethodTypes["apps"]["createInstallationAccessToken"]["parameters"]["permissions"]
>;

export const githubAppPermissionNames = [
  "actions",
  "checks",
  "contents",
  "issues",
  "pull_requests",
] as const satisfies readonly (keyof GitHubInstallationTokenPermissions)[];
export type GitHubAppPermissionName = (typeof githubAppPermissionNames)[number];
export type GitHubAppPermissions = Partial<
  Pick<GitHubInstallationTokenPermissions, GitHubAppPermissionName>
>;
