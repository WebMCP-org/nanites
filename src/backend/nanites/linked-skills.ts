import {
  parseSkillMarkdown as parseAgentSkillMarkdown,
  type SkillContent,
  type SkillDescriptor,
  type SkillResource,
  type SkillSource,
} from "agents/skills";

const LINKED_SKILLS_PREFIX = "/.sigvelo/skills";
const LINKED_SKILLS_INDEX_VERSION = 1;
const ROOT_GIT_EXCLUDE_PATH = "/.git/info/exclude";

const MAX_LINKED_SKILL_FILES = 500;
const MAX_LINKED_SKILL_BYTES = 5_000_000;

export type SkillLinkWorkspace = {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
};

type GitHubSkillSource = {
  owner: string;
  repo: string;
  ref?: string;
  subpath?: string;
  skillFilter?: string;
};

type LinkedSkillResourceDescriptor = {
  path: string;
  kind: "reference" | "script" | "asset" | "file";
  size?: number;
  encoding?: "text" | "base64";
  mimeType?: string;
};

type InstalledLinkedSkill = {
  name: string;
  description: string;
  compatibility?: string;
  license?: string;
  allowedTools?: string;
  metadata?: Record<string, unknown>;
  version?: string;
  prefix: string;
  resources: LinkedSkillResourceDescriptor[];
};

type InstalledLinkedSkillSource = {
  sourceUrl: string;
  owner: string;
  repo: string;
  ref: string;
  commitSha: string;
  subpath: string | null;
  skillFilter: string | null;
  fingerprint: string;
  installedAt: string;
  skills: InstalledLinkedSkill[];
};

type GitHubTreeEntry = {
  path: string;
  type: "blob" | "tree" | string;
  size?: number;
};

type LinkedSkillsIndex = {
  version: typeof LINKED_SKILLS_INDEX_VERSION;
  sources: Record<string, InstalledLinkedSkillSource>;
};

export type LinkedSkillCacheOptions = {
  prefix?: string;
};

export type NaniteWorkspaceSkillSourceOptions = LinkedSkillCacheOptions & {
  sourceUrls: readonly string[] | (() => readonly string[] | Promise<readonly string[]>);
  beforeRefresh?: () => Promise<void>;
  fetcher?: typeof fetch;
};

const TEXT_EXTENSIONS = new Set([
  ".bash",
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".sh",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const MIME_TYPES = new Map([
  [".css", "text/css"],
  [".gif", "image/gif"],
  [".html", "text/html"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".mjs", "text/javascript"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".py", "text/x-python"],
  [".sh", "text/x-shellscript"],
  [".svg", "image/svg+xml"],
  [".ts", "text/typescript"],
  [".tsx", "text/typescript"],
  [".txt", "text/plain"],
  [".webp", "image/webp"],
  [".xml", "application/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
]);

const SKIP_TREE_SEGMENTS = new Set([".git", "node_modules", "dist", "build", "__pycache__"]);
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

function emptyLinkedSkillsIndex(): LinkedSkillsIndex {
  return { version: LINKED_SKILLS_INDEX_VERSION, sources: {} };
}

function normalizeWorkspacePath(input: string, label: string): string {
  const normalized = input.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error(`Invalid ${label}: ${input}`);
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function resolveCacheOptions(options: LinkedSkillCacheOptions | undefined): {
  prefix: string;
  indexPath: string;
} {
  const prefix = normalizeWorkspacePath(
    options?.prefix ?? LINKED_SKILLS_PREFIX,
    "skill cache path",
  );
  return {
    prefix,
    indexPath: normalizeWorkspacePath(`${prefix}/index.json`, "skill cache index path"),
  };
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function excludeLinkedSkillsFromRootGit(input: {
  workspace: SkillLinkWorkspace;
  prefix: string;
}): Promise<void> {
  if (
    !(
      (await input.workspace.readFile("/.git/HEAD").catch(() => null)) ||
      (await input.workspace.readFile("/.git/config").catch(() => null))
    )
  ) {
    return;
  }

  const pattern = `${input.prefix.replace(/^\/+|\/+$/g, "")}/`;
  const existing = (await input.workspace.readFile(ROOT_GIT_EXCLUDE_PATH).catch(() => null)) ?? "";
  if (existing.split(/\r?\n/).some((line) => line.trim() === pattern)) {
    return;
  }

  await input.workspace.writeFile(
    ROOT_GIT_EXCLUDE_PATH,
    `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}# SigVelo runtime skill cache\n${pattern}\n`,
  );
}

function normalizeSkillName(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, "-");
}

function safeSegment(value: string): string {
  return (
    normalizeSkillName(value)
      .replace(/[^a-z0-9.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "skill"
  );
}

function extensionOf(path: string): string {
  const file = path.split("/").at(-1) ?? path;
  const index = file.lastIndexOf(".");
  return index === -1 ? "" : file.slice(index).toLowerCase();
}

function resourceKind(path: string): LinkedSkillResourceDescriptor["kind"] {
  if (path.startsWith("references/")) return "reference";
  if (path.startsWith("scripts/")) return "script";
  if (path.startsWith("assets/")) return "asset";
  return "file";
}

function resourceEncoding(path: string): "text" | "base64" {
  return TEXT_EXTENSIONS.has(extensionOf(path)) ? "text" : "base64";
}

function validateLinkedSkillRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\0") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function sanitizeSubpath(subpath: string | undefined): string | undefined {
  if (!subpath) return undefined;
  const normalized = subpath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!validateLinkedSkillRelativePath(normalized)) {
    throw new Error(`Invalid skill source subpath: ${subpath}`);
  }
  return normalized;
}

function normalizeGitHubOwner(owner: string, source: string): string {
  if (!GITHUB_OWNER_PATTERN.test(owner)) {
    throw new Error(`Invalid GitHub owner in skill source: ${source}`);
  }
  return owner;
}

function normalizeGitHubRepo(repo: string, source: string): string {
  const normalized = repo.replace(/\.git$/, "");
  if (!GITHUB_REPO_PATTERN.test(normalized) || normalized === "." || normalized === "..") {
    throw new Error(`Invalid GitHub repository in skill source: ${source}`);
  }
  return normalized;
}

function normalizeGitHubSourceParts(input: { owner: string; repo: string; source: string }): {
  owner: string;
  repo: string;
} {
  return {
    owner: normalizeGitHubOwner(input.owner, input.source),
    repo: normalizeGitHubRepo(input.repo, input.source),
  };
}

function gitHubRepoApiPath(source: GitHubSkillSource): string {
  return `${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`;
}

function parseFragment(input: string): {
  input: string;
  ref?: string;
  skillFilter?: string;
} {
  const index = input.indexOf("#");
  if (index === -1) return { input };

  const fragment = input.slice(index + 1);
  const [ref, skillFilter] = fragment.split("@", 2);
  return {
    input: input.slice(0, index),
    ref: ref ? decodeURIComponent(ref) : undefined,
    skillFilter: skillFilter ? decodeURIComponent(skillFilter) : undefined,
  };
}

function parseGitHubSkillSource(input: string): GitHubSkillSource {
  const parsedFragment = parseFragment(input.trim());
  let source = parsedFragment.input;
  if (source.startsWith("github:")) {
    source = source.slice("github:".length);
  }

  const atSkill = source.match(/^([^/]+)\/([^/@]+)@(.+)$/);
  if (atSkill && !source.includes(":")) {
    const repo = normalizeGitHubSourceParts({
      owner: atSkill[1]!,
      repo: atSkill[2]!,
      source: input,
    });
    return {
      ...repo,
      ref: parsedFragment.ref,
      skillFilter: parsedFragment.skillFilter ?? atSkill[3],
    };
  }

  if (source.startsWith("https://github.com/")) {
    const url = new URL(source);
    const [owner, rawRepo, tree, ref, ...rest] = url.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .map((part) => decodeURIComponent(part));
    if (!owner || !rawRepo) {
      throw new Error(`Invalid GitHub skill source: ${input}`);
    }
    const repo = normalizeGitHubSourceParts({ owner, repo: rawRepo, source: input });
    return {
      ...repo,
      ref: parsedFragment.ref ?? (tree === "tree" ? ref : undefined),
      subpath: sanitizeSubpath(tree === "tree" ? rest.join("/") : undefined),
      skillFilter: parsedFragment.skillFilter,
    };
  }

  const shorthand = source.match(/^([^/]+)\/([^/]+)(?:\/(.+))?$/);
  if (shorthand && !source.includes(":") && !source.startsWith(".") && !source.startsWith("/")) {
    const repo = normalizeGitHubSourceParts({
      owner: shorthand[1]!,
      repo: shorthand[2]!,
      source: input,
    });
    return {
      ...repo,
      ref: parsedFragment.ref,
      subpath: sanitizeSubpath(shorthand[3]),
      skillFilter: parsedFragment.skillFilter,
    };
  }

  throw new Error(`Only GitHub skill sources are supported: ${input}`);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Encode(bytes: ArrayBuffer): string {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let offset = 0; offset < view.length; offset += 0x8000) {
    binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function fetchJson<T>(fetcher: typeof fetch, url: string): Promise<T> {
  const response = await fetcher(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "sigvelo-skill-links",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}): ${url}`);
  }
  return response.json() as Promise<T>;
}

async function fetchRaw(
  fetcher: typeof fetch,
  input: {
    owner: string;
    repo: string;
    sha: string;
    path: string;
  },
): Promise<{ content: string; encoding: "text" | "base64"; size: number }> {
  const path = input.path.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/${encodeURIComponent(input.sha)}/${path}`;
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`GitHub raw file request failed (${response.status}): ${input.path}`);
  }

  const bytes = await response.arrayBuffer();
  const encoding = resourceEncoding(input.path);
  return {
    content: encoding === "text" ? new TextDecoder().decode(bytes) : base64Encode(bytes),
    encoding,
    size: bytes.byteLength,
  };
}

async function readIndex(
  workspace: SkillLinkWorkspace,
  indexPath: string,
): Promise<LinkedSkillsIndex> {
  const raw = await workspace.readFile(indexPath).catch(() => null);
  if (!raw) return emptyLinkedSkillsIndex();
  try {
    const parsed = JSON.parse(raw) as LinkedSkillsIndex;
    return parsed.version === LINKED_SKILLS_INDEX_VERSION && parsed.sources
      ? parsed
      : emptyLinkedSkillsIndex();
  } catch {
    return emptyLinkedSkillsIndex();
  }
}

async function writeIndex(
  workspace: SkillLinkWorkspace,
  indexPath: string,
  index: LinkedSkillsIndex,
): Promise<void> {
  await workspace.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
}

async function cachedSourceIsUsable(
  workspace: SkillLinkWorkspace,
  source: InstalledLinkedSkillSource,
): Promise<boolean> {
  for (const skill of source.skills) {
    if (!(await workspace.readFile(`${skill.prefix}/SKILL.md`).catch(() => null))) {
      return false;
    }
  }
  return source.skills.length > 0;
}

async function resolveCommit(
  fetcher: typeof fetch,
  source: GitHubSkillSource,
): Promise<{
  ref: string;
  sha: string;
}> {
  const repoPath = gitHubRepoApiPath(source);
  const ref =
    source.ref ??
    (
      await fetchJson<{ default_branch?: string }>(
        fetcher,
        `https://api.github.com/repos/${repoPath}`,
      )
    ).default_branch ??
    "main";
  const commit = await fetchJson<{ sha?: string }>(
    fetcher,
    `https://api.github.com/repos/${repoPath}/commits/${encodeURIComponent(ref)}`,
  );
  if (!commit.sha) {
    throw new Error(
      `GitHub commit response did not include a SHA for ${source.owner}/${source.repo}`,
    );
  }
  return { ref, sha: commit.sha };
}

function pathIsUnder(path: string, directory: string): boolean {
  return directory ? path === directory || path.startsWith(`${directory}/`) : true;
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

async function installGitHubSkillSource(input: {
  workspace: SkillLinkWorkspace;
  fetcher: typeof fetch;
  sourceUrl: string;
  cachePrefix: string;
}): Promise<InstalledLinkedSkillSource> {
  const source = parseGitHubSkillSource(input.sourceUrl);
  const resolved = await resolveCommit(input.fetcher, source);
  const fingerprint = (
    await sha256Hex(
      JSON.stringify({
        sourceUrl: input.sourceUrl,
        owner: source.owner,
        repo: source.repo,
        ref: resolved.ref,
        sha: resolved.sha,
        subpath: source.subpath ?? null,
        skillFilter: source.skillFilter ?? null,
      }),
    )
  ).slice(0, 20);

  const treeResponse = await fetchJson<{
    truncated?: boolean;
    tree?: GitHubTreeEntry[];
  }>(
    input.fetcher,
    `https://api.github.com/repos/${gitHubRepoApiPath(source)}/git/trees/${resolved.sha}?recursive=1`,
  );
  if (treeResponse.truncated) {
    throw new Error(
      `GitHub tree for ${source.owner}/${source.repo} was truncated; use a narrower skill subpath.`,
    );
  }

  const blobs = (treeResponse.tree ?? []).filter(
    (entry) =>
      entry.type === "blob" &&
      !entry.path.split("/").some((segment) => SKIP_TREE_SEGMENTS.has(segment)),
  );
  const base = source.subpath ?? "";
  const skillMdEntries = blobs
    .filter((entry) => entry.path.endsWith("/SKILL.md") || entry.path === "SKILL.md")
    .filter((entry) => pathIsUnder(entry.path, base));
  if (skillMdEntries.length === 0) {
    throw new Error(`No SKILL.md files found in ${input.sourceUrl}`);
  }

  const installedSkills: InstalledLinkedSkill[] = [];
  const normalizedFilter = source.skillFilter ? normalizeSkillName(source.skillFilter) : null;

  for (const skillEntry of skillMdEntries) {
    const skillDir =
      skillEntry.path === "SKILL.md" ? "" : skillEntry.path.slice(0, -"/SKILL.md".length);
    const rawSkill = await fetchRaw(input.fetcher, {
      owner: source.owner,
      repo: source.repo,
      sha: resolved.sha,
      path: skillEntry.path,
    });
    const parsed = parseAgentSkillMarkdown(rawSkill.content);
    if (!parsed) continue;

    if (
      normalizedFilter &&
      normalizedFilter !== normalizeSkillName(parsed.name) &&
      normalizedFilter !== normalizeSkillName(basename(skillDir))
    ) {
      continue;
    }

    const resourceEntries = blobs.filter(
      (entry) =>
        entry.path !== skillEntry.path &&
        pathIsUnder(entry.path, skillDir) &&
        validateLinkedSkillRelativePath(
          skillDir ? entry.path.slice(skillDir.length + 1) : entry.path,
        ),
    );
    const projectedFileCount = 1 + resourceEntries.length;
    const projectedBytes =
      (skillEntry.size ?? rawSkill.size) +
      resourceEntries.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
    if (projectedFileCount > MAX_LINKED_SKILL_FILES || projectedBytes > MAX_LINKED_SKILL_BYTES) {
      throw new Error(`Linked skill ${parsed.name} is too large for the workspace cache.`);
    }

    const prefix = `${input.cachePrefix}/${fingerprint}/${safeSegment(parsed.name)}`;
    await input.workspace.writeFile(`${prefix}/SKILL.md`, rawSkill.content);

    const resources: LinkedSkillResourceDescriptor[] = [];
    for (const entry of resourceEntries) {
      const resourcePath = skillDir ? entry.path.slice(skillDir.length + 1) : entry.path;
      const rawResource = await fetchRaw(input.fetcher, {
        owner: source.owner,
        repo: source.repo,
        sha: resolved.sha,
        path: entry.path,
      });
      await input.workspace.writeFile(`${prefix}/${resourcePath}`, rawResource.content);
      resources.push({
        path: resourcePath,
        kind: resourceKind(resourcePath),
        size: rawResource.size,
        encoding: rawResource.encoding,
        mimeType: MIME_TYPES.get(extensionOf(resourcePath)),
      });
    }

    installedSkills.push({
      name: parsed.name,
      description: parsed.description,
      ...(parsed.compatibility ? { compatibility: parsed.compatibility } : {}),
      ...(parsed.license ? { license: parsed.license } : {}),
      ...(parsed.allowedTools ? { allowedTools: parsed.allowedTools } : {}),
      ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
      prefix,
      resources,
    });
  }

  if (installedSkills.length === 0) {
    throw new Error(
      normalizedFilter
        ? `No skill matched ${source.skillFilter} in ${input.sourceUrl}`
        : `No valid skills found in ${input.sourceUrl}`,
    );
  }

  return {
    sourceUrl: input.sourceUrl,
    owner: source.owner,
    repo: source.repo,
    ref: resolved.ref,
    commitSha: resolved.sha,
    subpath: source.subpath ?? null,
    skillFilter: source.skillFilter ?? null,
    fingerprint,
    installedAt: new Date().toISOString(),
    skills: installedSkills,
  };
}

async function ensureLinkedSkillUrls(input: {
  workspace: SkillLinkWorkspace;
  skillUrls: readonly string[];
  fetcher?: typeof fetch;
  prefix?: string;
}): Promise<InstalledLinkedSkillSource[]> {
  const fetcher = input.fetcher ?? fetch;
  const cache = resolveCacheOptions(input);
  const urls = uniqueNonEmpty(input.skillUrls);
  if (urls.length > 0) {
    await excludeLinkedSkillsFromRootGit({ workspace: input.workspace, prefix: cache.prefix });
  }
  const index = await readIndex(input.workspace, cache.indexPath);
  const installed: InstalledLinkedSkillSource[] = [];

  for (const sourceUrl of urls) {
    const cached = index.sources[sourceUrl];
    if (cached && (await cachedSourceIsUsable(input.workspace, cached))) {
      installed.push(cached);
      continue;
    }

    const next = await installGitHubSkillSource({
      workspace: input.workspace,
      fetcher,
      sourceUrl,
      cachePrefix: cache.prefix,
    });
    index.sources[sourceUrl] = next;
    installed.push(next);
  }

  await writeIndex(input.workspace, cache.indexPath, index);
  return installed;
}

function linkedSkillDescriptor(id: string, skill: InstalledLinkedSkill): SkillDescriptor {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.compatibility ? { compatibility: skill.compatibility } : {}),
    ...(skill.license ? { license: skill.license } : {}),
    ...(skill.allowedTools ? { allowedTools: skill.allowedTools } : {}),
    ...(skill.metadata ? { metadata: skill.metadata } : {}),
    ...(skill.version ? { version: skill.version } : {}),
    sourceId: id,
  };
}

export function createNaniteWorkspaceSkillSource(
  input: { workspace: SkillLinkWorkspace } & NaniteWorkspaceSkillSourceOptions,
): SkillSource {
  const id = "nanite-linked-skills";
  const workspace = input.workspace;
  let loadedKey: string | null = null;
  let loadedSkills: InstalledLinkedSkill[] = [];
  let fingerprint = `${id}:empty`;

  async function sourceUrls(): Promise<string[]> {
    return uniqueNonEmpty(
      typeof input.sourceUrls === "function" ? await input.sourceUrls() : input.sourceUrls,
    );
  }

  async function loadIndex(): Promise<void> {
    const urls = await sourceUrls();
    const key = JSON.stringify(urls);
    if (key === loadedKey) return;

    const sources = await ensureLinkedSkillUrls({
      workspace,
      skillUrls: urls,
      fetcher: input.fetcher,
      prefix: input.prefix,
    });
    loadedSkills = sources.flatMap((source) =>
      source.skills.map((skill) => ({
        ...skill,
        resources: skill.resources.map((resource) => ({ ...resource })),
      })),
    );
    fingerprint = `${id}:${sources.map((source) => source.fingerprint).join("|") || "empty"}`;
    loadedKey = key;
  }

  async function findSkill(name: string): Promise<InstalledLinkedSkill | null> {
    await loadIndex();
    return loadedSkills.find((skill) => skill.name === name) ?? null;
  }

  return {
    id,
    get fingerprint() {
      return fingerprint;
    },
    async list() {
      await loadIndex();
      return loadedSkills.map((skill) => linkedSkillDescriptor(id, skill));
    },
    async load(name: string): Promise<SkillContent | null> {
      const skill = await findSkill(name);
      if (!skill) return null;

      const rawContent = await workspace.readFile(`${skill.prefix}/SKILL.md`);
      if (!rawContent) return null;
      const parsed = parseAgentSkillMarkdown(rawContent);
      if (!parsed) return null;

      return {
        ...linkedSkillDescriptor(id, skill),
        body: parsed.body,
        rawContent,
        resources: skill.resources.map((resource) => ({ ...resource })),
      };
    },
    async readResource(name: string, path: string): Promise<SkillResource | null> {
      if (!validateLinkedSkillRelativePath(path)) return null;
      const skill = await findSkill(name);
      const resource = skill?.resources.find((entry) => entry.path === path);
      if (!skill || !resource) return null;

      const content = await workspace.readFile(`${skill.prefix}/${path}`);
      return content === null ? null : { ...resource, content };
    },
    async refresh() {
      await input.beforeRefresh?.();
      loadedKey = null;
      await loadIndex();
    },
  };
}
