import { MCP_SCOPES, DEFAULT_SIGVELO_AGENT_MODEL_ID } from "#/shared/constants.ts";
import { Think, Workspace, skills } from "@cloudflare/think";
import type { ChatOptions, Session, StreamCallback, TurnConfig } from "@cloudflare/think";
import {
  chatSdkMessenger,
  defaultConversationName,
  defineMessengers,
  type MessengerContext,
  type ThinkMessengers,
} from "@cloudflare/think/messengers";
import { createExecuteTool } from "@cloudflare/think/tools/execute";
import { createWorkspaceTools } from "@cloudflare/think/tools/workspace";
import { ToolProviderConnector } from "#/backend/nanites/tool-provider-connector.ts";
import { GitHubMcpConnector } from "#/backend/nanites/github-mcp-connector.ts";
import nanitesSkills from "agents:skills/../../../plugins/nanites/skills";
import { callable, getCurrentAgent } from "agents";
import type { Connection, ConnectionContext } from "agents";
import type { LanguageModel, ToolSet, UIMessage } from "ai";
import { AppError } from "#/backend/errors.ts";
import {
  issueScopedGitHubInstallationToken,
  type GitHubInstallationRepository,
  listReposAccessibleToInstallation,
} from "#/backend/github/index.ts";
import { createGitHubAdapter } from "@chat-adapter/github";
import { gitToolsWithGitHubInstallationAuth } from "#/backend/nanites/git-auth.ts";
import type { SigveloMcpAuthProps } from "#/backend/mcp/index.ts";
import { createSigveloAgentLanguageModel } from "#/backend/nanites/language-model.ts";
import { createSigveloThinkTools } from "#/backend/nanites/tools/index.ts";
import { buildNaniteManagerKey, parseNaniteManagerKey } from "#/shared/utils/nanites.ts";
import { requireDeploymentGitHubInstallation } from "#/backend/auth/installations.ts";
import { requireDeploymentGitHubAppForId } from "#/backend/github/apps.ts";

const SIGVELO_MANAGER_CHAT_CLIENT_ID = "sigvelo-github-manager-chat";
const GITHUB_MANAGER_MESSENGER_ID = "github";
const GITHUB_MANAGER_MESSENGER_SEPARATOR = ":messenger:github:";
const NANITES_AUTHORING_REPOSITORY = "WebMCP-org/nanites";
const NANITES_AUTHORING_REPOSITORY_URL = `https://github.com/${NANITES_AUTHORING_REPOSITORY}`;
const NANITES_AUTHORING_CHECKOUT_DIR = "/repos/WebMCP-org/nanites";
const NANITES_AUTHORING_REFERENCE_PATHS = [
  "docs/architecture/README.md",
  "docs/architecture/execution-architecture.md",
  "docs/development.md",
  "plugins/nanites/skills/nanites/SKILL.md",
  "plugins/nanites/skills/nanites/references/authoring.md",
  "plugins/nanites/skills/nanites/references/codemode-runtime.md",
  "plugins/nanites/skills/nanites/references/operations.md",
  "plugins/nanites/commands/create-nanite.md",
  "plugins/nanites/commands/write-nanite-trigger.md",
  "plugins/nanites/commands/test-nanite.md",
  "plugins/nanites/assets/examples/",
] as const;

type DisconnectedManagerConversationState = {
  status: "disconnected";
  repositories: GitHubInstallationRepository[];
  /** Model the manager conversation runs on; switchable from the manager card. */
  model: string;
};

type ConnectedManagerConversationState = {
  status: "connected";
  managerName: string;
  githubAppId: number;
  githubInstallationId: number;
  githubAccountLogin: string;
  sigveloToolAuthProps: SigveloMcpAuthProps;
  repositories: GitHubInstallationRepository[];
  connectedAt: string;
  /** Model the manager conversation runs on; switchable from the manager card. */
  model: string;
};

export type ManagerConversationState =
  | DisconnectedManagerConversationState
  | ConnectedManagerConversationState;

type BrowserInstallationConnectionAuth = {
  readonly githubLogin: string;
  readonly githubUserId: number;
};

type ManagerConversationConnectionState = {
  readonly browserInstallationAuth?: BrowserInstallationConnectionAuth;
};

type GitHubManagerMessengerRoot = {
  readonly managerName: string;
  readonly githubAppId: number;
  readonly githubInstallationId: number;
  readonly githubAppSlug: string;
};

export function buildGitHubManagerMessengerName(input: {
  readonly managerName: string;
  readonly githubAppId: number;
  readonly githubAppSlug: string;
}): string {
  return `${input.managerName}${GITHUB_MANAGER_MESSENGER_SEPARATOR}${input.githubAppId}:${encodeURIComponent(
    input.githubAppSlug,
  )}`;
}

function parseGitHubManagerMessengerRoot(name: string): GitHubManagerMessengerRoot | null {
  const separatorIndex = name.indexOf(GITHUB_MANAGER_MESSENGER_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }

  const managerName = name.slice(0, separatorIndex);
  const identity = parseNaniteManagerKey(managerName);
  if (!identity) {
    return null;
  }

  const rawRoot = name.slice(separatorIndex + GITHUB_MANAGER_MESSENGER_SEPARATOR.length);
  const appSeparatorIndex = rawRoot.indexOf(":");
  if (appSeparatorIndex <= 0) {
    return null;
  }

  const rawAppId = rawRoot.slice(0, appSeparatorIndex);
  const githubAppId = Number(rawAppId);
  if (!Number.isInteger(githubAppId) || githubAppId <= 0) {
    return null;
  }

  const rawSlug = rawRoot.slice(appSeparatorIndex + 1);
  let githubAppSlug: string;
  try {
    githubAppSlug = decodeURIComponent(rawSlug);
  } catch {
    return null;
  }
  if (!githubAppSlug.trim()) {
    return null;
  }

  return {
    managerName,
    githubAppId,
    githubInstallationId: identity.githubInstallationId,
    githubAppSlug,
  };
}

function readMessengerRootFromAgentPath(input: {
  readonly name: string;
  readonly parentPath: readonly { readonly name: string }[];
}): GitHubManagerMessengerRoot | null {
  const rootName = input.parentPath[0]?.name ?? input.name;
  return parseGitHubManagerMessengerRoot(rootName);
}

export class SigveloManagerConversationAgent extends Think<Env, ManagerConversationState> {
  initialState: ManagerConversationState = {
    status: "disconnected",
    repositories: [],
    model: DEFAULT_SIGVELO_AGENT_MODEL_ID,
  };
  override maxSteps = 1000;
  // Never externalize evicted transcript media into the workspace: repos are
  // cloned at the workspace root, so a written /attachments directory would
  // collide with (and git-shadow) a repo's own files. Drop the bytes instead.
  override mediaEviction = { externalizeToWorkspace: false };
  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.WORKSPACE_FILES,
    namespace: "manager_conversation",
    name: () => this.name,
  });

  override getModel(): LanguageModel {
    return createSigveloAgentLanguageModel({
      env: this.env,
      sessionAffinity: this.sessionAffinity,
      modelId: this.state.model,
    });
  }

  @callable()
  async setModel(modelId: string): Promise<{ model: string }> {
    const model = modelId.trim();
    if (!model) {
      throw new AppError("requestValidationFailed", {
        details: { reason: "Model id must not be empty." },
      });
    }
    this.setState({ ...this.state, model });
    return { model };
  }

  // AI Gateway owns upstream-provider retries; cap the AI SDK's own retry so the
  // two layers don't compound. 1 still covers a transient worker to gateway blip.
  override beforeTurn(): TurnConfig {
    return { maxRetries: 1 };
  }

  override configureSession(session: Session): Session {
    return session
      .withContext("manager_installation_context", {
        description:
          "Selected GitHub installation, account, and repository grounding for the SigVelo installation manager.",
        maxTokens: 2000,
        provider: {
          get: async () => this.formatInstallationContext(),
        },
      })
      .withContext("nanites_authoring_sources", {
        description:
          "Canonical Nanite authoring repo, checkout location, and skill/reference paths the manager should refresh and inspect before creating or updating Nanites.",
        maxTokens: 1200,
        provider: {
          get: async () => formatNanitesAuthoringSources(),
        },
      });
  }

  override getSystemPrompt(): string {
    return buildManagerSystemPrompt();
  }

  override getSkills() {
    return [nanitesSkills];
  }

  override getSkillScriptRunner() {
    return skills.runner({
      loader: this.env.LOADER,
      workspaceInstance: this.workspace,
    });
  }

  override getMessengers(): ThinkMessengers {
    const messengerRoot = parseGitHubManagerMessengerRoot(this.name);
    if (!messengerRoot) {
      return defineMessengers({});
    }

    const githubApp = requireDeploymentGitHubAppForId(this.env, messengerRoot.githubAppId);
    const github = createGitHubAdapter({
      appId: String(githubApp.appId),
      installationId: messengerRoot.githubInstallationId,
      privateKey: githubApp.privateKey,
      webhookSecret: githubApp.webhookSecret,
      userName: githubApp.slug,
    });

    return defineMessengers({
      [GITHUB_MANAGER_MESSENGER_ID]: chatSdkMessenger({
        adapter: github,
        provider: "github",
        userName: githubApp.slug,
        verifyWebhook: false,
        respondTo: ["mention", "subscribed-thread"],
        conversation: (event) => ({
          target: "subagent",
          name: defaultConversationName(event),
        }),
      }),
    });
  }

  override getTools(): ToolSet {
    const workspaceTools = createWorkspaceTools(this.workspace);
    const githubMcpConnector = this.createGitHubMcpConnector();
    const sigveloTools =
      this.state.status === "connected"
        ? createSigveloThinkTools({
            env: this.env,
            auth: this.state.sigveloToolAuthProps,
          })
        : {};

    return {
      ...workspaceTools,
      ...sigveloTools,
      execute: createExecuteTool(this, {
        tools: workspaceTools,
        connectors: [
          new ToolProviderConnector(this.ctx, this.createGitToolProvider()),
          ...(githubMcpConnector ? [githubMcpConnector] : []),
        ],
        browser: undefined,
      }),
    };
  }

  override async onConnect(
    connection: Connection<ManagerConversationConnectionState>,
    context: ConnectionContext,
  ): Promise<void> {
    const browserInstallationAuth = readBrowserInstallationAuthFromHeaders(context.request.headers);
    connection.setState((state) => ({
      ...(state ?? {}),
      browserInstallationAuth,
    }));
  }

  @callable()
  async connectBrowserInstallation(): Promise<{ connected: true }> {
    const auth = requireBrowserInstallationConnectionAuth();
    const deploymentInstallation = await requireDeploymentGitHubInstallation(this.env);
    requireBrowserConversationTarget(this.name, {
      managerName: deploymentInstallation.managerName,
      githubUserId: auth.githubUserId,
    });

    await this.ensureGitHubMcpConnected(
      {
        authKind: "mcp",
        githubUserId: auth.githubUserId,
        githubLogin: auth.githubLogin,
        githubAppId: deploymentInstallation.githubAppId,
        githubInstallationId: deploymentInstallation.githubInstallationId,
        clientId: SIGVELO_MANAGER_CHAT_CLIENT_ID,
        scopes: [MCP_SCOPES.read, MCP_SCOPES.write],
        authorizedAt: new Date().toISOString(),
      },
      deploymentInstallation.account.login,
    );
    return { connected: true };
  }

  override async chatWithMessengerContext(
    userMessage: string | UIMessage,
    callback: StreamCallback,
    context: MessengerContext,
    options?: ChatOptions,
  ): Promise<void> {
    await this.connectMessengerInstallation(context);
    await super.chatWithMessengerContext(userMessage, callback, context, options);
  }

  private async ensureGitHubMcpConnected(props: SigveloMcpAuthProps, accountLogin: string) {
    const repositories = await listReposAccessibleToInstallation({
      env: this.env,
      githubAppId: props.githubAppId,
      githubInstallationId: props.githubInstallationId,
    });
    this.setState({
      status: "connected",
      managerName: buildNaniteManagerKey({
        githubInstallationId: props.githubInstallationId,
      }),
      githubAppId: props.githubAppId,
      githubInstallationId: props.githubInstallationId,
      githubAccountLogin: accountLogin,
      sigveloToolAuthProps: props,
      repositories,
      connectedAt: new Date().toISOString(),
      model: this.state.model,
    });
  }

  private async connectMessengerInstallation(context: MessengerContext): Promise<void> {
    const messengerRoot = readMessengerRootFromAgentPath({
      name: this.name,
      parentPath: this.parentPath,
    });
    if (!messengerRoot || context.provider !== "github") {
      return;
    }

    const author = context.message?.author ?? context.author;
    const githubUserId = Number(author?.userId);
    if (!Number.isInteger(githubUserId) || githubUserId <= 0 || !author?.userName) {
      throw new AppError("authenticationRequired");
    }

    const deploymentInstallation = await requireDeploymentGitHubInstallation(this.env);
    if (deploymentInstallation.managerName !== messengerRoot.managerName) {
      throw new AppError("managerConversationInstallationMismatch");
    }

    await this.ensureGitHubMcpConnected(
      {
        authKind: "mcp",
        githubUserId,
        githubLogin: author.userName,
        githubAppId: deploymentInstallation.githubAppId,
        githubInstallationId: deploymentInstallation.githubInstallationId,
        clientId: SIGVELO_MANAGER_CHAT_CLIENT_ID,
        scopes: [MCP_SCOPES.read, MCP_SCOPES.write],
        authorizedAt: new Date().toISOString(),
      },
      deploymentInstallation.account.login,
    );
  }

  /**
   * Exposes GitHub MCP inside the codemode sandbox as `github.*`, minting a
   * fresh installation token for each turn in createHeaders. Broad access:
   * the token covers every accessible repo with the installation's granted
   * permissions, and no X-MCP filter is sent, so the manager sees the full
   * tool surface. Returns null until an installation is connected.
   */
  private createGitHubMcpConnector(): GitHubMcpConnector | null {
    const state = this.state;
    if (state.status !== "connected" || state.repositories.length === 0) {
      return null;
    }

    const { githubAppId, githubInstallationId } = state;
    const repositories = state.repositories.map((repository) => repository.full_name).sort();
    return new GitHubMcpConnector(this.ctx, {
      createHeaders: async () => {
        const scopedToken = await issueScopedGitHubInstallationToken({
          env: this.env,
          githubAppId,
          installationId: githubInstallationId,
          repositories,
        });
        return { Authorization: `Bearer ${scopedToken.token}` };
      },
    });
  }

  private formatInstallationContext(): string {
    const context = this.state;
    if (context.status === "disconnected") {
      return [
        "No GitHub installation has been connected for this manager conversation yet.",
        "If the human asks about repositories or Nanites, first inspect SigVelo manager state with the manager tools before asking for missing names.",
      ].join("\n");
    }

    return [
      `Connected GitHub account: ${context.githubAccountLogin}`,
      `Connected GitHub installation id: ${context.githubInstallationId}`,
      `Connected at: ${context.connectedAt}`,
      "",
      "Accessible repositories in this installation:",
      ...context.repositories.map((repository) => `- ${repository.full_name}`).sort(),
      "",
      "Operating rule: assume user references such as 'my org', 'this org', 'the package repo', and 'the docs repo' refer to this deployment installation unless they explicitly name another account.",
      "When a request does not name a repository (for example 'create a demo Nanite'), choose from the accessible repositories above — never from the chat user's personal account.",
    ].join("\n");
  }

  @callable()
  async clearConversation(): Promise<{ clearedMessages: true; deletedSubmissions: number }> {
    await this.clearMessages();
    const deletedSubmissions = await this.deleteSubmissions({ limit: 100 });
    return {
      clearedMessages: true,
      deletedSubmissions,
    };
  }

  private createGitToolProvider() {
    return gitToolsWithGitHubInstallationAuth(this.workspace, {
      getAllowedRepositories: () => {
        const state = this.state;
        return state.status === "connected"
          ? state.repositories.map((repository) => repository.full_name).sort()
          : [];
      },
      issueToken: ({ repository }) => this.issueGitToolToken(repository),
    });
  }

  private async issueGitToolToken(repository: string): Promise<string | null> {
    const state = this.state;
    if (state.status !== "connected") {
      return null;
    }

    const scopedToken = await issueScopedGitHubInstallationToken({
      env: this.env,
      githubAppId: state.githubAppId,
      installationId: state.githubInstallationId,
      repositories: [repository],
    });
    return scopedToken.token;
  }
}

function readBrowserInstallationAuthFromHeaders(
  headers: Headers,
): BrowserInstallationConnectionAuth {
  return {
    githubUserId: readPositiveActorHeader(headers, "x-nanites-github-user-id"),
    githubLogin: readRequiredActorHeader(headers, "x-nanites-github-login"),
  };
}

function requireBrowserInstallationConnectionAuth(): BrowserInstallationConnectionAuth {
  const { connection } = getCurrentAgent();
  const state = connection?.state as ManagerConversationConnectionState | null | undefined;
  const auth = state?.browserInstallationAuth;
  if (!auth) {
    throw new AppError("authenticationRequired");
  }

  return auth;
}

function readPositiveActorHeader(headers: Headers, name: string): number {
  const value = Number(headers.get(name));
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError("authenticationRequired");
  }
  return value;
}

function readRequiredActorHeader(headers: Headers, name: string): string {
  const value = headers.get(name);
  if (!value) {
    throw new AppError("authenticationRequired");
  }
  return value;
}

function requireBrowserConversationTarget(
  conversationName: string,
  expected: {
    readonly managerName: string;
    readonly githubUserId: number;
  },
): void {
  if (conversationName !== `${expected.managerName}:manager:${expected.githubUserId}`) {
    throw new AppError("managerConversationInstallationMismatch");
  }
}

function buildManagerSystemPrompt(): string {
  return [
    "You are the SigVelo Installation Manager.",
    "Use the loaded nanites skill as the source of truth for Nanite authoring, trigger, permission, testing, and debugging rules.",
    "Use manager_installation_context as the deployment GitHub installation grounding. Treat that installation/account as the user's current org unless they explicitly ask to switch.",
    "The signed-in human's personal login (githubLogin from sigvelo_whoami) identifies who you are talking to, not where you work. Never search, target, or create Nanites against that personal account or its repositories unless the user explicitly asks; pick repositories from the accessible repository list in manager_installation_context.",
    "You have broad GitHub access for the deployment installation, exposed inside execute as github.* and bounded by the GitHub App installation and accessible repository list. Use direct github.* calls for common PR, issue, check, workflow, and metadata tasks; use codemode.search/codemode.describe only when the method shape is unfamiliar.",
    "Use SigVelo manager tools for control-plane work: inspect Nanites, create or update one Nanite at a time, deprovision one Nanite, start manual runs, cancel runs, and inspect Nanite workspaces.",
    "Use github.* tools inside execute to investigate repositories, repo instructions, branches, commits, pull requests, issues, and workflow/check state before creating or updating Nanites. You may create pull requests only when that is the user's explicit request or the coherent review surface for the manager's work.",
    "For a Modern Web Guidance Nanite request, do not assume a target URL, repository, or cadence. Inspect accessible repositories, ask for missing public/preview URLs and whether it should run manually, on release, or on a schedule, then create a normal Nanite. Set runtimeConfig.browser only when browser evidence is part of the requested work, and runtimeConfig.skillUrls only when the Nanite needs linked skill instructions.",
    "Use built-in workspace tools for repository file review and git work. execute runs Worker-compatible JavaScript, not Node.js: require(), child_process, shell subprocesses, and shell git are unavailable. Use state.*, git.*, and github.* APIs directly.",
    'Common execute shapes: `await git.status({ dir })`, `await state.readFile({ path })`, `await github.list_pull_requests({ owner, repo, state: "open" })`.',
    "SigVelo manager tools are not exposed as top-level JavaScript functions inside execute. Call explicit SigVelo tools from the Think tool list instead, one Nanite at a time.",
    "For repository file contents, repo-local instructions, and Nanite authoring references, prefer the durable workspace checkout over github.* so evidence stays inspectable in the manager workspace.",
    `Use nanites_authoring_sources to refresh and inspect ${NANITES_AUTHORING_REPOSITORY} in the manager workspace before creating or updating Nanites.`,
    "If the authoring repo refresh fails because of access, network, or a dirty checkout, continue from the best available evidence and mention the limitation briefly.",
    "Resolve phrases like 'my org', 'this org', 'the package repo', or 'the docs repo' against the deployment installation account and accessible repository list before asking for names.",
    "Do not ask which GitHub org to use when the deployment installation account is known. Ask only if the user's target is genuinely outside that installation or multiple matching repos remain after inspection.",
    "Humans should not need to know exact Nanite ids. If a request is ambiguous, inspect the roster first and choose a sensible Nanite or explain the options.",
    "Keep replies concise and use Markdown.",
    "Do not mirror hidden tool logs or full Think transcripts unless the human explicitly asks for diagnostic detail.",
  ].join("\n");
}

function formatNanitesAuthoringSources(): string {
  return [
    `Canonical Nanites authoring repository: ${NANITES_AUTHORING_REPOSITORY}`,
    `Repository URL: ${NANITES_AUTHORING_REPOSITORY_URL}`,
    `Preferred manager workspace checkout: ${NANITES_AUTHORING_CHECKOUT_DIR}`,
    "",
    "Refresh rule:",
    `- If ${NANITES_AUTHORING_CHECKOUT_DIR}/.git/config is missing, call git.clone inside execute to clone the repository into ${NANITES_AUTHORING_CHECKOUT_DIR}.`,
    `- If the checkout already exists, call git.pull or git.fetch inside execute before reading Nanite authoring files.`,
    "- Do not run shell git commands; execute is Worker-compatible JavaScript with git.* provider functions.",
    "- If refresh fails because of access, network, or dirty checkout state, continue from the best available evidence and mention the limitation.",
    "",
    "Tracked Nanite authoring reference paths to review before creating or updating Nanites:",
    ...NANITES_AUTHORING_REFERENCE_PATHS.map(
      (path) => `- ${NANITES_AUTHORING_CHECKOUT_DIR}/${path}`,
    ),
  ].join("\n");
}
