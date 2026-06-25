import "./nanites.css";
import {
  SIGVELO_GITHUB_APP_URL,
  NANITE_MANAGER_NAME,
  MANAGER_CONVERSATION_AGENT_NAME,
  NANITE_AGENT_NAME,
  DEFAULT_SIGVELO_AGENT_MODEL_ID,
} from "#/shared/constants.ts";
import { isRecord } from "#/shared/utils/values.ts";
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
import { Link, createFileRoute, useLocation } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { DetailedError, parseResponse } from "hono/client";
import { z } from "zod";
import { httpClient } from "#/frontend/lib/http-client.ts";
import { Avatar } from "#/frontend/ui/components/Avatar.tsx";
import { Button } from "#/frontend/ui/components/Button.tsx";
import {
  CodeBlock,
  CodeBlockContainer,
  CodeBlockContent,
  type CodeBlockLanguage,
} from "#/frontend/ui/components/CodeBlock.tsx";
import { CheckIcon, CopyIcon } from "#/frontend/ui/components/_internal/icons.tsx";
import { FileTree, FileTreeFile, FileTreeFolder } from "#/frontend/ui/components/FileTree.tsx";
import { Popover } from "#/frontend/ui/components/Popover.tsx";
import {
  Tooltip,
  TooltipPopup,
  TooltipPortal,
  TooltipPositioner,
  TooltipTrigger,
} from "#/frontend/ui/components/Tooltip.tsx";
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  ChartBarIcon,
  ChatCircleTextIcon,
  CircleNotchIcon,
  DotOutlineIcon,
  FileIcon,
  FolderSimpleIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  GithubLogoIcon,
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
  SidebarSimpleIcon,
  SignOutIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { BrowserNanitesContext, SessionInstallationSnapshot } from "#/frontend/lib/auth.ts";
import type {
  DeprovisionNaniteOutput,
  ManagedNanite,
  NaniteManagerState,
  NaniteManifest,
  NaniteRuntimeActivity,
  NaniteRunRecord,
  NaniteRunStatus,
  SigveloNaniteManager,
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
  type NaniteAgentInstance,
} from "#/frontend/routes/_authenticated/nanites/-runtime-chat.tsx";
import { GitHubInstallRequiredState } from "#/frontend/routes/_authenticated/-github-install-required-state.tsx";
import {
  getNextNaniteDesktopPanel,
  NaniteDesktopPanelControls,
  type NaniteDesktopPanel,
} from "#/frontend/routes/_authenticated/nanites/-layout-controls.tsx";
import { AgentConnectionPopover } from "#/frontend/ui/components/AgentConnection.tsx";
import {
  CloudflareModelSelector,
  type CloudflareModelSelectorGroup,
} from "#/frontend/ui/components/ModelSelector.tsx";
import { RoutePendingPage } from "#/frontend/lib/route-state.tsx";
import {
  AUTH_SESSION_QUERY_KEY,
  buildReturnToPath,
  fetchOptionalSession,
  invalidateAuthQueries,
} from "#/frontend/lib/auth.ts";
import type {
  SigveloManagerConversationAgent,
  ManagerConversationState,
} from "#/backend/agents/SigveloManagerConversationAgent.ts";
import { buildNaniteAgentName, type NaniteManagerKey } from "#/shared/utils/nanites.ts";
import { buildGitHubAppInstallHref } from "#/shared/utils/github.ts";
import {
  getGitHubWebhookAction,
  getGitHubWebhookBranch,
  getGitHubWebhookEventName,
  getGitHubWebhookHeadSha,
  getGitHubWebhookPullRequestNumber,
  getGitHubWebhookRepositoryFullName,
} from "#/shared/utils/github.ts";

const emptyState: NaniteManagerState = {
  nanites: {},
  runs: {},
  runOrder: [],
  runtimeActivityByNanite: {},
  updatedAt: null,
};
type BrowserDeploymentGitHubApp = {
  readonly appId: number;
  readonly slug: string;
  readonly htmlUrl: string;
  readonly ownerLogin: string | null;
};

type NaniteModelCatalogGroup = CloudflareModelSelectorGroup;

type NaniteModelCatalog = {
  readonly groups: readonly NaniteModelCatalogGroup[];
  readonly thirdPartyModelsUrl: string | null;
};

const naniteModelProviderLabels: Record<string, string> = {
  ai4bharat: "AI4Bharat",
  aisingapore: "AI Singapore",
  alibaba: "Alibaba",
  anthropic: "Anthropic",
  baai: "BAAI",
  deepseek: "DeepSeek",
  "deepseek-ai": "DeepSeek",
  google: "Google",
  ibm: "IBM",
  "ibm-granite": "IBM",
  meta: "Meta",
  "meta-llama": "Meta",
  mistral: "Mistral AI",
  mistralai: "Mistral AI",
  minimax: "MiniMax",
  moonshotai: "Moonshot AI",
  nvidia: "NVIDIA",
  openai: "OpenAI",
  qwen: "Qwen",
  xai: "xAI",
  "zai-org": "Zhipu AI",
};

async function logoutSession(): Promise<void> {
  await parseResponse(httpClient.api.auth.session.logout.$post());
}

async function fetchManagerState(
  managerName: string,
): Promise<{ managerName: string; state: NaniteManagerState }> {
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

function looksLikeRunnableModelId(value: string): boolean {
  return value.startsWith("@") || /^[a-z0-9][a-z0-9-]*\//i.test(value);
}

function readNaniteModelId(entry: unknown): string | null {
  if (typeof entry === "string") {
    const modelId = entry.trim();
    return modelId.length > 0 ? modelId : null;
  }

  if (!isRecord(entry)) {
    return null;
  }

  const candidates = [entry.name, entry.id].flatMap((value) => {
    if (typeof value !== "string") {
      return [];
    }

    const modelId = value.trim();
    return modelId ? [modelId] : [];
  });
  return candidates.find(looksLikeRunnableModelId) ?? candidates[0] ?? null;
}

function formatNaniteModelProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (naniteModelProviderLabels[normalized]) {
    return naniteModelProviderLabels[normalized];
  }

  return normalized
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function readNaniteModelProvider(modelId: string): string {
  const [, hostedProvider] = /^@(?:cf|hf)\/([^/]+)/.exec(modelId) ?? [];
  if (hostedProvider) {
    return formatNaniteModelProvider(hostedProvider);
  }

  const [provider] = modelId.split("/", 1);
  return provider ? formatNaniteModelProvider(provider) : "Other";
}

function readNaniteModelCatalog(data: unknown): NaniteModelCatalog {
  if (!isRecord(data) || !Array.isArray(data.models)) {
    throw new Error("Nanite models response was malformed.");
  }

  const models = data.models
    .map(readNaniteModelId)
    .filter((modelId): modelId is string => modelId !== null);
  return {
    groups: [...Map.groupBy(models, readNaniteModelProvider)].map(([provider, groupModels]) => ({
      provider,
      models: [...new Set(groupModels)],
    })),
    thirdPartyModelsUrl:
      typeof data.thirdPartyModelsUrl === "string" ? data.thirdPartyModelsUrl : null,
  };
}

async function fetchNaniteModels(): Promise<NaniteModelCatalog> {
  const data = await readJsonResponse(httpClient.api.nanites.models.$get());
  return readNaniteModelCatalog(data);
}

async function readJsonResponse(
  responsePromise: Promise<{
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    json(): Promise<unknown>;
  }>,
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

const naniteMobileViews: readonly NaniteMobileView[] = ["nanites", "chat", "files", "summary"];
const managerMobileViews: readonly NaniteMobileView[] = ["nanites", "chat"];
const naniteMobileSwipeThreshold = 64;
const naniteActiveActivityMs = 30_000;

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

type NaniteEventSource = NaniteManifest["eventSource"];
type NanitesSelection = { readonly naniteId: string } | { readonly mode: "create" };
type NaniteMobileView = "nanites" | "chat" | "files" | "summary";

export const Route = createFileRoute("/_authenticated/nanites")({
  validateSearch: z.object({
    mode: z.enum(["create"]).optional(),
    naniteId: z.string().optional(),
    runId: z.string().optional(),
  }),
  component: NanitesRoute,
});

const naniteRelativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
  style: "narrow",
});

function formatStatus(status: NaniteRunStatus): string {
  return status.replaceAll("_", " ");
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
  for (const { unit, ms } of units) {
    if (absoluteMs >= ms) {
      return naniteRelativeTimeFormatter.format(Math.round(-elapsedMs / ms), unit);
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
  if (status === "waiting_for_manager") {
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
  if (activity?.state === "waiting_for_manager" || run?.status === "waiting_for_manager") {
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

  if (run.status === "waiting_for_manager" || activity?.state === "waiting_for_manager") {
    return "waiting";
  }

  if (isFreshRunOutcome(run)) {
    return "ready";
  }

  const completedAt = "completedAt" in run ? run.completedAt : null;
  return formatRelativeDate(
    activity?.lastActivityAt ?? completedAt ?? run.updatedAt ?? run.startedAt,
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

  if (activity?.state === "waiting_for_manager" || run.status === "waiting_for_manager") {
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

function AccountMenu({
  activeInstallation,
  githubApp,
}: {
  readonly activeInstallation: SessionInstallationSnapshot;
  readonly githubApp: BrowserDeploymentGitHubApp | null;
}) {
  const navigate = Route.useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
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

  const returnToPath = buildReturnToPath(location);
  const manageAccessHref = buildGitHubAppInstallHref({
    appSlug: githubApp?.slug,
    state: returnToPath,
    suggestedTargetId: activeInstallation.account.id,
  });
  const githubAppHref = githubApp?.htmlUrl ?? SIGVELO_GITHUB_APP_URL;
  const triggerAvatarSrc = withAvatarSize(activeInstallation.account.avatar_url, 40);
  const headerAvatarSrc = withAvatarSize(activeInstallation.account.avatar_url, 64);

  return (
    <Popover.Root>
      <Popover.Trigger className="account-menu__trigger account-menu__trigger--nanites">
        <Avatar.Root className="account-menu__trigger-avatar">
          {triggerAvatarSrc ? (
            <Avatar.Image src={triggerAvatarSrc} alt="" width={40} height={40} />
          ) : null}
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
                {headerAvatarSrc ? (
                  <Avatar.Image src={headerAvatarSrc} alt="" width={64} height={64} />
                ) : null}
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
            </div>

            <div className="account-menu__divider" />

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
              href={githubAppHref}
              target="_blank"
              rel="noreferrer"
            >
              <GithubLogoIcon size={14} aria-hidden="true" />
              <span>View GitHub App</span>
              <ArrowSquareOutIcon size={14} aria-hidden="true" />
            </a>

            <div className="account-menu__divider" />

            <Button
              variant="ghost"
              color="neutral"
              className="account-menu__action"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <SignOutIcon size={14} aria-hidden="true" />
              <span>{logout.isPending ? "Signing out..." : "Sign out"}</span>
            </Button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function getEventSourceRepositories(eventSource: NaniteEventSource): string[] {
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
  eventSource: Extract<NaniteEventSource, { type: "schedule" | "scheduleEvery" }>,
): string {
  switch (eventSource.type) {
    case "schedule":
      return `schedule(${JSON.stringify(eventSource.when)})`;
    case "scheduleEvery":
      return `scheduleEvery(${eventSource.intervalSeconds}s)`;
  }
}

function formatEventSourceSpec(eventSource: NaniteEventSource): string {
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
      <span>{row.value}</span>
      {row.href ? <ArrowSquareOutIcon size={13} aria-hidden="true" /> : null}
    </>
  );

  if (row.href) {
    return (
      <a className="nanites-workspace__info-row" href={row.href} target="_blank" rel="noreferrer">
        {content}
      </a>
    );
  }

  return (
    <div className="nanites-workspace__info-row nanites-workspace__info-row--static">{content}</div>
  );
}

function InfoSection({
  title,
  className,
  children,
  collapsible = true,
}: {
  readonly title: string;
  readonly className?: string;
  readonly children: ReactNode;
  readonly collapsible?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const isSectionOpen = collapsible ? isOpen : true;

  return (
    <div
      className={
        className
          ? `nanites-workspace__info-section ${className}`
          : "nanites-workspace__info-section"
      }
      data-collapsed={collapsible && !isOpen ? "true" : undefined}
    >
      {collapsible ? (
        <Button
          variant="ghost"
          color="neutral"
          className="nanites-workspace__info-section-header"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
        >
          <h2>{title}</h2>
          <CaretDownIcon size={12} aria-hidden="true" />
        </Button>
      ) : (
        <div className="nanites-workspace__info-section-label">
          <h2>{title}</h2>
        </div>
      )}
      {isSectionOpen ? children : null}
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

function NaniteInfoRail({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <aside className="nanites-workspace__info-rail" aria-label={label}>
      <div className="nanites-workspace__info-card">{children}</div>
    </aside>
  );
}

// Shared model picker for the manager and Nanite cards. `currentModel` is the
// live source of truth; null means the switcher is disabled until it loads.
// `onSelectModel` performs the switch and resolves once it lands so the
// optimistic value can clear.
function ModelSelect({
  ariaLabel,
  currentModel,
  onSelectModel,
}: {
  readonly ariaLabel: string;
  readonly currentModel: string | null;
  readonly onSelectModel: (modelId: string) => Promise<unknown>;
}) {
  const {
    data: modelCatalog,
    isLoading: modelsLoading,
    error: modelsError,
  } = useQuery({
    queryKey: ["nanites", "models"],
    queryFn: fetchNaniteModels,
    staleTime: 60 * 60 * 1000,
  });
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const selectedModel = pendingModel ?? currentModel ?? "";
  const modelChangeDisabled = currentModel === null || pendingModel !== null;
  const modelGroups = modelCatalog?.groups;
  const thirdPartyModelsUrl = modelCatalog?.thirdPartyModelsUrl ?? null;
  const selectModel = (next: string) => {
    if (next === selectedModel) {
      return;
    }

    setPendingModel(next);
    setModelError(null);
    void onSelectModel(next)
      .then(() => setPendingModel(null))
      .catch((error: unknown) => {
        setPendingModel(null);
        setModelError(getErrorMessage(error));
      });
  };
  const error = modelsError ? "Could not load available models. Try reloading." : modelError;

  return (
    <InfoSection title="Model" collapsible={false}>
      <CloudflareModelSelector
        label={ariaLabel}
        value={selectedModel || null}
        groups={modelGroups ?? []}
        disabled={modelChangeDisabled}
        loading={modelsLoading}
        gatewayModelsHref={thirdPartyModelsUrl}
        error={error}
        onValueChange={selectModel}
      />
    </InfoSection>
  );
}

function NaniteManagerInfoPanel({
  managerName,
  actor,
}: {
  readonly managerName: NaniteManagerKey;
  readonly actor: BrowserNanitesContext["actor"];
}) {
  const conversationAgent = useAgent<SigveloManagerConversationAgent, ManagerConversationState>({
    agent: MANAGER_CONVERSATION_AGENT_NAME,
    name: `${managerName}:manager:${actor.id}`,
  });

  return (
    <NaniteInfoRail label="Manager details">
      <InfoSection title="Manager" className="nanites-workspace__info-section--about">
        <div className="nanites-workspace__info-about">
          <strong>Configuration manager</strong>
          <p>Runs the conversation that creates and updates your Nanites.</p>
        </div>
      </InfoSection>

      <ModelSelect
        ariaLabel="Manager model"
        // Once state syncs, an unset model means the agent runs on the default
        // (getModel falls back to it) — show that rather than disabling the picker.
        currentModel={
          conversationAgent.state
            ? (conversationAgent.state.model ?? DEFAULT_SIGVELO_AGENT_MODEL_ID)
            : null
        }
        onSelectModel={(modelId) => conversationAgent.stub.setModel(modelId)}
      />
    </NaniteInfoRail>
  );
}

function NaniteRunInfoPanel({
  activeInstallation,
  deleteError,
  githubAppSlug,
  isDeleting,
  nanite,
  onDeleteNanite,
  onSetNaniteModel,
  run,
}: {
  readonly activeInstallation: SessionInstallationSnapshot;
  readonly deleteError: unknown;
  readonly githubAppSlug: string | null;
  readonly isDeleting: boolean;
  readonly nanite: ManagedNanite | null;
  readonly onDeleteNanite: () => void;
  readonly onSetNaniteModel: (modelId: string) => Promise<unknown>;
  readonly run: NaniteRunRecord | null;
}) {
  const [confirmingDeleteNaniteId, setConfirmingDeleteNaniteId] = useState<string | null>(null);
  const isConfirmingDelete = confirmingDeleteNaniteId === nanite?.manifest.id;
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
  const eventSource = nanite?.manifest.eventSource ?? null;
  const triggerSpec = eventSource ? formatEventSourceSpec(eventSource) : "manual";
  const manageAccessHref = buildGitHubAppInstallHref({
    appSlug: githubAppSlug,
    suggestedTargetId: activeInstallation.account.id,
  });
  const triggerLabel = run ? formatTriggerEvent(run.trigger) : nanite ? triggerSpec : "No trigger";
  const runSummary =
    run && run.status !== "running" && run.status !== "waiting_for_manager" ? run.summary : null;
  const runManagerRequest = run?.status === "waiting_for_manager" ? run.managerRequest : null;
  const runOutputUrl = run?.status === "complete" ? run.outputUrl : null;
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
        eventSource?.type === "manual" || !eventSource
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
    run || nanite
      ? {
          key: "trigger",
          label: "Trigger",
          value: triggerLabel,
        }
      : null,
    runSummary
      ? {
          key: "summary",
          label: "Summary",
          value: runSummary,
        }
      : null,
    runManagerRequest
      ? {
          key: "waiting",
          label: "Waiting",
          value: runManagerRequest.request,
        }
      : null,
  ].filter((row) => row !== null);

  return (
    <NaniteInfoRail label="Run details">
      {nanite ? (
        <InfoSection title="Nanite" className="nanites-workspace__info-section--about">
          <div className="nanites-workspace__info-about">
            <strong>{nanite.manifest.name}</strong>
            <p>{nanite.manifest.description}</p>
          </div>
          <div className="nanites-workspace__danger-zone">
            <Button
              variant="ghost"
              color="destructive"
              className="nanites-workspace__danger-action"
              data-confirming={isConfirmingDelete ? "true" : undefined}
              disabled={isDeleting}
              onClick={() => {
                if (!isConfirmingDelete) {
                  setConfirmingDeleteNaniteId(nanite.manifest.id);
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
            </Button>
            {isConfirmingDelete && !isDeleting ? (
              <Button
                variant="ghost"
                color="neutral"
                className="nanites-workspace__danger-cancel"
                onClick={() => setConfirmingDeleteNaniteId(null)}
              >
                Cancel
              </Button>
            ) : null}
          </div>
          {deleteError ? (
            <p className="nanites-workspace__delete-error" role="alert">
              {getErrorMessage(deleteError)}
            </p>
          ) : null}
        </InfoSection>
      ) : null}

      {nanite ? (
        <ModelSelect
          ariaLabel="Nanite model"
          currentModel={nanite.manifest.model}
          onSelectModel={onSetNaniteModel}
        />
      ) : null}

      {gitInfoLinks.length > 0 ? (
        <InfoSection title="Git" collapsible={false}>
          <ul className="nanites-workspace__info-link-list">
            {gitInfoLinks.map((link) => (
              <li key={link.key}>
                <a
                  className="nanites-workspace__info-row"
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>
                    {link.icon}
                    {link.label}
                  </span>
                  <span>{link.value}</span>
                  <ArrowSquareOutIcon size={13} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </InfoSection>
      ) : null}

      <InfoSection title="Scope" collapsible={false}>
        <div className="nanites-workspace__info-link-list">
          {scopeRows.map((row) => (
            <InfoPanelRow key={row.key} row={row} />
          ))}
        </div>
      </InfoSection>

      {outcomeRows.length > 0 ? (
        <InfoSection title="Run" collapsible={false}>
          <dl className="nanites-workspace__outcome-list">
            {outcomeRows.map((row) => (
              <div key={row.key}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
            {runOutputUrl ? (
              <div>
                <dt>Output</dt>
                <dd>
                  <a href={runOutputUrl} target="_blank" rel="noreferrer">
                    Open
                    <span className="visually-hidden"> run output</span>
                    <ArrowSquareOutIcon size={12} aria-hidden="true" />
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        </InfoSection>
      ) : null}
    </NaniteInfoRail>
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

const naniteWorkspaceFallbackRootPath = "/";
const naniteDefinitionRootPath = "/nanite";
const naniteWorkspaceDirectoryLimit = 1_000;
const naniteWorkspaceFilePreviewMaxBytes = 1_000_000;
const emptyLoadedDirectories = new Set<string>();

function resolveWorkspaceRoot(info: NaniteWorkspaceInfo | null): string {
  return info?.repositoryRoot ?? naniteWorkspaceFallbackRootPath;
}

function stripWorkspaceRootPrefix(path: string, root: string): string {
  if (path === root) {
    return "";
  }
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

type NaniteWorkspaceReviewFile = {
  readonly path: string;
  readonly name: string;
  readonly content: string;
  readonly error: string | null;
  readonly truncated: boolean;
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
      error: null,
      truncated: false,
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
      error: null,
      truncated: false,
      additions: 0,
      deletions: 0,
    },
  ];

  // Surface the generated trigger as its own .ts file so it reads as code, not buried JSON.
  if (nanite.manifest.triggerSource) {
    files.push({
      path: "/nanite/trigger.ts",
      name: "trigger.ts",
      content: nanite.manifest.triggerSource,
      error: null,
      truncated: false,
      additions: 0,
      deletions: 0,
    });
  }

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
  agent,
  nanite,
  naniteId,
  refreshKey,
}: {
  readonly agent: NaniteAgentInstance | null;
  readonly nanite: ManagedNanite | null;
  readonly naniteId: string | null;
  readonly refreshKey: string;
}) {
  if (!naniteId) {
    return (
      <div className="nanites-workspace__workbench app__pane">
        <div className="nanites-workspace__files-header">
          <span>Workspace</span>
        </div>
        <p className="nanites-workspace__files-empty">Select a Nanite to inspect its workspace.</p>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="nanites-workspace__workbench app__pane">
          <div className="nanites-workspace__files-header">
            <span>Workspace</span>
          </div>
          <p className="nanites-workspace__files-empty">Loading workspace...</p>
        </div>
      }
    >
      <NaniteWorkspaceReview key={naniteId} agent={agent} nanite={nanite} refreshKey={refreshKey} />
    </Suspense>
  );
}

function NaniteWorkspaceReview({
  agent: naniteAgent,
  nanite,
  refreshKey,
}: {
  readonly agent: NaniteAgentInstance | null;
  readonly nanite: ManagedNanite | null;
  readonly refreshKey: string;
}) {
  const [files, setFiles] = useState<readonly NaniteWorkspaceReviewFile[]>([]);
  const [entriesByDirectory, setEntriesByDirectory] = useState<
    Record<string, readonly NaniteWorkspaceTreeEntry[]>
  >({});
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [workspaceView, setWorkspaceView] = useState<"explorer" | "preview">("explorer");
  const [info, setInfo] = useState<NaniteWorkspaceInfo | null>(null);
  const [fileFilter, setFileFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingDirectories, setLoadingDirectories] = useState<ReadonlySet<string>>(new Set());
  const [loadingFilePath, setLoadingFilePath] = useState<string | null>(null);
  const [copiedFile, setCopiedFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedDirectoriesRef = useRef<ReadonlySet<string>>(emptyLoadedDirectories);

  const workspaceRoot = resolveWorkspaceRoot(info);
  const workspaceFilter = fileFilter.trim().toLowerCase();

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

      if (!naniteAgent) return;
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
    [naniteAgent],
  );

  const loadFile = useCallback(
    async (path: string, { force = false }: { readonly force?: boolean } = {}) => {
      const definitionFile = definitionFilesByPath.get(path);
      if (definitionFile) {
        setFiles((current) => {
          const withoutCurrent = current.filter((file) => file.path !== path);
          return [...withoutCurrent, definitionFile];
        });
        return;
      }

      if (!force && filesByPath.has(path)) {
        return;
      }

      if (!naniteAgent) return;
      setLoadingFilePath(path);
      setError(null);
      try {
        const output = await naniteAgent.stub.exploreWorkspace({
          action: "read",
          path,
          maxBytes: naniteWorkspaceFilePreviewMaxBytes,
        });
        const content = output.action === "read" ? (output.content ?? "") : "";
        setFiles((current) => {
          const withoutCurrent = current.filter((file) => file.path !== path);
          return [
            ...withoutCurrent,
            {
              path,
              name: path.split("/").filter(Boolean).at(-1) ?? path,
              content,
              error: null,
              truncated: output.action === "read" && output.truncated,
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
              content: "",
              error: readError instanceof Error ? readError.message : String(readError),
              truncated: false,
              additions: 0,
              deletions: 0,
            },
          ];
        });
      } finally {
        setLoadingFilePath((current) => (current === path ? null : current));
      }
    },
    [definitionFilesByPath, filesByPath, naniteAgent],
  );

  const loadWorkspaceRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFiles(definitionFiles);
    setEntriesByDirectory({});
    loadedDirectoriesRef.current = new Set([naniteDefinitionRootPath]);
    try {
      if (!naniteAgent) throw new Error("No agent connection");
      const nextInfo = await naniteAgent.stub.getWorkspaceInfo();
      setInfo(nextInfo);
      await loadDirectory(resolveWorkspaceRoot(nextInfo), { force: true });
    } catch (loadError) {
      setEntriesByDirectory({});
      loadedDirectoriesRef.current = new Set([naniteDefinitionRootPath]);
      setInfo(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [definitionFiles, loadDirectory, naniteAgent]);

  const refresh = useCallback(() => {
    void (async () => {
      if (selectedPath && !definitionFilesByPath.has(selectedPath)) {
        setLoadingFilePath(selectedPath);
      }
      await loadWorkspaceRoot();
      await Promise.all([...expandedPaths].map((path) => loadDirectory(path, { force: true })));
      if (selectedPath) {
        await loadFile(selectedPath, { force: true });
      }
    })();
  }, [
    definitionFilesByPath,
    expandedPaths,
    loadDirectory,
    loadFile,
    loadWorkspaceRoot,
    selectedPath,
  ]);

  useEffect(() => {
    void loadWorkspaceRoot();
  }, [loadWorkspaceRoot, refreshKey]);

  const loadedFileEntries = useMemo(() => {
    const entries = Object.values(entriesByDirectory).flat();
    return entries.filter((entry) => entry.type !== "directory");
  }, [entriesByDirectory]);
  const filteredFileEntries = useMemo(() => {
    if (!workspaceFilter) {
      return loadedFileEntries;
    }
    return uniqueWorkspaceEntries(
      loadedFileEntries.filter((entry) => entry.path.toLowerCase().includes(workspaceFilter)),
    );
  }, [loadedFileEntries, workspaceFilter]);
  const selectedFile = selectedPath ? (filesByPath.get(selectedPath) ?? null) : null;
  const selectedFileIsLoading = selectedPath !== null && loadingFilePath === selectedPath;
  const hasWorkspaceEntries =
    (entriesByDirectory[workspaceRoot]?.length ?? 0) > 0 || definitionFiles.length > 0;
  const visibleTreeEntries = useMemo(
    () => (workspaceFilter ? filteredFileEntries : (entriesByDirectory[workspaceRoot] ?? [])),
    [entriesByDirectory, filteredFileEntries, workspaceFilter, workspaceRoot],
  );

  const handleSelectFile = useCallback(
    (path: string) => {
      setCopiedFile(false);
      setSelectedPath(path);
      setWorkspaceView("preview");
      void loadFile(path);
    },
    [loadFile],
  );

  const handleExpandedChange = useCallback(
    (next: Set<string>) => {
      setExpandedPaths(next);

      for (const path of next) {
        if (path === naniteDefinitionRootPath || expandedPaths.has(path)) {
          continue;
        }
        void loadDirectory(path);
      }
    },
    [expandedPaths, loadDirectory],
  );

  const renderWorkspaceEntry = (entry: NaniteWorkspaceTreeEntry): ReactNode => {
    if (entry.type === "directory") {
      const childEntries = entriesByDirectory[entry.path] ?? [];
      return (
        <FileTreeFolder key={entry.path} path={entry.path} name={entry.name}>
          {childEntries.map(renderWorkspaceEntry)}
        </FileTreeFolder>
      );
    }

    return <FileTreeFile key={entry.path} path={entry.path} name={entry.name} />;
  };

  const definitionEntries = useMemo(() => {
    const filter = fileFilter.trim().toLowerCase();
    if (!filter) return definitionFiles;
    return definitionFiles.filter((file) => file.path.toLowerCase().includes(filter));
  }, [definitionFiles, fileFilter]);

  const selectedPathLabel = selectedPath
    ? selectedPath.startsWith(`${naniteDefinitionRootPath}/`)
      ? `Nanite definition / ${selectedPath.slice(naniteDefinitionRootPath.length + 1)}`
      : stripWorkspaceRootPrefix(selectedPath, workspaceRoot)
    : "";

  const copySelectedFile = useCallback(async () => {
    if (!selectedFile) return;
    try {
      await navigator.clipboard.writeText(selectedFile.content);
      setCopiedFile(true);
    } catch {
      /* ignore */
    }
  }, [selectedFile]);

  return (
    <div className="nanites-workspace__workbench app__pane">
      <div className="app__workbench-shell">
        <div className="app__workbench-heading">
          <div className="nanites-workspace__review-title">
            <span>Workspace</span>
            {info ? (
              <span className="nanites-workspace__file-count">
                {info.fileCount.toLocaleString()} files
              </span>
            ) : null}
          </div>
          <div className="app__workbench-actions">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    color="neutral"
                    size="sm"
                    onClick={refresh}
                    disabled={loading}
                    aria-label="Refresh workspace"
                  >
                    <ArrowClockwiseIcon size={14} aria-hidden="true" />
                  </Button>
                }
              />
              <TooltipPortal>
                <TooltipPositioner side="bottom" sideOffset={6}>
                  <TooltipPopup>Refresh workspace</TooltipPopup>
                </TooltipPositioner>
              </TooltipPortal>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="app__workbench-content">
        <div className="app__workbench-panel">
          {error ? <div className="app__workspace-empty">{error}</div> : null}
          {!error && hasWorkspaceEntries ? (
            workspaceView === "preview" && selectedPath ? (
              <div className="nanites-workspace__review-file">
                <div className="nanites-workspace__review-file-header">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          color="neutral"
                          size="sm"
                          onClick={() => setWorkspaceView("explorer")}
                          aria-label="Back to files"
                        >
                          <ArrowLeftIcon size={14} aria-hidden="true" />
                        </Button>
                      }
                    />
                    <TooltipPortal>
                      <TooltipPositioner side="bottom" sideOffset={6}>
                        <TooltipPopup>Back to files</TooltipPopup>
                      </TooltipPositioner>
                    </TooltipPortal>
                  </Tooltip>
                  <span className="app__preview-url-text">{selectedPathLabel}</span>
                  {selectedFile ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant="ghost"
                            color="neutral"
                            size="sm"
                            onClick={() => void copySelectedFile()}
                            aria-label={copiedFile ? "Copied file contents" : "Copy file contents"}
                          >
                            {copiedFile ? <CheckIcon /> : <CopyIcon />}
                          </Button>
                        }
                      />
                      <TooltipPortal>
                        <TooltipPositioner side="bottom" sideOffset={6}>
                          <TooltipPopup>
                            {copiedFile ? "Copied" : "Copy file contents"}
                          </TooltipPopup>
                        </TooltipPositioner>
                      </TooltipPortal>
                    </Tooltip>
                  ) : null}
                </div>
                <div className="app__workspace-code-pane">
                  {selectedFileIsLoading ? (
                    <div className="app__workspace-empty">Loading file...</div>
                  ) : selectedFile?.error ? (
                    <div className="app__workspace-empty" role="alert">
                      Could not preview this file: {selectedFile.error}
                    </div>
                  ) : selectedFile && selectedFile.content.length === 0 ? (
                    <div className="app__workspace-empty">This file is empty.</div>
                  ) : selectedFile ? (
                    <div className="app__workspace-code-shell">
                      {selectedFile.truncated ? (
                        <div className="nanites-workspace__preview-notice">
                          Preview truncated at {naniteWorkspaceFilePreviewMaxBytes.toLocaleString()}{" "}
                          bytes.
                        </div>
                      ) : null}
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
                    <div className="app__workspace-empty">File preview is unavailable.</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="nanites-workspace__review-tree">
                <search>
                  <label
                    className="nanites-workspace__review-filter"
                    htmlFor="workspace-file-filter"
                  >
                    <span className="visually-hidden" id="workspace-file-filter-label">
                      Filter workspace files
                    </span>
                    <MagnifyingGlassIcon size={13} aria-hidden="true" />
                    <input
                      id="workspace-file-filter"
                      type="search"
                      name="workspaceFileFilter"
                      value={fileFilter}
                      onChange={(event) => setFileFilter(event.currentTarget.value)}
                      placeholder="Filter files..."
                      aria-labelledby="workspace-file-filter-label"
                      autoComplete="off"
                      enterKeyHint="search"
                    />
                  </label>
                </search>
                <div className="app__workspace-body app__workspace-body--tree">
                  {definitionEntries.length > 0 ? (
                    <section className="nanites-workspace__explorer-group">
                      <h2>Nanite definition</h2>
                      <FileTree
                        className="app__workspace-tree"
                        selectedPath={selectedPath}
                        onSelect={handleSelectFile}
                        aria-label="Nanite definition files"
                      >
                        {definitionEntries.map((file) => (
                          <FileTreeFile key={file.path} path={file.path} name={file.name} />
                        ))}
                      </FileTree>
                    </section>
                  ) : null}

                  {visibleTreeEntries.length > 0 ? (
                    <section className="nanites-workspace__explorer-group">
                      <h2>Project files</h2>
                      <FileTree
                        className="app__workspace-tree"
                        expanded={new Set(expandedPaths)}
                        selectedPath={selectedPath}
                        onExpandedChange={handleExpandedChange}
                        onSelect={handleSelectFile}
                        aria-label="Project files"
                      >
                        {fileFilter.trim()
                          ? filteredFileEntries.map((entry) => (
                              <FileTreeFile
                                key={entry.path}
                                path={entry.path}
                                name={stripWorkspaceRootPrefix(entry.path, workspaceRoot)}
                              />
                            ))
                          : visibleTreeEntries.map(renderWorkspaceEntry)}
                      </FileTree>
                    </section>
                  ) : null}

                  {definitionEntries.length === 0 && visibleTreeEntries.length === 0 ? (
                    <div className="app__workspace-empty">
                      {loading || loadingDirectories.size > 0
                        ? "Loading workspace..."
                        : "No matching files"}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          ) : null}
          {!error && !hasWorkspaceEntries ? (
            <div className="app__workspace-empty">
              {loading ? "Loading workspace..." : "No workspace files"}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NanitesRoute() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const { data: session, isPending } = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: fetchOptionalSession,
  });
  const actor = session?.actor ?? null;
  const githubApp = session?.githubApp ?? null;
  const activeInstallation = session?.activeInstallation ?? null;

  if (isPending) {
    return <RoutePendingPage />;
  }

  if (!activeInstallation || !actor) {
    return <GitHubInstallRequiredState githubApp={githubApp} />;
  }

  const managerName = activeInstallation.managerName;

  return (
    <NanitesRuntimeSurface
      actor={actor}
      activeInstallation={activeInstallation}
      githubApp={githubApp}
      managerName={managerName}
      selectedMode={search.mode === "create" ? "create" : null}
      selectedNaniteId={search.naniteId ?? null}
      selectedRunId={search.runId ?? null}
      setSelection={(selection) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            mode: "mode" in selection ? selection.mode : undefined,
            naniteId: "naniteId" in selection ? selection.naniteId : undefined,
            runId: undefined,
          }),
          replace: true,
        })
      }
    />
  );
}

function NaniteAgentConnection({
  children,
  managerName,
  naniteId,
}: {
  readonly children: (agent: NaniteAgentInstance) => ReactNode;
  readonly managerName: NaniteManagerKey;
  readonly naniteId: string;
}) {
  const naniteAgent = useAgent<SigveloNaniteAgent, NaniteAgentState>({
    agent: NANITE_AGENT_NAME,
    name: buildNaniteAgentName({ managerName, naniteId }),
  });

  return children(naniteAgent);
}

function NanitesRuntimeSurface({
  activeInstallation,
  actor,
  githubApp,
  managerName,
  selectedMode,
  selectedNaniteId,
  selectedRunId,
  setSelection,
}: {
  readonly activeInstallation: SessionInstallationSnapshot;
  readonly actor: BrowserNanitesContext["actor"];
  readonly githubApp: BrowserDeploymentGitHubApp | null;
  readonly managerName: NaniteManagerKey;
  readonly selectedMode: "create" | null;
  readonly selectedNaniteId: string | null;
  readonly selectedRunId: string | null;
  readonly setSelection: (selection: NanitesSelection) => void;
}) {
  const navigate = Route.useNavigate();
  const [mobileView, setMobileView] = useState<NaniteMobileView>("chat");
  const [desktopPanel, setDesktopPanel] = useState<NaniteDesktopPanel>("summary");
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [asideWidth, setAsideWidth] = useState(340);
  const mobileTouchStartRef = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const { data: managerStateData, refetch: refetchManagerState } = useQuery({
    queryKey: ["nanites", "manager", managerName],
    queryFn: () => fetchManagerState(managerName),
    throwOnError: true,
  });
  const manager = useAgent<SigveloNaniteManager, NaniteManagerState>({
    agent: NANITE_MANAGER_NAME,
    name: managerName,
  });
  const initialState = isNaniteManagerState(managerStateData?.state)
    ? managerStateData.state
    : emptyState;
  const state = pickManagerState({
    initialState,
    liveState: manager.state,
  });
  const toggleGroupCollapsed = (repository: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(repository)) {
        next.delete(repository);
      } else {
        next.add(repository);
      }
      return next;
    });
  };
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
  const selectedNaniteItem = selectedNaniteId
    ? naniteItems.find((item) => item.id === selectedNaniteId)
    : undefined;
  const isCreateMode = selectedMode === "create" || selectedNaniteId === null;
  const activeNaniteItem = isCreateMode ? null : (selectedNaniteItem ?? null);
  const selectedNaniteRuns = activeNaniteItem ? (runsByNanite.get(activeNaniteItem.id) ?? []) : [];
  const selectedRun =
    (selectedRunId ? selectedNaniteRuns.find((run) => run.runId === selectedRunId) : undefined) ??
    selectedNaniteRuns[0] ??
    null;
  const selectedNanite = activeNaniteItem?.nanite ?? null;
  const selectedNaniteAgentId = activeNaniteItem?.id ?? null;
  const visibleMobileViews = selectedNaniteAgentId ? naniteMobileViews : managerMobileViews;
  const activeMobileView = visibleMobileViews.includes(mobileView) ? mobileView : "chat";
  // Create mode (the manager) has no file explorer, but it shares the summary
  // panel — that's where the manager card lives, mirroring the Nanite layout.
  const effectiveDesktopPanel =
    isCreateMode || !selectedNaniteAgentId
      ? desktopPanel === "summary"
        ? "summary"
        : null
      : desktopPanel;
  const isFileViewOpen = effectiveDesktopPanel === "files" || activeMobileView === "files";
  const deleteNanite = useMutation({
    mutationFn: async (input: { readonly naniteId: string }) => {
      const output = (await manager.stub.deprovisionNanite({
        naniteId: input.naniteId,
        reason: `Deleted from the Nanites UI for ${activeInstallation.account.login}.`,
        actor: {
          kind: "github_user",
          source: "browser",
          githubUserId: actor.id,
          githubLogin: actor.login,
          actorId: `github:${actor.id}`,
          actorLogin: actor.login,
        },
      })) as DeprovisionNaniteOutput;
      if (output.deprovisionedNaniteId !== input.naniteId) {
        const skipped = output.skippedNanite;
        throw new Error(skipped ? `Delete skipped: ${skipped.reason}.` : "Delete did not apply.");
      }
      return output;
    },
    onSuccess: async () => {
      await refetchManagerState();
      await navigate({
        search: (previous) => ({
          ...previous,
          mode: undefined,
          naniteId: undefined,
          runId: undefined,
        }),
        replace: true,
      });
      setMobileView("chat");
    },
  });
  const moveMobileView = (direction: 1 | -1) => {
    const currentIndex = visibleMobileViews.indexOf(activeMobileView);
    const nextIndex = Math.min(
      visibleMobileViews.length - 1,
      Math.max(0, currentIndex + direction),
    );
    const nextView = visibleMobileViews[nextIndex];
    if (nextView) {
      setMobileView(nextView);
    }
  };

  const renderMain = (naniteAgent: NaniteAgentInstance | null) => (
    <main
      className="nanites-workspace"
      data-desktop-panel={effectiveDesktopPanel ?? "closed"}
      data-sidebar-open={isSidebarOpen}
      data-mobile-view={activeMobileView}
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
      {isSidebarOpen ? (
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
      ) : null}
      {effectiveDesktopPanel === "files" ? (
        <button
          type="button"
          className="nanites-workspace__resizer nanites-workspace__resizer--aside"
          style={{ insetInlineEnd: `${asideWidth}px` }}
          aria-label="Resize side panel"
          onPointerDown={(event) =>
            beginColumnResize(event, {
              current: asideWidth,
              min: 300,
              max: 600,
              grow: -1,
              apply: setAsideWidth,
            })
          }
        />
      ) : null}

      <header className="nanites-workspace__toolbar">
        <div className="nanites-workspace__toolbar-start">
          <div className="nanites-workspace__panel-toggle nanites-workspace__panel-toggle--sidebar">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    color="neutral"
                    size="icon"
                    aria-label={isSidebarOpen ? "Hide Nanites sidebar" : "Show Nanites sidebar"}
                    aria-pressed={isSidebarOpen}
                    data-selected={isSidebarOpen}
                    onClick={() => setIsSidebarOpen((current) => !current)}
                  >
                    <SidebarSimpleIcon size={14} aria-hidden="true" />
                  </Button>
                }
              />
              <TooltipPortal>
                <TooltipPositioner side="bottom" sideOffset={6}>
                  <TooltipPopup>
                    {isSidebarOpen ? "Hide Nanites sidebar" : "Show Nanites sidebar"}
                  </TooltipPopup>
                </TooltipPositioner>
              </TooltipPortal>
            </Tooltip>
          </div>
          <h1 className="nanites-workspace__toolbar-title">Nanites</h1>
        </div>
        <div className="nanites-workspace__toolbar-actions">
          <NaniteDesktopPanelControls
            activePanel={effectiveDesktopPanel}
            showFiles={selectedNaniteAgentId !== null}
            onToggle={(panel) =>
              setDesktopPanel((current) => getNextNaniteDesktopPanel(current, panel))
            }
          />
        </div>
      </header>

      <aside className="nanites-workspace__sidebar app__pane" aria-label="Nanites">
        <div className="nanites-workspace__masthead">
          <div className="app__brand">
            <AccountMenu activeInstallation={activeInstallation} githubApp={githubApp} />
          </div>
          <div className="nanites-workspace__masthead-actions">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Link
                    className="nanites-workspace__nav-link"
                    to="/observability"
                    search={{
                      range: "7d",
                    }}
                    aria-label="Open observability"
                  >
                    <ChartBarIcon size={14} aria-hidden="true" />
                  </Link>
                }
              />
              <TooltipPortal>
                <TooltipPositioner side="bottom" sideOffset={6}>
                  <TooltipPopup>Open observability</TooltipPopup>
                </TooltipPositioner>
              </TooltipPortal>
            </Tooltip>
            <span className="nanites-workspace__count">{naniteItems.length}</span>
          </div>
        </div>

        <ul className="nanites-workspace__list">
          {naniteGroups.length > 0 ? (
            naniteGroups.map((group) => {
              const groupLabel = formatRepositoryGroupLabel(
                group.repository,
                activeInstallation.account.login,
              );
              const isCollapsed = collapsedGroups.has(group.repository);

              return (
                <li
                  className="nanites-workspace__group"
                  data-collapsed={isCollapsed || undefined}
                  key={group.repository}
                >
                  <Button
                    variant="ghost"
                    color="neutral"
                    className="nanites-workspace__group-header"
                    onClick={() => toggleGroupCollapsed(group.repository)}
                    aria-expanded={!isCollapsed}
                  >
                    <CaretDownIcon
                      className="nanites-workspace__group-caret"
                      size={12}
                      weight="bold"
                      aria-hidden="true"
                    />
                    <span className="nanites-workspace__group-title">
                      <FolderSimpleIcon size={15} aria-hidden="true" />
                      <span>{groupLabel}</span>
                    </span>
                    <span>{group.items.length}</span>
                  </Button>
                  <ul className="nanites-workspace__items" hidden={isCollapsed || undefined}>
                    {group.items.map((item) => (
                      <li key={`${group.repository}:${item.id}`}>
                        <Button
                          variant="ghost"
                          color="neutral"
                          className="nanites-workspace__item"
                          data-selected={!isCreateMode && item.id === activeNaniteItem?.id}
                          onClick={() => {
                            setSelection({ naniteId: item.id });
                            setMobileView("chat");
                          }}
                          type="button"
                        >
                          <span
                            className="nanites-workspace__source-icon"
                            data-tone={
                              item.latestRun ? getRunStatusTone(item.latestRun.status) : "idle"
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
                        </Button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })
          ) : (
            <li>
              <p className="nanites-workspace__empty">
                No Nanites are configured for this installation yet.
              </p>
            </li>
          )}
        </ul>

        <div className="nanites-workspace__create-action">
          <AgentConnectionPopover />
          <Button
            type="button"
            className="nanites-workspace__create-button"
            color="primary"
            size="sm"
            variant="normal"
            onClick={() => {
              setSelection({ mode: "create" });
              setMobileView("chat");
            }}
          >
            <span>{isCreateMode ? "Configuring Nanites..." : "Configure Nanites"}</span>
          </Button>
        </div>
      </aside>

      <div className="nanites-workspace__runtime app__pane--chat">
        <div className="nanites-workspace__runtime-body">
          <div className="nanites-workspace__chat">
            {isCreateMode ? (
              <Suspense
                fallback={
                  <NaniteRuntimeChatLoading
                    description={`Connecting the configuration agent for ${activeInstallation.account.login}. You’ll be able to describe how you want Nanites configured here in a moment.`}
                    title={`Preparing configuration for ${activeInstallation.account.login}`}
                  />
                }
              >
                <ManagerRuntimeChatConnector
                  accountLogin={activeInstallation.account.login}
                  actor={actor}
                  emptyDescription="Start with a focused web-maintenance Nanite, or describe another responsibility."
                  emptyTitle="Configure Nanites"
                  errorDescription="The Nanite configuration conversation could not connect."
                  loadingDescription={`Connecting the configuration agent for ${activeInstallation.account.login}. You’ll be able to describe how you want Nanites configured here in a moment.`}
                  loadingTitle={`Preparing configuration for ${activeInstallation.account.login}`}
                  managerName={managerName}
                  placeholder="Ask the manager to create or tune a Nanite"
                />
              </Suspense>
            ) : selectedNaniteAgentId ? (
              <Suspense
                fallback={
                  <NaniteRuntimeChatLoading
                    description={
                      selectedNanite
                        ? `Loading ${selectedNanite.manifest.name} so its transcript, tools, and workspace context are ready here.`
                        : "Loading the selected Nanite so its transcript, tools, and workspace context are ready here."
                    }
                    title={
                      selectedNanite
                        ? `Opening ${selectedNanite.manifest.name}`
                        : "Preparing the selected Nanite"
                    }
                  />
                }
              >
                {naniteAgent ? (
                  <NaniteRuntimeChatConnector
                    key={`${managerName}:${selectedNaniteAgentId}`}
                    agent={naniteAgent}
                  />
                ) : (
                  <NaniteRuntimeChatLoading
                    description="Waiting for the selected Nanite connection to initialize."
                    title="Loading selected Nanite"
                  />
                )}
              </Suspense>
            ) : (
              <NaniteRuntimeChatLoading
                description="Waiting for the selected Nanite to appear in the manager state."
                title="Loading selected Nanite"
              />
            )}
          </div>
        </div>
      </div>

      <div
        className="nanites-workspace__summary-layer"
        data-open={effectiveDesktopPanel === "summary"}
      >
        <div className="nanites-workspace__summary-card">
          {isCreateMode ? (
            <NaniteManagerInfoPanel managerName={managerName} actor={actor} />
          ) : selectedNaniteAgentId ? (
            <NaniteRunInfoPanel
              activeInstallation={activeInstallation}
              deleteError={deleteNanite.error}
              githubAppSlug={githubApp?.slug ?? null}
              isDeleting={deleteNanite.isPending}
              nanite={selectedNanite}
              onDeleteNanite={() => {
                if (!selectedNaniteAgentId) {
                  return;
                }

                deleteNanite.mutate({ naniteId: selectedNaniteAgentId });
              }}
              onSetNaniteModel={async (modelId) => {
                if (!selectedNaniteAgentId) {
                  return;
                }

                await manager.stub.setNaniteModel({
                  naniteId: selectedNaniteAgentId,
                  modelId,
                  actor: {
                    kind: "github_user",
                    source: "browser",
                    githubUserId: actor.id,
                    githubLogin: actor.login,
                    actorId: `github:${actor.id}`,
                    actorLogin: actor.login,
                  },
                });
              }}
              run={selectedRun}
            />
          ) : (
            <RoutePendingPage
              title="Loading selected Nanite"
              description="Waiting for the selected Nanite to appear in the manager state."
            />
          )}
        </div>
      </div>

      {selectedNaniteAgentId ? (
        <aside
          className="nanites-workspace__aside"
          data-open={effectiveDesktopPanel === "files"}
          aria-label="File explorer"
        >
          <div className="nanites-workspace__files-slot">
            {isFileViewOpen ? (
              <NaniteWorkspacePanel
                agent={naniteAgent}
                nanite={selectedNanite}
                naniteId={selectedNaniteAgentId}
                refreshKey={`${selectedRun?.runId ?? "no-run"}:${selectedRun?.updatedAt ?? "no-update"}`}
              />
            ) : null}
          </div>
        </aside>
      ) : null}

      <nav
        className="nanites-workspace__mobile-nav"
        aria-label="Nanite workspace views"
        style={
          {
            "--nanites-mobile-nav-count": String(visibleMobileViews.length),
          } as CSSProperties
        }
      >
        <Button
          variant="ghost"
          color="neutral"
          data-selected={activeMobileView === "nanites"}
          aria-current={activeMobileView === "nanites" ? "true" : undefined}
          onClick={() => setMobileView("nanites")}
        >
          <FolderSimpleIcon size={18} aria-hidden="true" />
          <span>Nanites</span>
        </Button>
        <Button
          variant="ghost"
          color="neutral"
          data-selected={activeMobileView === "chat"}
          aria-current={activeMobileView === "chat" ? "true" : undefined}
          onClick={() => setMobileView("chat")}
        >
          <ChatCircleTextIcon size={18} aria-hidden="true" />
          <span>Chat</span>
        </Button>
        {selectedNaniteAgentId ? (
          <Button
            variant="ghost"
            color="neutral"
            data-selected={activeMobileView === "files"}
            aria-current={activeMobileView === "files" ? "true" : undefined}
            onClick={() => setMobileView("files")}
          >
            <FileIcon size={18} aria-hidden="true" />
            <span>Files</span>
          </Button>
        ) : null}
        {selectedNaniteAgentId ? (
          <Button
            variant="ghost"
            color="neutral"
            data-selected={activeMobileView === "summary"}
            aria-current={activeMobileView === "summary" ? "true" : undefined}
            onClick={() => setMobileView("summary")}
          >
            <SlidersHorizontalIcon size={18} aria-hidden="true" />
            <span>Summary</span>
          </Button>
        ) : null}
      </nav>
    </main>
  );

  if (selectedNaniteAgentId) {
    return (
      <NaniteAgentConnection
        key={`${managerName}:${selectedNaniteAgentId}`}
        managerName={managerName}
        naniteId={selectedNaniteAgentId}
      >
        {(naniteAgent) => renderMain(naniteAgent)}
      </NaniteAgentConnection>
    );
  }

  return renderMain(null);
}
