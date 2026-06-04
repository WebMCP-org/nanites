import "./nanites.css";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { DetailedError, parseResponse } from "hono/client";
import type { InferRequestType } from "hono/client";
import { z } from "zod";
import { httpClient } from "#/frontend/lib/http-client.ts";
import { Avatar } from "#/frontend/ui/components/Avatar.tsx";
import { Button } from "#/frontend/ui/components/Button.tsx";
import { Card } from "#/frontend/ui/components/Card.tsx";
import {
  CodeBlock,
  CodeBlockContainer,
  CodeBlockContent,
  type CodeBlockLanguage,
} from "#/frontend/ui/components/CodeBlock.tsx";
import { FileTree, FileTreeFile, FileTreeFolder } from "#/frontend/ui/components/FileTree.tsx";
import { Popover } from "#/frontend/ui/components/Popover.tsx";
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  ChatCircleTextIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  DotOutlineIcon,
  FileIcon,
  FolderSimpleIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  GithubLogoIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  PlugsIcon,
  SlidersHorizontalIcon,
  SidebarSimpleIcon,
  SignOutIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { BrowserNanitesContext, SessionInstallationSnapshot } from "#/frontend/lib/auth.ts";
import type {
  DeprovisionNanitesOutput,
  ManagedNanite,
  NaniteManagerState,
  NaniteManifest,
  NaniteRuntimeActivity,
  NaniteRunRecord,
  NaniteRunStatus,
  SigveloNaniteManager,
  TestNaniteTriggerInput,
  TestNaniteTriggerOutput,
} from "#/backend/agents/SigveloNaniteManager.ts";
import type {
  NaniteAgentState,
  NaniteWorkspaceInfo,
  SigveloNaniteAgent,
} from "#/backend/agents/SigveloNaniteAgent.ts";
import type { FileInfo } from "@cloudflare/shell";
import {
  ManagerRuntimeChatConnector,
  NaniteRuntimeChatConnector,
  NaniteRuntimeChatLoading,
  NaniteRuntimeChatPlaceholder,
} from "#/frontend/routes/_authenticated/nanites/-runtime-chat.tsx";
import { RoutePendingPage } from "#/frontend/lib/route-state.tsx";
import {
  AUTH_SESSION_QUERY_KEY,
  buildReturnToPath,
  fetchOptionalSession,
  invalidateAuthQueries,
} from "#/frontend/lib/auth.ts";
import { NANITE_AGENT_NAME, NANITE_MANAGER_NAME } from "#/nanites.ts";
import { buildNaniteManagerKey } from "#/nanites.ts";
import { buildGitHubAppInstallHref, SIGVELO_GITHUB_APP_URL } from "#/github.ts";
import {
  getGitHubWebhookAction,
  getGitHubWebhookBranch,
  getGitHubWebhookEventName,
  getGitHubWebhookHeadSha,
  getGitHubWebhookPullRequestNumber,
  getGitHubWebhookRepositoryFullName,
} from "#/github.ts";

const emptyState: NaniteManagerState = {
  nanites: {},
  runs: {},
  runOrder: [],
  runtimeActivityByNanite: {},
  updatedAt: null,
};
const visibleInstallationsQueryKey = ["auth", "installations", "visible"] as const;

type VisibleInstallationsResponse = {
  installations: SessionInstallationSnapshot[];
};
type SetActiveInstallationInput = InferRequestType<
  typeof httpClient.api.auth.installations.active.$post
>["json"];
type ManagerStateResponse = {
  managerName: string;
  state: NaniteManagerState;
};
type JsonResponseLike = {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  json(): Promise<unknown>;
};

async function fetchVisibleInstallations(): Promise<VisibleInstallationsResponse> {
  const data = await readJsonResponse(httpClient.api.auth.installations.visible.$get());
  if (!isVisibleInstallationsResponse(data)) {
    throw new Error("Visible installations response was malformed.");
  }

  return data;
}

async function setActiveInstallation(
  input: SetActiveInstallationInput,
): Promise<BrowserNanitesContext> {
  const data = await readJsonResponse(
    httpClient.api.auth.installations.active.$post({ json: input }),
  );
  if (!isBrowserNanitesContext(data)) {
    throw new Error("Active installation response was malformed.");
  }

  return data;
}

async function logoutSession(): Promise<void> {
  await parseResponse(httpClient.api.auth.session.logout.$post());
}

async function fetchManagerState(managerName: string): Promise<ManagerStateResponse> {
  const data = await readJsonResponse(
    httpClient.api.nanites.manager[":managerName"].$get({
      param: { managerName },
    }),
  );
  if (
    !isRecord(data) ||
    typeof data.managerName !== "string" ||
    !isNaniteManagerState(data.state)
  ) {
    throw new Error("Nanite manager state response was malformed.");
  }

  return {
    managerName: data.managerName,
    state: data.state,
  };
}

async function readJsonResponse<TResponse extends JsonResponseLike>(
  responsePromise: Promise<TResponse>,
): Promise<unknown> {
  const response = await responsePromise;
  if (!response.ok) {
    throw new DetailedError(`${response.status} ${response.statusText}`, {
      statusCode: response.status,
      detail: {
        data: await response.json().catch(() => undefined),
        statusText: response.statusText,
      },
    });
  }

  return response.json();
}

const naniteMobileViews: readonly NaniteMobileView[] = ["nanites", "chat", "files", "details"];
const naniteMobileSwipeThreshold = 64;
const naniteActiveActivityMs = 30_000;
type NaniteDesktopPanel = "details" | "files";

// Drag-to-resize a workspace section. `grow` is 1 when the section widens as the
// pointer moves right (left-anchored panes) and -1 when it widens moving left.
function beginColumnResize(
  event: ReactPointerEvent,
  config: {
    readonly current: number;
    readonly min: number;
    readonly max: number;
    readonly grow: 1 | -1;
    readonly apply: (next: number) => void;
  },
): void {
  event.preventDefault();
  const startX = event.clientX;
  const { current, min, max, grow, apply } = config;
  const onMove = (move: PointerEvent) => {
    const next = current + (move.clientX - startX) * grow;
    apply(Math.min(max, Math.max(min, next)));
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.classList.remove("is-resizing-columns");
  };
  document.body.classList.add("is-resizing-columns");
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

type NaniteListItem = {
  readonly id: string;
  readonly nanite: ManagedNanite;
  readonly repositories: readonly string[];
  readonly latestRun: NaniteRunRecord | null;
  readonly activity: NaniteRuntimeActivity | null;
  readonly runCount: number;
};

type NaniteRepositoryGroup = {
  readonly repository: string;
  readonly items: readonly NaniteListItem[];
};

type NaniteMobileView = "nanites" | "chat" | "files" | "details";
type BrowserTriggerTestEvent = TestNaniteTriggerInput["event"];

export const Route = createFileRoute("/_authenticated/nanites")({
  validateSearch: z.object({
    account: z.string().optional(),
    installationId: z.coerce.number().int().positive().optional(),
    naniteId: z.string().optional(),
    runId: z.string().optional(),
    surface: z.enum(["manager", "nanite"]).optional(),
  }),
  component: NanitesRoute,
});

function formatStatus(status: NaniteRunStatus): string {
  return status.replaceAll("_", " ");
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatRelativeDate(value: string | null): string {
  if (!value) {
    return "";
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return "";
  }

  const elapsedMs = Date.now() - timestamp;
  const absoluteMs = Math.abs(elapsedMs);
  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
    { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
    { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
    { unit: "day", ms: 24 * 60 * 60 * 1000 },
    { unit: "hour", ms: 60 * 60 * 1000 },
    { unit: "minute", ms: 60 * 1000 },
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });

  for (const { unit, ms } of units) {
    if (absoluteMs >= ms) {
      return formatter.format(Math.round(-elapsedMs / ms), unit);
    }
  }

  return "now";
}

function formatRepositoryGroupLabel(repository: string, accountLogin: string): string {
  const accountPrefix = `${accountLogin}/`;
  return repository.startsWith(accountPrefix) ? repository.slice(accountPrefix.length) : repository;
}

function formatShortId(value: string | null | undefined): string {
  if (!value) {
    return "Not recorded";
  }

  return value.length > 12 ? `${value.slice(0, 7)}...${value.slice(-4)}` : value;
}

function getActivityAgeMs(activity: NaniteRuntimeActivity | null): number | null {
  if (!activity?.lastActivityAt) {
    return null;
  }

  const timestamp = new Date(activity.lastActivityAt).getTime();
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Date.now() - timestamp;
}

function isActivityFresh(activity: NaniteRuntimeActivity | null): boolean {
  const ageMs = getActivityAgeMs(activity);
  return ageMs !== null && ageMs >= 0 && ageMs < naniteActiveActivityMs;
}

function isTerminalRunStatus(status: NaniteRunStatus): boolean {
  return (
    status === "complete" || status === "no_change" || status === "fail" || status === "canceled"
  );
}

function isFreshRunOutcome(run: NaniteRunRecord | null): boolean {
  if (!run?.updatedAt || !isTerminalRunStatus(run.status)) {
    return false;
  }

  const updatedAt = new Date(run.updatedAt).getTime();
  return !Number.isNaN(updatedAt) && Date.now() - updatedAt < 10 * 60 * 1000;
}

function getRunStatusTone(status: NaniteRunStatus): string {
  if (status === "complete" || status === "no_change") {
    return "success";
  }
  if (status === "fail" || status === "canceled") {
    return "danger";
  }
  if (status === "waiting_for_human") {
    return "warning";
  }
  return "idle";
}

function getRunActivityTone(
  run: NaniteRunRecord | null,
  activity: NaniteRuntimeActivity | null,
): string {
  if (activity?.state === "error") {
    return "danger";
  }
  if (activity?.state === "waiting_for_human" || run?.status === "waiting_for_human") {
    return "warning";
  }
  if (
    activity &&
    (activity.state === "thinking" || activity.state === "tool_calling") &&
    isActivityFresh(activity)
  ) {
    return "active";
  }
  return run ? getRunStatusTone(run.status) : "idle";
}

function getRunActivityLabel(
  run: NaniteRunRecord | null,
  activity: NaniteRuntimeActivity | null,
): string {
  if (!run) {
    return "";
  }

  if (activity?.state === "tool_calling" && isActivityFresh(activity)) {
    return activity.toolName ?? "tool";
  }

  if (activity?.state === "thinking" && isActivityFresh(activity)) {
    return "thinking";
  }

  if (run.status === "waiting_for_human" || activity?.state === "waiting_for_human") {
    return "waiting";
  }

  if (isFreshRunOutcome(run)) {
    return "ready";
  }

  return formatRelativeDate(
    activity?.lastActivityAt ?? run.completedAt ?? run.updatedAt ?? run.startedAt,
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function getRunActivityKind(
  run: NaniteRunRecord | null,
  activity: NaniteRuntimeActivity | null,
): "spinner" | "dot" | "time" | "none" {
  if (!run) {
    return "none";
  }

  if (
    activity &&
    (activity.state === "thinking" || activity.state === "tool_calling") &&
    isActivityFresh(activity)
  ) {
    return "spinner";
  }

  if (activity?.state === "waiting_for_human" || run.status === "waiting_for_human") {
    return "dot";
  }

  if (isFreshRunOutcome(run)) {
    return "dot";
  }

  return "time";
}

function getRunSourceIcon(run: NaniteRunRecord | null) {
  if (run?.trigger.type === "github") {
    if (run.trigger.event.name === "pull_request") {
      return <GitPullRequestIcon size={14} aria-hidden="true" />;
    }
    return <GitBranchIcon size={14} aria-hidden="true" />;
  }

  return <GitBranchIcon size={14} aria-hidden="true" />;
}

function withAvatarSize(avatar_url: string | null, size: number): string | undefined {
  if (!avatar_url) {
    return undefined;
  }

  try {
    const url = new URL(avatar_url);
    url.searchParams.set("s", String(size));
    return url.toString();
  } catch {
    return avatar_url;
  }
}

function InstallationPicker({
  activeInstallation,
}: {
  readonly activeInstallation: SessionInstallationSnapshot;
}) {
  const navigate = Route.useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const installationsQuery = useQuery({
    queryKey: visibleInstallationsQueryKey,
    queryFn: fetchVisibleInstallations,
    enabled: false,
    throwOnError: true,
  });
  const changeInstallation = useMutation({
    mutationFn: setActiveInstallation,
    onSuccess: async (_data, variables) => {
      await invalidateAuthQueries(queryClient);
      const installation = installationsQuery.data?.installations.find(
        (candidate) => candidate.id === variables.githubInstallationId,
      );
      await navigate({
        search: (previous) => ({
          ...previous,
          account: installation?.account?.login,
          installationId: installation?.id,
          naniteId: undefined,
        }),
        replace: true,
      });
    },
  });
  const logout = useMutation({
    mutationFn: logoutSession,
    onSuccess: async () => {
      await invalidateAuthQueries(queryClient);
      await navigate({
        to: "/",
        search: {
          returnTo: "/nanites",
        },
        replace: true,
      });
    },
  });

  const installations = installationsQuery.data?.installations ?? [];
  const otherInstallations = installations.filter(
    (installation) => installation.id !== activeInstallation.id,
  );
  const returnToPath = buildReturnToPath(location);
  const installHref = buildGitHubAppInstallHref({ state: returnToPath });
  const manageAccessHref = buildGitHubAppInstallHref({
    state: returnToPath,
    suggestedTargetId: activeInstallation.account.id,
  });
  const triggerAvatarSrc = withAvatarSize(activeInstallation.account.avatar_url, 40);
  const headerAvatarSrc = withAvatarSize(activeInstallation.account.avatar_url, 64);

  return (
    <Popover.Root>
      <Popover.Trigger
        className="account-menu__trigger account-menu__trigger--nanites"
        onClick={() => {
          if (!installationsQuery.isFetching) {
            void installationsQuery.refetch();
          }
        }}
      >
        <Avatar.Root className="account-menu__trigger-avatar">
          {triggerAvatarSrc ? <Avatar.Image src={triggerAvatarSrc} alt="" /> : null}
          <Avatar.Fallback>
            {activeInstallation.account.login.slice(0, 2).toUpperCase()}
          </Avatar.Fallback>
        </Avatar.Root>
        <span className="account-menu__trigger-label">{activeInstallation.account.login}</span>
        <CaretDownIcon size={14} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start">
          <Popover.Popup className="account-menu__popup">
            <div className="account-menu__header">
              <Avatar.Root className="account-menu__header-avatar">
                {headerAvatarSrc ? <Avatar.Image src={headerAvatarSrc} alt="" /> : null}
                <Avatar.Fallback>
                  {activeInstallation.account.login.slice(0, 2).toUpperCase()}
                </Avatar.Fallback>
              </Avatar.Root>
              <div className="account-menu__header-info">
                <span className="account-menu__header-login">
                  {activeInstallation.account.login}
                </span>
                <span className="account-menu__header-type">{activeInstallation.account.type}</span>
              </div>
              <CheckCircleIcon size={14} weight="fill" aria-hidden="true" />
            </div>

            {installationsQuery.isFetching && installations.length === 0 ? (
              <div className="account-menu__empty">
                <span className="account-menu__empty-title">Loading accounts</span>
              </div>
            ) : null}

            {otherInstallations.length > 0 ? (
              <>
                <div className="account-menu__divider" />
                <div className="account-menu__section-label">Switch accounts</div>
                <ul className="account-menu__list">
                  {otherInstallations.map((installation) => {
                    const account = installation.account;
                    const accountLogin = account?.login ?? "Unknown account";
                    const rowAvatarSrc = withAvatarSize(account?.avatar_url ?? null, 56);
                    return (
                      <li key={installation.id}>
                        <button
                          type="button"
                          className="account-menu__account-row"
                          disabled={changeInstallation.isPending}
                          onClick={() =>
                            changeInstallation.mutate({
                              githubInstallationId: installation.id,
                            })
                          }
                        >
                          <Avatar.Root className="account-menu__row-avatar">
                            {rowAvatarSrc ? <Avatar.Image src={rowAvatarSrc} alt="" /> : null}
                            <Avatar.Fallback>
                              {accountLogin.slice(0, 2).toUpperCase()}
                            </Avatar.Fallback>
                          </Avatar.Root>
                          <div className="account-menu__row-info">
                            <span className="account-menu__row-login">{accountLogin}</span>
                            <span className="account-menu__row-type">
                              {account?.type ?? "Account"}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}

            <div className="account-menu__divider" />

            <a className="account-menu__action" href={installHref} target="_blank" rel="noreferrer">
              <PlusIcon size={14} aria-hidden="true" />
              <span>
                {installations.length === 0
                  ? "Install SigVelo on GitHub"
                  : "Install on another account"}
              </span>
              <ArrowSquareOutIcon size={14} aria-hidden="true" />
            </a>
            <a
              className="account-menu__action"
              href={manageAccessHref}
              target="_blank"
              rel="noreferrer"
            >
              <GithubLogoIcon size={14} aria-hidden="true" />
              <span>Manage account access</span>
              <ArrowSquareOutIcon size={14} aria-hidden="true" />
            </a>
            <a
              className="account-menu__action"
              href={SIGVELO_GITHUB_APP_URL}
              target="_blank"
              rel="noreferrer"
            >
              <GithubLogoIcon size={14} aria-hidden="true" />
              <span>View SigVelo on GitHub Marketplace</span>
              <ArrowSquareOutIcon size={14} aria-hidden="true" />
            </a>

            <div className="account-menu__divider" />

            <button
              type="button"
              className="account-menu__action"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <SignOutIcon size={14} aria-hidden="true" />
              <span>{logout.isPending ? "Signing out..." : "Sign out"}</span>
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function getEventSourceRepositories(eventSource: NaniteManifest["eventSource"]): string[] {
  if (eventSource.type !== "github") {
    return [];
  }

  return eventSource.repositories ?? [];
}

function getRunRepository(run: NaniteRunRecord): string | null {
  if (run.trigger.type !== "github") {
    return null;
  }

  return getGitHubWebhookRepositoryFullName(run.trigger.event);
}

function getRunGitHubBranch(
  trigger: Extract<NaniteRunRecord["trigger"], { type: "github" }>,
): string {
  return getGitHubWebhookBranch(trigger.event) ?? "unknown";
}

function formatScheduledEventSource(
  eventSource: Extract<NaniteManifest["eventSource"], { type: "schedule" | "scheduleEvery" }>,
): string {
  switch (eventSource.type) {
    case "schedule":
      return `schedule(${JSON.stringify(eventSource.when)})`;
    case "scheduleEvery":
      return `scheduleEvery(${eventSource.intervalSeconds}s)`;
  }
}

function formatEventSourceSpec(eventSource: NaniteManifest["eventSource"]): string {
  switch (eventSource.type) {
    case "manual":
      return "manual";
    case "schedule":
    case "scheduleEvery":
      return formatScheduledEventSource(eventSource);
    case "github":
      return `github: ${eventSource.events?.join(", ") ?? "all events"}`;
  }
}

function buildBrowserTriggerTestEvent(nanite: ManagedNanite): BrowserTriggerTestEvent | null {
  const { eventSource } = nanite.manifest;
  if (eventSource.type !== "github") {
    return null;
  }

  const events = eventSource.events ?? [];
  const repository =
    eventSource.repositories?.[0] ?? nanite.manifest.permissions.github?.repositories[0];
  if (!repository) {
    return null;
  }

  const [owner = repository, name = repository] = repository.split("/", 2);
  if (events.length === 0 || events.includes("push")) {
    const branch = eventSource.branches?.[0] ?? "main";
    return {
      fixture: "push",
      overrides: {
        ref: `refs/heads/${branch}`,
        repository: {
          full_name: repository,
          name,
          owner: { login: owner },
        },
      },
    };
  }

  const pullRequestEvents = events.filter((event) => event.startsWith("pull_request"));
  if (pullRequestEvents.length === 0) {
    return null;
  }

  let fixture: BrowserTriggerTestEvent["fixture"] = "pull_request.opened";
  if (events.includes("pull_request.synchronize") || eventSource.actions?.includes("synchronize")) {
    fixture = "pull_request.synchronize";
  } else if (
    events.includes("pull_request.reopened") ||
    eventSource.actions?.includes("reopened")
  ) {
    fixture = "pull_request.reopened";
  } else if (events.includes("pull_request.closed") || eventSource.actions?.includes("closed")) {
    fixture = "pull_request.closed";
  }

  return {
    fixture,
    overrides: {
      repository: {
        full_name: repository,
        name,
        owner: { login: owner },
      },
    },
  };
}

function formatTriggerEvent(trigger: NaniteRunRecord["trigger"]): string {
  switch (trigger.type) {
    case "manual":
      return trigger.message ? `manual: ${trigger.message}` : "manual";
    case "schedule":
      return formatScheduledEventSource(trigger.eventSource);
    case "github":
      if (trigger.event.name === "pull_request") {
        const pullRequestNumber = getGitHubWebhookPullRequestNumber(trigger.event);
        const action = getGitHubWebhookAction(trigger.event);
        return pullRequestNumber
          ? `PR #${pullRequestNumber}: ${action ?? "event"}`
          : getGitHubWebhookEventName(trigger.event);
      }
      if (trigger.event.name === "push") {
        return `push: ${getRunGitHubBranch(trigger)}`;
      }
      return getGitHubWebhookEventName(trigger.event);
  }
}

type GitInfoLink = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly href: string;
  readonly icon: ReactNode;
};

type InfoRow = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly title: string;
  readonly href?: string;
  readonly icon: ReactNode;
};

function getGitHubRepositoryUrl(repository: string | null): string | null {
  return repository ? `https://github.com/${repository}` : null;
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function getGitInfoLinks({
  repository,
  repositoryLabel,
  run,
}: {
  readonly repository: string | null;
  readonly repositoryLabel: string;
  readonly run: NaniteRunRecord | null;
}): GitInfoLink[] {
  const links: GitInfoLink[] = [];
  const repositoryUrl = getGitHubRepositoryUrl(repository);

  if (repositoryUrl) {
    links.push({
      key: "repo",
      label: "Repo",
      value: repositoryLabel,
      href: repositoryUrl,
      icon: <FolderSimpleIcon size={15} aria-hidden="true" />,
    });
  }

  if (repositoryUrl && run?.trigger.type === "github" && run.trigger.event.name === "push") {
    const branch = getRunGitHubBranch(run.trigger);
    const headSha = getGitHubWebhookHeadSha(run.trigger.event);
    links.push({
      key: "ref",
      label: "Ref",
      value: branch,
      href: `${repositoryUrl}/tree/${encodeURIComponent(branch)}`,
      icon: <GitBranchIcon size={15} aria-hidden="true" />,
    });
    if (headSha) {
      links.push({
        key: "trigger",
        label: "Trigger",
        value: formatShortId(headSha),
        href: `${repositoryUrl}/commit/${headSha}`,
        icon: <GitBranchIcon size={15} aria-hidden="true" />,
      });
    }
  }

  if (
    repositoryUrl &&
    run?.trigger.type === "github" &&
    run.trigger.event.name === "pull_request"
  ) {
    const headSha = getGitHubWebhookHeadSha(run.trigger.event);
    const pullRequestNumber = getGitHubWebhookPullRequestNumber(run.trigger.event);
    if (headSha) {
      links.push({
        key: "ref",
        label: "Ref",
        value: formatShortId(headSha),
        href: `${repositoryUrl}/commit/${headSha}`,
        icon: <GitBranchIcon size={15} aria-hidden="true" />,
      });
    }
    if (pullRequestNumber) {
      links.push({
        key: "trigger",
        label: "Trigger",
        value: `PR #${pullRequestNumber}`,
        href: `${repositoryUrl}/pull/${pullRequestNumber}`,
        icon: <GitPullRequestIcon size={15} aria-hidden="true" />,
      });
    }
  }

  return links;
}

function InfoPanelRow({ row }: { readonly row: InfoRow }) {
  const content = (
    <>
      <span>
        {row.icon}
        {row.label}
      </span>
      <span title={row.value}>{row.value}</span>
      {row.href ? <ArrowSquareOutIcon size={13} aria-hidden="true" /> : null}
    </>
  );

  if (row.href) {
    return (
      <a
        className="nanites-workspace__info-row"
        href={row.href}
        target="_blank"
        rel="noreferrer"
        title={row.title}
      >
        {content}
      </a>
    );
  }

  return (
    <div
      className="nanites-workspace__info-row nanites-workspace__info-row--static"
      title={row.title}
    >
      {content}
    </div>
  );
}

function InfoSection({
  title,
  className,
  children,
}: {
  readonly title: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div
      className={
        className
          ? `nanites-workspace__info-section ${className}`
          : "nanites-workspace__info-section"
      }
      data-collapsed={isOpen ? undefined : "true"}
    >
      <button
        type="button"
        className="nanites-workspace__info-section-header"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <h2>{title}</h2>
        <CaretDownIcon size={12} aria-hidden="true" />
      </button>
      {isOpen ? children : null}
    </div>
  );
}

function getNaniteRepositories(nanite: ManagedNanite, runs: readonly NaniteRunRecord[]): string[] {
  const repositories = new Set<string>();

  for (const repository of nanite.manifest.permissions.github?.repositories ?? []) {
    repositories.add(repository);
  }
  for (const repository of getEventSourceRepositories(nanite.manifest.eventSource)) {
    repositories.add(repository);
  }
  for (const run of runs) {
    const repository = getRunRepository(run);
    if (repository) {
      repositories.add(repository);
    }
  }

  return [...repositories].sort((left, right) => left.localeCompare(right));
}

function groupNanitesByRepository(items: readonly NaniteListItem[]): NaniteRepositoryGroup[] {
  const groups = new Map<string, NaniteListItem[]>();

  for (const item of items) {
    const repositories = item.repositories.length > 0 ? item.repositories : ["Manual / unscoped"];
    for (const repository of repositories) {
      const group = groups.get(repository) ?? [];
      group.push(item);
      groups.set(repository, group);
    }
  }

  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === "Manual / unscoped") {
        return 1;
      }
      if (right === "Manual / unscoped") {
        return -1;
      }
      return left.localeCompare(right);
    })
    .map(([repository, groupItems]) => ({
      repository,
      items: groupItems.sort((left, right) => {
        const leftTime = left.latestRun?.startedAt ?? left.nanite.updatedAt;
        const rightTime = right.latestRun?.startedAt ?? right.nanite.updatedAt;
        return rightTime.localeCompare(leftTime);
      }),
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSessionInstallationSnapshot(value: unknown): value is SessionInstallationSnapshot {
  if (!isRecord(value) || !isRecord(value.account)) {
    return false;
  }

  return (
    typeof value.id === "number" &&
    typeof value.account.id === "number" &&
    typeof value.account.login === "string" &&
    typeof value.account.type === "string" &&
    (typeof value.account.avatar_url === "string" || value.account.avatar_url === null)
  );
}

function isVisibleInstallationsResponse(value: unknown): value is VisibleInstallationsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.installations) &&
    value.installations.every(isSessionInstallationSnapshot)
  );
}

function isBrowserNanitesContext(value: unknown): value is BrowserNanitesContext {
  if (!isRecord(value) || !isRecord(value.actor)) {
    return false;
  }

  return (
    typeof value.actor.id === "number" &&
    typeof value.actor.login === "string" &&
    (value.activeInstallation === null ||
      isSessionInstallationSnapshot(value.activeInstallation)) &&
    typeof value.expiresAt === "string"
  );
}

function isNaniteManagerState(value: unknown): value is NaniteManagerState {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isRecord(value.nanites) &&
    isRecord(value.runs) &&
    Array.isArray(value.runOrder) &&
    (typeof value.updatedAt === "string" || value.updatedAt === null)
  );
}

function pickManagerState({
  initialState,
  liveState,
}: {
  readonly initialState: NaniteManagerState;
  readonly liveState: NaniteManagerState | undefined;
}): NaniteManagerState {
  if (!liveState?.updatedAt) {
    return initialState;
  }

  if (!initialState.updatedAt || liveState.updatedAt >= initialState.updatedAt) {
    return liveState;
  }

  return initialState;
}

function ManagerInfoPanel({
  activeInstallation,
  naniteCount,
  runCount,
}: {
  readonly activeInstallation: SessionInstallationSnapshot;
  readonly naniteCount: number;
  readonly runCount: number;
}) {
  const manageAccessHref = buildGitHubAppInstallHref({
    suggestedTargetId: activeInstallation.account.id,
  });

  return (
    <aside className="nanites-workspace__info-rail" aria-label="Manager details">
      <section className="nanites-workspace__info-card">
        <InfoSection title="Manager" className="nanites-workspace__info-section--about">
          <div className="nanites-workspace__info-about">
            <p>
              The installation manager routes triggers, manages the Nanite roster, starts manual
              runs, and inspects runtime state for this GitHub installation.
            </p>
          </div>
          <div className="nanites-workspace__info-link-list">
            <InfoPanelRow
              row={{
                key: "account",
                icon: <GithubLogoIcon size={14} aria-hidden="true" />,
                label: "Account",
                value: activeInstallation.account.login,
                title: activeInstallation.account.login,
              }}
            />
            <InfoPanelRow
              row={{
                key: "nanites",
                icon: <SlidersHorizontalIcon size={14} aria-hidden="true" />,
                label: "Nanites",
                value: String(naniteCount),
                title: `${naniteCount} registered Nanites`,
              }}
            />
            <InfoPanelRow
              row={{
                key: "runs",
                icon: <ChatCircleTextIcon size={14} aria-hidden="true" />,
                label: "Runs",
                value: String(runCount),
                title: `${runCount} retained runs`,
              }}
            />
          </div>
        </InfoSection>

        <InfoSection title="Controls">
          <div className="nanites-workspace__info-link-list">
            <a
              className="nanites-workspace__info-row"
              href={manageAccessHref}
              target="_blank"
              rel="noreferrer"
            >
              <span>
                <GithubLogoIcon size={14} aria-hidden="true" />
                GitHub access
              </span>
              <span>Manage</span>
              <ArrowSquareOutIcon size={13} aria-hidden="true" />
            </a>
          </div>
        </InfoSection>
      </section>
    </aside>
  );
}

function NaniteRunInfoPanel({
  activeInstallation,
  deleteError,
  isDeleting,
  isTestingTrigger,
  nanite,
  onDeleteNanite,
  onTestTrigger,
  run,
  testTriggerError,
}: {
  readonly activeInstallation: SessionInstallationSnapshot;
  readonly deleteError: unknown;
  readonly isDeleting: boolean;
  readonly isTestingTrigger: boolean;
  readonly nanite: ManagedNanite | null;
  readonly onDeleteNanite: () => void;
  readonly onTestTrigger: () => void;
  readonly run: NaniteRunRecord | null;
  readonly testTriggerError: unknown;
}) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const canTestTrigger = nanite ? buildBrowserTriggerTestEvent(nanite) !== null : false;
  const repository =
    (run ? getRunRepository(run) : null) ??
    nanite?.manifest.permissions.github?.repositories[0] ??
    null;
  const repositoryLabel = repository
    ? formatRepositoryGroupLabel(repository, activeInstallation.account.login)
    : "Manual / unscoped";
  const gitInfoLinks = getGitInfoLinks({
    repository,
    repositoryLabel,
    run,
  });
  const githubPermissions = Object.entries(
    nanite?.manifest.permissions.github?.appPermissions ?? {},
  )
    .filter(([, permission]) => permission !== undefined && permission !== null)
    .map(([permission, access]) => `${permission}: ${String(access)}`);
  const scopedRepositories = nanite?.manifest.permissions.github?.repositories ?? [];
  const triggerSpec = nanite ? formatEventSourceSpec(nanite.manifest.eventSource) : "manual";
  const manageAccessHref = buildGitHubAppInstallHref({
    suggestedTargetId: activeInstallation.account.id,
  });
  const triggerLabel = run
    ? formatTriggerEvent(run.trigger)
    : nanite
      ? formatEventSourceSpec(nanite.manifest.eventSource)
      : "No trigger";
  const scopeRows: InfoRow[] = [
    {
      key: "repos",
      label: "Repos",
      value:
        scopedRepositories.length > 0
          ? formatCount(scopedRepositories.length, "repo")
          : "No repo scope",
      title:
        scopedRepositories.length > 0
          ? `This Nanite can operate on: ${scopedRepositories.join(", ")}.`
          : "This Nanite has no GitHub repository scope.",
      href:
        scopedRepositories.length === 1
          ? (getGitHubRepositoryUrl(scopedRepositories[0]) ?? undefined)
          : undefined,
      icon: <FolderSimpleIcon size={15} aria-hidden="true" />,
    },
    {
      key: "trigger",
      label: "Trigger",
      value: triggerSpec,
      title:
        nanite?.manifest.eventSource.type === "manual"
          ? "This Nanite starts when a user manually asks it to run."
          : `This Nanite starts from ${triggerSpec}.`,
      icon: <GitBranchIcon size={15} aria-hidden="true" />,
    },
    {
      key: "github",
      label: "GitHub",
      value:
        githubPermissions.length > 0
          ? formatCount(githubPermissions.length, "grant")
          : "No app grants",
      title:
        githubPermissions.length > 0
          ? `GitHub App permissions granted to this Nanite: ${githubPermissions.join(", ")}.`
          : "This Nanite has no declared GitHub App permissions.",
      href: githubPermissions.length > 0 ? manageAccessHref : undefined,
      icon: <GithubLogoIcon size={15} aria-hidden="true" />,
    },
  ];
  const outcomeRows = [
    run
      ? {
          key: "status",
          label: "Status",
          value: formatStatus(run.status),
        }
      : null,
    run
      ? {
          key: "trigger",
          label: "Trigger",
          value: triggerLabel,
        }
      : nanite
        ? {
            key: "trigger",
            label: "Trigger",
            value: triggerLabel,
          }
        : null,
    run?.summary
      ? {
          key: "summary",
          label: "Summary",
          value: run.summary,
        }
      : null,
    run?.humanRequest
      ? {
          key: "waiting",
          label: "Waiting",
          value: run.humanRequest.summary,
        }
      : null,
  ].filter((row) => row !== null);

  useEffect(() => {
    setIsConfirmingDelete(false);
  }, [nanite?.manifest.id]);

  return (
    <aside className="nanites-workspace__info-rail" aria-label="Run details">
      <section className="nanites-workspace__info-card">
        {nanite ? (
          <InfoSection title="Nanite" className="nanites-workspace__info-section--about">
            <div className="nanites-workspace__info-about">
              <strong>{nanite.manifest.name}</strong>
              <p>{nanite.manifest.description}</p>
            </div>
            <div className="nanites-workspace__danger-zone">
              <button
                type="button"
                className="nanites-workspace__danger-action"
                data-confirming={isConfirmingDelete ? "true" : undefined}
                disabled={isDeleting}
                onClick={() => {
                  if (!isConfirmingDelete) {
                    setIsConfirmingDelete(true);
                    return;
                  }

                  onDeleteNanite();
                }}
              >
                <TrashIcon size={14} aria-hidden="true" />
                <span>
                  {isDeleting
                    ? "Deleting..."
                    : isConfirmingDelete
                      ? "Confirm delete"
                      : "Delete Nanite"}
                </span>
              </button>
              {isConfirmingDelete && !isDeleting ? (
                <button
                  type="button"
                  className="nanites-workspace__danger-cancel"
                  onClick={() => setIsConfirmingDelete(false)}
                >
                  Cancel
                </button>
              ) : null}
            </div>
            {deleteError ? (
              <p className="nanites-workspace__delete-error" role="alert">
                {getErrorMessage(deleteError)}
              </p>
            ) : null}
          </InfoSection>
        ) : null}

        {nanite && canTestTrigger ? (
          <InfoSection title="Controls">
            <div className="nanites-workspace__danger-zone">
              <Button
                color="neutral"
                size="sm"
                variant="outline"
                disabled={isTestingTrigger}
                onClick={onTestTrigger}
              >
                {isTestingTrigger ? (
                  <CircleNotchIcon size={14} aria-hidden="true" />
                ) : (
                  <ArrowClockwiseIcon size={14} aria-hidden="true" />
                )}
                <span>{isTestingTrigger ? "Testing..." : "Test trigger"}</span>
              </Button>
            </div>
            {testTriggerError ? (
              <p className="nanites-workspace__action-error" role="alert">
                {getErrorMessage(testTriggerError)}
              </p>
            ) : null}
          </InfoSection>
        ) : null}

        {gitInfoLinks.length > 0 ? (
          <InfoSection title="Git">
            <div className="nanites-workspace__info-link-list">
              {gitInfoLinks.map((link) => (
                <a
                  className="nanites-workspace__info-row"
                  href={link.href}
                  key={link.key}
                  target="_blank"
                  rel="noreferrer"
                  title={link.href}
                >
                  <span>
                    {link.icon}
                    {link.label}
                  </span>
                  <span title={link.value}>{link.value}</span>
                  <ArrowSquareOutIcon size={13} aria-hidden="true" />
                </a>
              ))}
            </div>
          </InfoSection>
        ) : null}

        <InfoSection title="Scope">
          <div className="nanites-workspace__info-link-list">
            {scopeRows.map((row) => (
              <InfoPanelRow key={row.key} row={row} />
            ))}
          </div>
        </InfoSection>

        {outcomeRows.length > 0 ? (
          <InfoSection title="Run">
            <dl className="nanites-workspace__outcome-list">
              {outcomeRows.map((row) => (
                <div key={row.key}>
                  <dt>{row.label}</dt>
                  <dd title={row.value}>{row.value}</dd>
                </div>
              ))}
              {run?.outputUrl ? (
                <div>
                  <dt>Output</dt>
                  <dd>
                    <a href={run.outputUrl} target="_blank" rel="noreferrer">
                      Open
                      <ArrowSquareOutIcon size={12} aria-hidden="true" />
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </InfoSection>
        ) : null}
      </section>
    </aside>
  );
}

function inferWorkspaceLanguage(path: string): CodeBlockLanguage {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".js")) return "js";
  if (path.endsWith(".jsx")) return "jsx";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".md")) return "md";
  if (path.endsWith(".sh") || path.endsWith(".bash")) return "bash";
  return "md";
}

const naniteWorkspaceDirectoryLimit = 1_000;
const naniteWorkspaceFilePreviewMaxBytes = 1_000_000;
const naniteWorkspaceFilterScanEntryLimit = 2_000;

type NaniteWorkspaceReviewFile = {
  readonly path: string;
  readonly name: string;
  readonly content: string;
  readonly additions: number;
  readonly deletions: number;
};

type NaniteWorkspaceTreeEntry = {
  readonly path: string;
  readonly name: string;
  readonly type: FileInfo["type"];
};

function formatWorkspaceJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function buildNaniteDefinitionFiles(nanite: ManagedNanite | null): NaniteWorkspaceReviewFile[] {
  if (!nanite) {
    return [];
  }

  const files: NaniteWorkspaceReviewFile[] = [
    {
      path: "/nanite/manifest.json",
      name: "manifest.json",
      content: formatWorkspaceJson(nanite.manifest),
      additions: 0,
      deletions: 0,
    },
    {
      path: "/nanite/version.json",
      name: "version.json",
      content: formatWorkspaceJson({
        versionId: nanite.latestVersion.versionId,
        manifestHash: nanite.latestVersion.manifestHash,
        registeredAt: nanite.latestVersion.registeredAt,
      }),
      additions: 0,
      deletions: 0,
    },
  ];

  return files;
}

function toWorkspaceTreeEntry(entry: FileInfo): NaniteWorkspaceTreeEntry {
  return {
    path: entry.path,
    name: entry.name,
    type: entry.type,
  };
}

function sortWorkspaceTreeEntries(
  entries: readonly NaniteWorkspaceTreeEntry[],
): NaniteWorkspaceTreeEntry[] {
  return [...entries].sort((left, right) => {
    if (left.type === right.type) {
      return left.name.localeCompare(right.name);
    }
    if (left.type === "directory") {
      return -1;
    }
    if (right.type === "directory") {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function uniqueWorkspaceEntries(
  entries: readonly NaniteWorkspaceTreeEntry[],
): NaniteWorkspaceTreeEntry[] {
  return sortWorkspaceTreeEntries([
    ...new Map(entries.map((entry) => [entry.path, entry])).values(),
  ]);
}

function NaniteWorkspacePanel({
  managerName,
  nanite,
  naniteId,
  refreshKey,
}: {
  readonly managerName: string;
  readonly nanite: ManagedNanite | null;
  readonly naniteId: string | null;
  readonly refreshKey: string;
}) {
  if (!naniteId) {
    return (
      <section className="nanites-workspace__workbench app__pane" aria-label="Nanite workspace">
        <div className="nanites-workspace__files-header">
          <span>Workspace</span>
        </div>
        <p className="nanites-workspace__files-empty">Select a Nanite to inspect its workspace.</p>
      </section>
    );
  }

  return (
    <Suspense
      fallback={
        <section className="nanites-workspace__workbench app__pane" aria-label="Nanite workspace">
          <div className="nanites-workspace__files-header">
            <span>Workspace</span>
          </div>
          <p className="nanites-workspace__files-empty">Loading workspace...</p>
        </section>
      }
    >
      <NaniteWorkspaceReview
        key={naniteId}
        managerName={managerName}
        nanite={nanite}
        naniteId={naniteId}
        refreshKey={refreshKey}
      />
    </Suspense>
  );
}

function NaniteWorkspaceReview({
  managerName,
  nanite,
  naniteId,
  refreshKey,
}: {
  readonly managerName: string;
  readonly nanite: ManagedNanite | null;
  readonly naniteId: string;
  readonly refreshKey: string;
}) {
  const naniteAgent = useAgent<SigveloNaniteAgent, NaniteAgentState>({
    agent: NANITE_MANAGER_NAME,
    name: managerName,
    sub: [{ agent: NANITE_AGENT_NAME, name: naniteId }],
  });
  const [files, setFiles] = useState<readonly NaniteWorkspaceReviewFile[]>([]);
  const [entriesByDirectory, setEntriesByDirectory] = useState<
    Record<string, readonly NaniteWorkspaceTreeEntry[]>
  >({});
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(new Set(["/workspace"]));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [info, setInfo] = useState<NaniteWorkspaceInfo | null>(null);
  const [fileFilter, setFileFilter] = useState("");
  const [isFileTreeOpen, setFileTreeOpen] = useState(true);
  const [treeWidth, setTreeWidth] = useState(248);
  const [loading, setLoading] = useState(false);
  const [loadingDirectories, setLoadingDirectories] = useState<ReadonlySet<string>>(new Set());
  const [loadingFilePath, setLoadingFilePath] = useState<string | null>(null);
  const [filterSearchEntries, setFilterSearchEntries] = useState<
    readonly NaniteWorkspaceTreeEntry[]
  >([]);
  const [filterSearchLoading, setFilterSearchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedDirectoriesRef = useRef<ReadonlySet<string>>(new Set());

  const definitionFiles = useMemo(() => buildNaniteDefinitionFiles(nanite), [nanite]);
  const definitionFilesByPath = useMemo(
    () => new Map(definitionFiles.map((file) => [file.path, file])),
    [definitionFiles],
  );
  const filesByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);

  const loadDirectory = useCallback(
    async (path: string, { force = false }: { readonly force?: boolean } = {}) => {
      if (!force && loadedDirectoriesRef.current.has(path)) {
        return;
      }

      setLoadingDirectories((current) => new Set(current).add(path));
      setError(null);
      try {
        const output = await naniteAgent.stub.exploreWorkspace({
          action: "list",
          path,
          limit: naniteWorkspaceDirectoryLimit,
        });
        const entries = output.action === "list" ? output.entries : [];
        setEntriesByDirectory((current) => ({
          ...current,
          [path]: sortWorkspaceTreeEntries(entries.map(toWorkspaceTreeEntry)),
        }));
        loadedDirectoriesRef.current = new Set(loadedDirectoriesRef.current).add(path);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        setLoadingDirectories((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [naniteAgent.stub],
  );

  const loadFile = useCallback(
    async (path: string) => {
      const definitionFile = definitionFilesByPath.get(path);
      if (definitionFile) {
        setFiles((current) => {
          const withoutCurrent = current.filter((file) => file.path !== path);
          return [...withoutCurrent, definitionFile];
        });
        return;
      }

      if (filesByPath.has(path)) {
        return;
      }

      setLoadingFilePath(path);
      setError(null);
      try {
        const output = await naniteAgent.stub.exploreWorkspace({
          action: "read",
          path,
          maxBytes: naniteWorkspaceFilePreviewMaxBytes,
        });
        const content =
          output.action === "read"
            ? [
                output.content ?? "(empty file)",
                output.truncated ? "\n\n[Preview truncated]" : "",
              ].join("")
            : "(empty file)";
        setFiles((current) => {
          const withoutCurrent = current.filter((file) => file.path !== path);
          return [
            ...withoutCurrent,
            {
              path,
              name: path.split("/").filter(Boolean).at(-1) ?? path,
              content,
              additions: 0,
              deletions: 0,
            },
          ];
        });
      } catch (readError) {
        setFiles((current) => {
          const withoutCurrent = current.filter((file) => file.path !== path);
          return [
            ...withoutCurrent,
            {
              path,
              name: path.split("/").filter(Boolean).at(-1) ?? path,
              content: readError instanceof Error ? readError.message : String(readError),
              additions: 0,
              deletions: 0,
            },
          ];
        });
      } finally {
        setLoadingFilePath((current) => (current === path ? null : current));
      }
    },
    [definitionFilesByPath, filesByPath, naniteAgent.stub],
  );

  const loadWorkspaceRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFiles(definitionFiles);
    setSelectedPath(null);
    setEntriesByDirectory({});
    loadedDirectoriesRef.current = new Set(["/nanite"]);
    setExpandedPaths(new Set(["/workspace"]));
    try {
      const nextInfo = await naniteAgent.stub.getWorkspaceInfo();
      setInfo(nextInfo);
      await loadDirectory("/", { force: true });
    } catch (loadError) {
      setEntriesByDirectory({});
      loadedDirectoriesRef.current = new Set(["/nanite"]);
      setInfo(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [definitionFiles, loadDirectory, naniteAgent.stub]);

  const refresh = useCallback(() => {
    void loadWorkspaceRoot();
  }, [loadWorkspaceRoot]);

  useEffect(() => {
    void loadWorkspaceRoot();
  }, [loadWorkspaceRoot, refreshKey]);

  useEffect(() => {
    const filter = fileFilter.trim().toLowerCase();
    if (!filter) {
      setFilterSearchEntries([]);
      setFilterSearchLoading(false);
      return;
    }

    let canceled = false;
    const timeout = window.setTimeout(() => {
      setFilterSearchLoading(true);
      void (async () => {
        const matches: NaniteWorkspaceTreeEntry[] = [];
        const directories = ["/"];
        let scannedEntries = 0;

        try {
          while (directories.length > 0 && scannedEntries < naniteWorkspaceFilterScanEntryLimit) {
            const directory = directories.shift() ?? "/";
            const output = await naniteAgent.stub.exploreWorkspace({
              action: "list",
              path: directory,
              limit: naniteWorkspaceDirectoryLimit,
            });
            const entries =
              output.action === "list" ? output.entries.map(toWorkspaceTreeEntry) : [];

            for (const entry of entries) {
              scannedEntries += 1;
              if (entry.type === "directory") {
                directories.push(entry.path);
                continue;
              }
              if (entry.path.toLowerCase().includes(filter)) {
                matches.push(entry);
              }
              if (scannedEntries >= naniteWorkspaceFilterScanEntryLimit) {
                break;
              }
            }
          }

          if (!canceled) {
            setFilterSearchEntries(uniqueWorkspaceEntries(matches));
          }
        } catch (searchError) {
          if (!canceled) {
            setFilterSearchEntries([]);
            setError(searchError instanceof Error ? searchError.message : String(searchError));
          }
        } finally {
          if (!canceled) {
            setFilterSearchLoading(false);
          }
        }
      })();
    }, 250);

    return () => {
      canceled = true;
      window.clearTimeout(timeout);
    };
  }, [fileFilter, naniteAgent.stub]);

  const loadedFileEntries = useMemo(() => {
    const entries = Object.values(entriesByDirectory).flat();
    return entries.filter((entry) => entry.type !== "directory");
  }, [entriesByDirectory]);
  const definitionFileEntries = useMemo(
    () =>
      definitionFiles.map((file) => ({
        path: file.path,
        name: file.name,
        type: "file" as const,
      })),
    [definitionFiles],
  );
  const filteredFileEntries = useMemo(() => {
    const filter = fileFilter.trim().toLowerCase();
    if (!filter) {
      return loadedFileEntries;
    }
    return uniqueWorkspaceEntries(
      [...definitionFileEntries, ...loadedFileEntries, ...filterSearchEntries].filter((entry) =>
        entry.path.toLowerCase().includes(filter),
      ),
    );
  }, [definitionFileEntries, fileFilter, filterSearchEntries, loadedFileEntries]);
  const selectedFile = selectedPath ? (filesByPath.get(selectedPath) ?? null) : null;
  const selectedFileIsLoading = selectedPath !== null && loadingFilePath === selectedPath;
  const hasWorkspaceEntries =
    (entriesByDirectory["/"]?.length ?? 0) > 0 || definitionFiles.length > 0;
  const visibleTreeEntries = useMemo(
    () => (fileFilter.trim() ? filteredFileEntries : (entriesByDirectory["/"] ?? [])),
    [entriesByDirectory, fileFilter, filteredFileEntries],
  );

  const handleSelectFile = useCallback(
    (path: string) => {
      setSelectedPath(path);
      void loadFile(path);
    },
    [loadFile],
  );

  const handleExpandedChange = useCallback(
    (next: Set<string>) => {
      const normalized = new Set(next);
      normalized.add("/workspace");
      setExpandedPaths(normalized);

      for (const path of normalized) {
        if (path === "/workspace" || path === "/nanite" || expandedPaths.has(path)) {
          continue;
        }
        void loadDirectory(path);
      }
    },
    [expandedPaths, loadDirectory],
  );

  const renderWorkspaceEntry = useCallback(
    (entry: NaniteWorkspaceTreeEntry): ReactNode => {
      if (entry.type === "directory") {
        const childEntries = entriesByDirectory[entry.path] ?? [];
        return (
          <FileTreeFolder key={entry.path} path={entry.path} name={entry.name}>
            {childEntries.map(renderWorkspaceEntry)}
          </FileTreeFolder>
        );
      }

      return <FileTreeFile key={entry.path} path={entry.path} name={entry.name} />;
    },
    [entriesByDirectory],
  );

  const renderWorkspaceTree = useCallback(() => {
    const filter = fileFilter.trim();
    const definitionFolder = (
      <FileTreeFolder key="/nanite" path="/nanite" name="nanite">
        {definitionFiles.map((file) => (
          <FileTreeFile key={file.path} path={file.path} name={file.name} />
        ))}
      </FileTreeFolder>
    );

    if (filter) {
      return (
        <FileTreeFolder path="/workspace" name="workspace">
          {filteredFileEntries.map((entry) => (
            <FileTreeFile key={entry.path} path={entry.path} name={entry.path.replace(/^\//, "")} />
          ))}
        </FileTreeFolder>
      );
    }

    return (
      <FileTreeFolder path="/workspace" name="workspace">
        {definitionFolder}
        {visibleTreeEntries.map(renderWorkspaceEntry)}
      </FileTreeFolder>
    );
  }, [definitionFiles, fileFilter, filteredFileEntries, renderWorkspaceEntry, visibleTreeEntries]);

  return (
    <section className="nanites-workspace__workbench app__pane" aria-label="Nanite workspace">
      <div className="app__workbench-shell">
        <div className="app__workbench-heading">
          <div className="nanites-workspace__review-title">
            <span>Workspace</span>
            {info ? <span className="app__tools-count">{info.fileCount}</span> : null}
          </div>
          <div className="app__workbench-actions">
            <Button
              variant="ghost"
              color="neutral"
              size="sm"
              onClick={refresh}
              disabled={loading}
              title="Refresh workspace"
            >
              <ArrowClockwiseIcon size={14} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      <div className="app__workbench-content">
        <div className="app__workbench-panel" role="tabpanel" aria-label="Workspace artifacts">
          {error ? <div className="app__workspace-empty">{error}</div> : null}
          {!error && hasWorkspaceEntries ? (
            <div
              className="nanites-workspace__review-grid"
              data-file-tree-open={isFileTreeOpen}
              style={{ "--nanites-tree-w": `${treeWidth}px` } as CSSProperties}
            >
              <div className="nanites-workspace__review-file">
                <div className="nanites-workspace__review-file-header">
                  <span className="app__preview-url-text" title={selectedPath ?? "Workspace"}>
                    {selectedPath ? selectedPath.replace(/^\//, "") : "Select a file"}
                  </span>
                  {selectedFile && (selectedFile.additions > 0 || selectedFile.deletions > 0) ? (
                    <>
                      <span className="nanites-workspace__review-stat" data-tone="success">
                        +{selectedFile.additions}
                      </span>
                      <span className="nanites-workspace__review-stat" data-tone="danger">
                        -{selectedFile.deletions}
                      </span>
                    </>
                  ) : null}
                  <Button
                    className="nanites-workspace__review-tree-toggle"
                    variant="ghost"
                    color="neutral"
                    size="sm"
                    onClick={() => setFileTreeOpen(!isFileTreeOpen)}
                    title={isFileTreeOpen ? "Hide file tree" : "Show file tree"}
                  >
                    <SidebarSimpleIcon size={14} aria-hidden="true" />
                  </Button>
                </div>
                <div className="app__workspace-code-pane">
                  {selectedFile ? (
                    <div className="app__workspace-code-shell">
                      <CodeBlock
                        className="app__workspace-code-block"
                        code={selectedFile.content}
                        language={inferWorkspaceLanguage(selectedFile.path)}
                        showLineNumbers
                      >
                        <CodeBlockContainer className="app__workspace-code-container">
                          <CodeBlockContent />
                        </CodeBlockContainer>
                      </CodeBlock>
                    </div>
                  ) : (
                    <div className="app__workspace-empty">
                      {selectedFileIsLoading ? "Loading file..." : "Select a file to preview"}
                    </div>
                  )}
                </div>
              </div>

              {isFileTreeOpen ? (
                <button
                  type="button"
                  className="nanites-workspace__resizer nanites-workspace__resizer--tree"
                  style={{ insetInlineEnd: `${treeWidth}px` }}
                  aria-label="Resize file tree"
                  onPointerDown={(event) =>
                    beginColumnResize(event, {
                      current: treeWidth,
                      min: 180,
                      max: 420,
                      grow: -1,
                      apply: setTreeWidth,
                    })
                  }
                />
              ) : null}

              {isFileTreeOpen ? (
                <div className="nanites-workspace__review-tree">
                  <label className="nanites-workspace__review-filter">
                    <MagnifyingGlassIcon size={13} aria-hidden="true" />
                    <input
                      type="search"
                      value={fileFilter}
                      onChange={(event) => setFileFilter(event.currentTarget.value)}
                      placeholder="Filter files..."
                      aria-label="Filter workspace files"
                    />
                  </label>
                  <div className="app__workspace-body app__workspace-body--tree">
                    {(!fileFilter.trim() && hasWorkspaceEntries) ||
                    filteredFileEntries.length > 0 ? (
                      <FileTree
                        className="app__workspace-tree"
                        expanded={new Set(expandedPaths)}
                        selectedPath={selectedPath}
                        onExpandedChange={handleExpandedChange}
                        onSelect={handleSelectFile}
                      >
                        {renderWorkspaceTree()}
                      </FileTree>
                    ) : (
                      <div className="app__workspace-empty">
                        {loading || loadingDirectories.size > 0 || filterSearchLoading
                          ? "Loading workspace..."
                          : "No matching files"}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {!error && !hasWorkspaceEntries ? (
            <div className="app__workspace-empty">
              {loading ? "Loading workspace..." : "No workspace files"}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function NanitesRoute() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const sessionQuery = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: fetchOptionalSession,
    throwOnError: true,
  });
  const session = sessionQuery.data;
  const activeInstallation = session?.activeInstallation ?? null;
  const actor = session?.actor ?? null;
  const shouldLoadInstallations = !sessionQuery.isPending && !activeInstallation;
  const installationsQuery = useQuery({
    queryKey: visibleInstallationsQueryKey,
    queryFn: fetchVisibleInstallations,
    enabled: shouldLoadInstallations,
    throwOnError: true,
  });

  if (sessionQuery.isPending || (shouldLoadInstallations && installationsQuery.isPending)) {
    return <RoutePendingPage />;
  }

  if (!activeInstallation || !actor) {
    const installations = installationsQuery.data?.installations ?? [];
    if (installations.length > 0) {
      return <NanitesChooseInstallationState installations={installations} />;
    }

    return <NanitesZeroInstallState />;
  }

  const managerName = buildNaniteManagerKey(activeInstallation.id);
  const requestedAccount = search.account ?? activeInstallation.account.login;
  const requestedInstallationId = search.installationId ?? activeInstallation.id;
  const installationMatches =
    requestedAccount === activeInstallation.account.login &&
    requestedInstallationId === activeInstallation.id;

  if (!installationMatches) {
    return (
      <main className="nanites-workspace nanites-workspace--empty">
        <section className="nanites-workspace__empty-state">
          <div className="nanites-workspace__empty-panel">
            <h1>Installation mismatch</h1>
            <p>
              The URL points at a different GitHub account or installation than the one currently
              selected in this browser session. Switch accounts or update the URL before opening
              Nanite runs.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <NanitesRuntimeSurface
      actor={actor}
      activeInstallation={activeInstallation}
      managerName={managerName}
      selectedNaniteId={search.naniteId ?? null}
      selectedRunId={search.runId ?? null}
      selectedSurface={search.surface ?? "manager"}
      setSelection={(selection) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            account: activeInstallation.account.login,
            installationId: activeInstallation.id,
            naniteId: selection.surface === "nanite" ? selection.naniteId : undefined,
            runId: undefined,
            surface: selection.surface,
          }),
          replace: true,
        })
      }
    />
  );
}

function NanitesZeroInstallState() {
  const location = useLocation();
  const installHref = buildGitHubAppInstallHref({ state: buildReturnToPath(location) });

  return (
    <div className="dashboard">
      <Card>
        <div className="dashboard__zero-install">
          <div className="dashboard__setup-mark" aria-hidden="true">
            <GithubLogoIcon size={22} weight="fill" />
          </div>
          <h1 className="dashboard__heading">Install the SigVelo GitHub App</h1>
          <p className="dashboard__subtext">
            You are signed in, but GitHub is not reporting a SigVelo installation for any account
            you can access. Install the app on the user or organization that owns the repositories
            Nanites should work on.
          </p>
          <ol className="dashboard__setup-steps" aria-label="GitHub App setup steps">
            <li>Choose a GitHub user or organization.</li>
            <li>Select all repositories or only the repositories Nanites may maintain.</li>
            <li>Return to SigVelo and refresh this page.</li>
          </ol>
          <div className="dashboard__zero-install-actions">
            <a
              className="button button--primary button--md"
              href={installHref}
              target="_blank"
              rel="noreferrer"
            >
              <GithubLogoIcon size={16} aria-hidden="true" />
              <span>Install GitHub App</span>
              <ArrowSquareOutIcon size={14} aria-hidden="true" />
            </a>
          </div>
        </div>
      </Card>
    </div>
  );
}

function NanitesChooseInstallationState({
  installations,
}: {
  readonly installations: VisibleInstallationsResponse["installations"];
}) {
  const location = useLocation();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const returnToPath = buildReturnToPath(location);
  const installHref = buildGitHubAppInstallHref({ state: returnToPath });
  const changeInstallation = useMutation({
    mutationFn: setActiveInstallation,
    onSuccess: async (_data, variables) => {
      await invalidateAuthQueries(queryClient);
      const installation = installations.find(
        (candidate) => candidate.id === variables.githubInstallationId,
      );
      await navigate({
        to: "/nanites",
        search: installation
          ? {
              account: installation.account?.login ?? "unknown",
              installationId: installation.id,
            }
          : {},
      });
    },
  });

  return (
    <div className="dashboard">
      <Card>
        <div className="dashboard__zero-install">
          <div className="dashboard__setup-mark" aria-hidden="true">
            <PlugsIcon size={22} />
          </div>
          <h1 className="dashboard__heading">Choose where Nanites can work</h1>
          <p className="dashboard__subtext">
            GitHub says SigVelo is installed on these accounts, but this browser session does not
            have an active installation selected. Pick the account that owns the repository you want
            to connect.
          </p>
          <ul className="dashboard__installation-list" aria-label="Available GitHub installations">
            {installations.map((installation) => {
              const account = installation.account;
              const accountLogin = account?.login ?? "Unknown account";
              return (
                <li key={installation.id}>
                  <button
                    type="button"
                    className="dashboard__installation-option"
                    disabled={changeInstallation.isPending}
                    onClick={() =>
                      changeInstallation.mutate({
                        githubInstallationId: installation.id,
                      })
                    }
                  >
                    <Avatar.Root className="dashboard__installation-avatar">
                      {account?.avatar_url ? (
                        <Avatar.Image src={account.avatar_url} alt="" />
                      ) : null}
                      <Avatar.Fallback>{accountLogin.slice(0, 2).toUpperCase()}</Avatar.Fallback>
                    </Avatar.Root>
                    <span className="dashboard__installation-copy">
                      <span className="dashboard__installation-login">{accountLogin}</span>
                      <span className="dashboard__installation-type">
                        {account?.type ?? "Account"}
                      </span>
                    </span>
                    <span className="dashboard__installation-cta">
                      {changeInstallation.isPending ? "Selecting..." : "Use account"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="dashboard__zero-install-actions">
            <a
              className="button button--outline button--primary button--md"
              href={installHref}
              target="_blank"
              rel="noreferrer"
            >
              <GithubLogoIcon size={16} aria-hidden="true" />
              <span>Install on another account</span>
              <ArrowSquareOutIcon size={14} aria-hidden="true" />
            </a>
            <Button
              color="neutral"
              size="md"
              variant="outline"
              onClick={() => {
                void invalidateAuthQueries(queryClient);
              }}
            >
              <ArrowClockwiseIcon size={16} aria-hidden="true" />
              <span>Refresh</span>
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function NanitesRuntimeSurface({
  activeInstallation,
  actor,
  managerName,
  selectedNaniteId,
  selectedRunId,
  selectedSurface,
  setSelection,
}: {
  readonly activeInstallation: SessionInstallationSnapshot;
  readonly actor: BrowserNanitesContext["actor"];
  readonly managerName: string;
  readonly selectedNaniteId: string | null;
  readonly selectedRunId: string | null;
  readonly selectedSurface: "manager" | "nanite";
  readonly setSelection: (
    selection:
      | { readonly surface: "manager" }
      | { readonly surface: "nanite"; readonly naniteId: string },
  ) => void;
}) {
  const navigate = Route.useNavigate();
  const [mobileView, setMobileView] = useState<NaniteMobileView>("chat");
  const [desktopPanel, setDesktopPanel] = useState<NaniteDesktopPanel>("details");
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const toggleGroupCollapsed = useCallback((repository: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(repository)) {
        next.delete(repository);
      } else {
        next.add(repository);
      }
      return next;
    });
  }, []);
  const [isAsideOpen, setIsAsideOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [detailsWidth, setDetailsWidth] = useState(340);
  const [filesWidth, setFilesWidth] = useState(560);
  const asideWidth = desktopPanel === "files" ? filesWidth : detailsWidth;
  const setAsideWidth = desktopPanel === "files" ? setFilesWidth : setDetailsWidth;
  const mobileTouchStartRef = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const managerStateQuery = useQuery({
    queryKey: ["nanites", "manager", managerName],
    queryFn: () => fetchManagerState(managerName),
    throwOnError: true,
  });
  const manager = useAgent<SigveloNaniteManager, NaniteManagerState>({
    agent: NANITE_MANAGER_NAME,
    name: managerName,
  });
  const initialState = isNaniteManagerState(managerStateQuery.data?.state)
    ? managerStateQuery.data.state
    : emptyState;
  const state = pickManagerState({
    initialState,
    liveState: manager.state,
  });
  const runs = useMemo(
    () => state.runOrder.map((runId) => state.runs[runId]).filter((run) => run !== undefined),
    [state.runOrder, state.runs],
  );
  const runsByNanite = useMemo(() => {
    const groups = new Map<string, NaniteRunRecord[]>();
    for (const run of runs) {
      const group = groups.get(run.naniteId) ?? [];
      group.push(run);
      groups.set(run.naniteId, group);
    }
    return groups;
  }, [runs]);
  const naniteItems = useMemo(
    () =>
      Object.entries(state.nanites)
        .map(([id, nanite]) => {
          const naniteRuns = runsByNanite.get(id) ?? [];
          return {
            id,
            nanite,
            repositories: getNaniteRepositories(nanite, naniteRuns),
            latestRun: naniteRuns[0] ?? null,
            activity: state.runtimeActivityByNanite?.[id] ?? null,
            runCount: naniteRuns.length,
          };
        })
        .sort((left, right) => {
          const leftTime = left.latestRun?.startedAt ?? left.nanite.updatedAt;
          const rightTime = right.latestRun?.startedAt ?? right.nanite.updatedAt;
          return rightTime.localeCompare(leftTime);
        }),
    [runsByNanite, state.nanites, state.runtimeActivityByNanite],
  );
  const naniteGroups = useMemo(() => groupNanitesByRepository(naniteItems), [naniteItems]);
  const isManagerSelected = selectedSurface === "manager";
  const selectedNaniteItem =
    !isManagerSelected && selectedNaniteId
      ? naniteItems.find((item) => item.id === selectedNaniteId)
      : undefined;
  const fallbackNaniteItem = naniteItems[0] ?? null;
  const activeNaniteItem = selectedNaniteItem ?? (!isManagerSelected ? fallbackNaniteItem : null);
  const selectedNaniteRuns = activeNaniteItem ? (runsByNanite.get(activeNaniteItem.id) ?? []) : [];
  const selectedRun =
    (selectedRunId ? selectedNaniteRuns.find((run) => run.runId === selectedRunId) : undefined) ??
    selectedNaniteRuns[0] ??
    null;
  const selectedNanite = activeNaniteItem?.nanite ?? null;
  const selectedNaniteAgentId = activeNaniteItem?.id ?? null;
  const deleteNanite = useMutation({
    mutationFn: async (input: { readonly naniteId: string }) => {
      // The Agents SDK can infer this from the full manager interface, but expanding
      // this RPC method hits TS2589 in this route.
      // @ts-expect-error Type instantiation is excessively deep for the full manager stub.
      const output = (await manager.stub.deprovisionNanites({
        naniteIds: [input.naniteId],
        reason: `Deleted from the Nanites UI for ${activeInstallation.account.login}.`,
      })) as DeprovisionNanitesOutput;
      if (!output.deprovisionedNaniteIds.includes(input.naniteId)) {
        const skipped = output.skippedNaniteIds.find(
          (candidate) => candidate.naniteId === input.naniteId,
        );
        throw new Error(skipped ? `Delete skipped: ${skipped.reason}.` : "Delete did not apply.");
      }
      return output;
    },
    onSuccess: async (_output, input) => {
      const nextItem = naniteItems.find((item) => item.id !== input.naniteId) ?? null;
      await managerStateQuery.refetch();
      await navigate({
        search: (previous) => ({
          ...previous,
          account: activeInstallation.account.login,
          installationId: activeInstallation.id,
          naniteId: nextItem?.id,
          surface: nextItem ? "nanite" : "manager",
        }),
        replace: true,
      });
      setMobileView(nextItem ? "chat" : "nanites");
    },
  });
  const testTrigger = useMutation({
    mutationFn: async (input: { readonly nanite: ManagedNanite }) => {
      const event = buildBrowserTriggerTestEvent(input.nanite);
      if (!event) {
        throw new Error("Only GitHub-triggered Nanites can run trigger tests from the browser.");
      }

      const output = (await manager.stub.testNaniteTrigger({
        naniteId: input.nanite.manifest.id,
        actorId: `github:${actor.id}`,
        requestId: crypto.randomUUID(),
        event,
        waitForTerminalOutcome: false,
      })) as TestNaniteTriggerOutput;
      if (!output.ok) {
        throw new Error(output.error ?? "Trigger test did not start a Nanite run.");
      }

      return output;
    },
    onSuccess: async (output) => {
      const latestRun = output.runs[0] ?? null;
      await managerStateQuery.refetch();
      await navigate({
        search: (previous) => ({
          ...previous,
          account: activeInstallation.account.login,
          installationId: activeInstallation.id,
          naniteId: output.naniteId,
          runId: latestRun?.runId,
          surface: "nanite",
        }),
        replace: true,
      });
      setMobileView("chat");
    },
  });

  const selectMobileView = (view: NaniteMobileView) => {
    setMobileView(view);
  };

  const moveMobileView = (direction: 1 | -1) => {
    const currentIndex = naniteMobileViews.indexOf(mobileView);
    const nextIndex = Math.min(naniteMobileViews.length - 1, Math.max(0, currentIndex + direction));
    const nextView = naniteMobileViews[nextIndex];
    if (nextView) {
      selectMobileView(nextView);
    }
  };

  useEffect(() => {
    void navigate({
      search: (previous) => ({
        ...previous,
        account: previous.account ?? activeInstallation.account.login,
        installationId: previous.installationId ?? activeInstallation.id,
        surface: previous.surface ?? "manager",
        naniteId:
          previous.surface === "nanite" ? (previous.naniteId ?? fallbackNaniteItem?.id) : undefined,
        runId: previous.runId,
      }),
      replace: true,
    });
  }, [activeInstallation.account.login, activeInstallation.id, fallbackNaniteItem?.id, navigate]);

  return (
    <main
      className="nanites-workspace"
      data-desktop-panel={desktopPanel}
      data-aside-open={isAsideOpen}
      data-mobile-view={mobileView}
      aria-label="Nanite runtime"
      style={
        {
          "--nanites-sidebar-w": `${sidebarWidth}px`,
          "--nanites-aside-w": `${asideWidth}px`,
        } as CSSProperties
      }
      onTouchStart={(event) => {
        const touch = event.touches[0];
        if (!touch) return;
        mobileTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
      }}
      onTouchEnd={(event) => {
        const start = mobileTouchStartRef.current;
        const touch = event.changedTouches[0];
        mobileTouchStartRef.current = null;
        if (!start || !touch) return;

        const deltaX = touch.clientX - start.x;
        const deltaY = touch.clientY - start.y;
        if (
          Math.abs(deltaX) < naniteMobileSwipeThreshold ||
          Math.abs(deltaX) < Math.abs(deltaY) * 1.5
        ) {
          return;
        }

        moveMobileView(deltaX < 0 ? 1 : -1);
      }}
    >
      <button
        type="button"
        className="nanites-workspace__resizer nanites-workspace__resizer--sidebar"
        style={{ insetInlineStart: `${sidebarWidth}px` }}
        aria-label="Resize Nanites list"
        onPointerDown={(event) =>
          beginColumnResize(event, {
            current: sidebarWidth,
            min: 200,
            max: 380,
            grow: 1,
            apply: setSidebarWidth,
          })
        }
      />
      {isAsideOpen ? (
        <button
          type="button"
          className="nanites-workspace__resizer nanites-workspace__resizer--aside"
          style={{ insetInlineEnd: `${asideWidth}px` }}
          aria-label="Resize side panel"
          onPointerDown={(event) =>
            beginColumnResize(event, {
              current: asideWidth,
              min: desktopPanel === "files" ? 380 : 280,
              max: desktopPanel === "files" ? 820 : 560,
              grow: -1,
              apply: setAsideWidth,
            })
          }
        />
      ) : null}

      {!isAsideOpen ? (
        <button
          type="button"
          className="nanites-workspace__aside-reveal"
          onClick={() => setIsAsideOpen(true)}
          aria-label="Show details panel"
          title="Show panel"
        >
          <SidebarSimpleIcon size={16} aria-hidden="true" />
        </button>
      ) : null}

      <aside className="nanites-workspace__sidebar app__pane" aria-label="Nanites">
        <div className="nanites-workspace__masthead">
          <div className="app__brand">
            <div className="app__brand-copy">
              <h1 className="app__brand-title">Nanites</h1>
              <InstallationPicker activeInstallation={activeInstallation} />
            </div>
          </div>
          <span className="nanites-workspace__count">{naniteItems.length}</span>
        </div>

        <div className="nanites-workspace__list">
          <div className="nanites-workspace__manager-pin" aria-label="Installation manager">
            <button
              className="nanites-workspace__item"
              data-selected={isManagerSelected}
              onClick={() => {
                setSelection({ surface: "manager" });
                setMobileView("chat");
              }}
              type="button"
            >
              <span
                className="nanites-workspace__source-icon"
                data-tone="active"
                title="Installation manager"
              >
                <SlidersHorizontalIcon size={15} aria-hidden="true" />
              </span>
              <span className="nanites-workspace__item-copy">
                <strong>Installation Manager</strong>
              </span>
              <span className="nanites-workspace__activity" data-kind="dot" data-tone="active">
                <DotOutlineIcon size={18} weight="fill" aria-hidden="true" />
              </span>
            </button>
          </div>

          {naniteGroups.length > 0 ? (
            naniteGroups.map((group) => {
              const groupLabel = formatRepositoryGroupLabel(
                group.repository,
                activeInstallation.account.login,
              );
              const isCollapsed = collapsedGroups.has(group.repository);

              return (
                <section
                  className="nanites-workspace__group"
                  data-collapsed={isCollapsed || undefined}
                  key={group.repository}
                >
                  <button
                    type="button"
                    className="nanites-workspace__group-header"
                    onClick={() => toggleGroupCollapsed(group.repository)}
                    aria-expanded={!isCollapsed}
                    title={group.repository}
                  >
                    <CaretDownIcon
                      className="nanites-workspace__group-caret"
                      size={12}
                      weight="bold"
                      aria-hidden="true"
                    />
                    <h2>
                      <FolderSimpleIcon size={15} aria-hidden="true" />
                      <span>{groupLabel}</span>
                    </h2>
                    <span>{group.items.length}</span>
                  </button>
                  <div className="nanites-workspace__items" hidden={isCollapsed || undefined}>
                    {group.items.map((item) => (
                      <button
                        className="nanites-workspace__item"
                        data-selected={!isManagerSelected && item.id === activeNaniteItem?.id}
                        key={`${group.repository}:${item.id}`}
                        onClick={() => {
                          setSelection({
                            surface: "nanite",
                            naniteId: item.id,
                          });
                          setMobileView("chat");
                        }}
                        type="button"
                      >
                        <span
                          className="nanites-workspace__source-icon"
                          data-tone={
                            item.latestRun ? getRunStatusTone(item.latestRun.status) : "idle"
                          }
                          title={
                            item.latestRun ? formatStatus(item.latestRun.status) : "No runs yet"
                          }
                        >
                          {getRunSourceIcon(item.latestRun)}
                        </span>
                        <span className="nanites-workspace__item-copy">
                          <strong>{item.nanite.manifest.name}</strong>
                        </span>
                        <span
                          className="nanites-workspace__activity"
                          data-kind={getRunActivityKind(item.latestRun, item.activity)}
                          data-tone={getRunActivityTone(item.latestRun, item.activity)}
                          title={
                            item.latestRun
                              ? `${getRunActivityLabel(item.latestRun, item.activity)} · ${formatStatus(
                                  item.latestRun.status,
                                )} · ${formatDate(item.latestRun.startedAt)}`
                              : "No runs yet"
                          }
                        >
                          {getRunActivityKind(item.latestRun, item.activity) === "spinner" ? (
                            <CircleNotchIcon size={14} aria-hidden="true" />
                          ) : null}
                          {getRunActivityKind(item.latestRun, item.activity) === "dot" ? (
                            <DotOutlineIcon size={18} weight="fill" aria-hidden="true" />
                          ) : null}
                          {getRunActivityKind(item.latestRun, item.activity) === "time"
                            ? getRunActivityLabel(item.latestRun, item.activity)
                            : null}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })
          ) : (
            <p className="nanites-workspace__empty">
              No Nanites are registered for this installation yet.
            </p>
          )}
        </div>
      </aside>

      <section className="nanites-workspace__runtime app__pane--chat" aria-label="Nanite chat">
        <div className="nanites-workspace__runtime-body" data-info-open={true}>
          <div className="nanites-workspace__chat">
            {isManagerSelected ? (
              <Suspense
                fallback={<NaniteRuntimeChatLoading placeholder="Connecting to the manager..." />}
              >
                <ManagerRuntimeChatConnector
                  accountLogin={activeInstallation.account.login}
                  actor={actor}
                  githubInstallationId={activeInstallation.id}
                  managerName={managerName}
                />
              </Suspense>
            ) : selectedNaniteAgentId ? (
              <Suspense fallback={<NaniteRuntimeChatLoading />}>
                <NaniteRuntimeChatConnector
                  key={selectedNaniteAgentId}
                  managerName={managerName}
                  naniteId={selectedNaniteAgentId}
                />
              </Suspense>
            ) : (
              <NaniteRuntimeChatPlaceholder />
            )}
          </div>
        </div>
      </section>

      <aside className="nanites-workspace__aside" aria-label="Nanite details and review">
        <div className="nanites-workspace__aside-header">
          <div className="nanites-workspace__panel-toggle" aria-label="Right panel">
            <button
              type="button"
              data-selected={desktopPanel === "details"}
              onClick={() => setDesktopPanel("details")}
              aria-label="Details"
              title="Details"
            >
              <SlidersHorizontalIcon size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-selected={desktopPanel === "files"}
              onClick={() => setDesktopPanel("files")}
              aria-label="Review"
              title="Review"
            >
              <FileIcon size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="nanites-workspace__aside-actions">
            <button
              type="button"
              className="nanites-workspace__aside-collapse"
              onClick={() => setIsAsideOpen(false)}
              aria-label="Collapse details panel"
              title="Collapse panel"
            >
              <SidebarSimpleIcon size={14} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="nanites-workspace__details-slot" data-active={desktopPanel === "details"}>
          {isManagerSelected ? (
            <ManagerInfoPanel
              activeInstallation={activeInstallation}
              naniteCount={naniteItems.length}
              runCount={runs.length}
            />
          ) : (
            <NaniteRunInfoPanel
              activeInstallation={activeInstallation}
              deleteError={deleteNanite.error}
              isDeleting={deleteNanite.isPending}
              isTestingTrigger={testTrigger.isPending}
              nanite={selectedNanite}
              onTestTrigger={() => {
                if (!selectedNanite) {
                  return;
                }

                testTrigger.mutate({ nanite: selectedNanite });
              }}
              onDeleteNanite={() => {
                if (!selectedNaniteAgentId) {
                  return;
                }

                deleteNanite.mutate({ naniteId: selectedNaniteAgentId });
              }}
              run={selectedRun}
              testTriggerError={testTrigger.error}
            />
          )}
        </div>

        <div className="nanites-workspace__files-slot" data-active={desktopPanel === "files"}>
          {isManagerSelected ? (
            <NaniteWorkspacePanel
              managerName={managerName}
              nanite={null}
              naniteId={null}
              refreshKey="manager"
            />
          ) : (
            <NaniteWorkspacePanel
              managerName={managerName}
              nanite={selectedNanite}
              naniteId={selectedNaniteAgentId}
              refreshKey={`${selectedRun?.runId ?? "no-run"}:${selectedRun?.updatedAt ?? "no-update"}`}
            />
          )}
        </div>
      </aside>

      <nav className="nanites-workspace__mobile-nav" aria-label="Nanite workspace views">
        <button
          type="button"
          data-selected={mobileView === "nanites"}
          onClick={() => selectMobileView("nanites")}
        >
          <FolderSimpleIcon size={18} aria-hidden="true" />
          <span>Nanites</span>
        </button>
        <button
          type="button"
          data-selected={mobileView === "chat"}
          onClick={() => selectMobileView("chat")}
        >
          <ChatCircleTextIcon size={18} aria-hidden="true" />
          <span>Chat</span>
        </button>
        <button
          type="button"
          data-selected={mobileView === "files"}
          onClick={() => selectMobileView("files")}
        >
          <FileIcon size={18} aria-hidden="true" />
          <span>Files</span>
        </button>
        <button
          type="button"
          data-selected={mobileView === "details"}
          onClick={() => selectMobileView("details")}
        >
          <SlidersHorizontalIcon size={18} aria-hidden="true" />
          <span>Details</span>
        </button>
      </nav>
    </main>
  );
}
