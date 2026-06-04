import type { NaniteManifest, NaniteTriggerEvent } from "#/backend/agents/SigveloNaniteManager.ts";
import type { TriggerDispatchInput } from "#/backend/nanites/triggers.ts";
import { getGitHubWebhookHeadSha, getGitHubWebhookRepositoryFullName } from "#/github.ts";

const GITHUB_REST_API_BASE_URL = "https://api.github.com";
const GITHUB_REST_API_ACCEPT_HEADER = "application/vnd.github+json";
const GITHUB_REST_API_VERSION = "2026-03-10";
const GITHUB_API_TIMEOUT_MS = 10_000;

const HYDRATION_ROOT_FILES = ["AGENTS.md", "CLAUDE.md", "README.md", "package.json"] as const;
const HYDRATION_MAX_PATHS = 100;

type GitHubContentFile = {
  type: "file";
  sha: string;
  content: string;
};

export type RepositoryHydrationPlan = {
  repository: string;
  ref: string;
  destination: string;
  paths: string[];
  reason: string;
};

export type RepositoryHydrationResult = {
  repository: string;
  ref: string;
  destination: string;
  metadataPath: string;
  writtenFiles: Array<{ path: string; sha: string | null; size: number }>;
  missingFiles: string[];
};

export type RepositoryHydrationWorkspace = {
  writeFile(path: string, content: string, mimeType?: string): Promise<void>;
  writeFileBytes(path: string, content: Uint8Array, mimeType?: string): Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readInputString(input: TriggerDispatchInput | undefined, key: string): string | null {
  const value = input?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readInputStringArray(input: TriggerDispatchInput | undefined, key: string): string[] {
  const value = input?.[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeRepositoryPath(path: string): string | null {
  const trimmed = path.trim().replace(/^\/+/, "");
  if (!trimmed || trimmed.includes("\\")) {
    return null;
  }

  const segments = trimmed.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }

  return segments.join("/");
}

function normalizeWorkspaceDirectory(path: string): string | null {
  const normalized = normalizeRepositoryPath(path);
  return normalized ? `/${normalized}` : null;
}

function isAllZeroSha(value: string): boolean {
  return /^0+$/.test(value);
}

function repositoryName(repository: string): string | null {
  const parts = repository.split("/");
  return parts.length === 2 && parts[0] && parts[1] ? parts[1] : null;
}

function manifestAllowsHydration(manifest: NaniteManifest, repository: string): boolean {
  const github = manifest.permissions.github;
  if (!github?.repositories.includes(repository)) {
    return false;
  }

  return github.appPermissions.contents === "read" || github.appPermissions.contents === "write";
}

function collectChangedPathsFromDispatchInput(input: TriggerDispatchInput | undefined): string[] {
  return [
    ...readInputStringArray(input, "changedFiles"),
    ...readInputStringArray(input, "files"),
    ...readInputStringArray(input, "sourceFiles"),
  ];
}

function readArrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function collectChangedPathsFromPushEvent(
  trigger: Extract<NaniteTriggerEvent, { type: "github" }>,
): string[] {
  const commits = trigger.event.payload.commits;
  if (!Array.isArray(commits)) {
    return [];
  }

  return commits.flatMap((commit) => {
    if (!isRecord(commit)) {
      return [];
    }

    return [...readArrayOfStrings(commit.added), ...readArrayOfStrings(commit.modified)];
  });
}

function packagePath(input: TriggerDispatchInput | undefined): string | null {
  const hydrationRoot = readInputString(input, "hydrationRoot");
  if (hydrationRoot) {
    return normalizeRepositoryPath(hydrationRoot);
  }

  const packageName = readInputString(input, "packageName");
  return packageName ? normalizeRepositoryPath(`packages/${packageName}`) : null;
}

export function buildDefaultRepositoryHydrationPlans(input: {
  manifest: NaniteManifest;
  trigger: NaniteTriggerEvent;
}): RepositoryHydrationPlan[] {
  const trigger = input.trigger;
  if (trigger.type !== "github" || trigger.event.name !== "push") {
    return [];
  }

  const repository = getGitHubWebhookRepositoryFullName(trigger.event);
  const ref = getGitHubWebhookHeadSha(trigger.event);
  const repoName = repository ? repositoryName(repository) : null;
  if (!repository || !repoName || !ref || isAllZeroSha(ref)) {
    return [];
  }

  if (!manifestAllowsHydration(input.manifest, repository)) {
    return [];
  }

  const changedPaths = [
    ...collectChangedPathsFromDispatchInput(trigger.input),
    ...collectChangedPathsFromPushEvent(trigger),
  ].flatMap((path) => {
    const normalized = normalizeRepositoryPath(path);
    return normalized ? [normalized] : [];
  });
  const root = packagePath(trigger.input);
  const paths = uniqueSorted([
    ...HYDRATION_ROOT_FILES,
    ...(root ? [`${root}/package.json`] : []),
    ...changedPaths,
  ]).slice(0, HYDRATION_MAX_PATHS);
  if (paths.length === 0) {
    return [];
  }

  const destination = normalizeWorkspaceDirectory(`repos/${repoName}`);
  if (!destination) {
    return [];
  }

  return [
    {
      repository,
      ref,
      destination,
      paths,
      reason: `Prepare ${repository}@${ref}`,
    },
  ];
}

function parseRepository(repository: string): { owner: string; repo: string } {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }

  return { owner, repo };
}

function contentToBytes(content: string): Uint8Array {
  const binary = atob(content.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function joinWorkspacePath(root: string, relativePath: string): string {
  return `${root.replace(/\/+$/, "")}/${relativePath}`;
}

function hydrationMetadataPath(repository: string): string {
  return `/.sigvelo/hydration/${repository.replace("/", "__")}.json`;
}

async function fetchContentFile(input: {
  owner: string;
  repo: string;
  path: string;
  ref: string;
  token: string;
}): Promise<GitHubContentFile | null> {
  const url = new URL(
    `${GITHUB_REST_API_BASE_URL}/repos/${input.owner}/${input.repo}/contents/${encodeURIComponent(input.path)}`,
  );
  url.searchParams.set("ref", input.ref);
  const response = await fetch(url, {
    headers: {
      accept: GITHUB_REST_API_ACCEPT_HEADER,
      authorization: `Bearer ${input.token}`,
      "user-agent": "nanites-repository-hydration",
      "x-github-api-version": GITHUB_REST_API_VERSION,
    },
    signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub contents request failed for ${input.path}: ${response.status}`);
  }

  const content = (await response.json()) as unknown;
  if (
    !isRecord(content) ||
    content.type !== "file" ||
    typeof content.sha !== "string" ||
    typeof content.content !== "string"
  ) {
    return null;
  }

  return {
    type: "file",
    sha: content.sha,
    content: content.content,
  };
}

export async function hydrateRepositoryIntoWorkspace(input: {
  workspace: RepositoryHydrationWorkspace;
  token: string;
  plan: RepositoryHydrationPlan;
}): Promise<RepositoryHydrationResult> {
  const { owner, repo } = parseRepository(input.plan.repository);
  const writtenFiles: RepositoryHydrationResult["writtenFiles"] = [];
  const missingFiles: string[] = [];

  for (const path of input.plan.paths) {
    const content = await fetchContentFile({
      owner,
      repo,
      path,
      ref: input.plan.ref,
      token: input.token,
    });
    if (!content) {
      missingFiles.push(path);
      continue;
    }

    const bytes = contentToBytes(content.content);
    await input.workspace.writeFileBytes(joinWorkspacePath(input.plan.destination, path), bytes);
    writtenFiles.push({
      path,
      sha: content.sha,
      size: bytes.byteLength,
    });
  }

  const result: RepositoryHydrationResult = {
    repository: input.plan.repository,
    ref: input.plan.ref,
    destination: input.plan.destination,
    metadataPath: hydrationMetadataPath(input.plan.repository),
    writtenFiles,
    missingFiles,
  };

  await input.workspace.writeFile(
    result.metadataPath,
    JSON.stringify(result, null, 2),
    "application/json",
  );
  return result;
}
