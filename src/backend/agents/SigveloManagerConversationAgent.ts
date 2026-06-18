import { Think, Workspace, skills } from "@cloudflare/think";
import type {
  Session,
  ThinkSubmissionInspection,
  ThinkSubmissionStatus,
  TurnConfig,
} from "@cloudflare/think";
import { createExecuteTool } from "@cloudflare/think/tools/execute";
import { createWorkspaceTools } from "@cloudflare/think/tools/workspace";
import { createWorkspaceStateBackend } from "@cloudflare/shell";
import { ToolProviderConnector } from "#/backend/nanites/tool-provider-connector.ts";
import { GitHubMcpConnector } from "#/backend/nanites/github-mcp-connector.ts";
import nanitesSkills from "agents:skills/../../../plugins/nanites/skills";
import { callable, getAgentByName, getCurrentAgent } from "agents";
import type { Connection, ConnectionContext } from "agents";
import type { LanguageModel, ToolSet, UIMessage } from "ai";
import { AppError } from "#/backend/errors.ts";
import {
  issueScopedGitHubInstallationToken,
  type GitHubInstallationRepository,
  listReposAccessibleToInstallation,
} from "#/backend/github/index.ts";
import {
  getGitHubManagerChatThreadType,
  type HandleManagerChatMessageInput,
  type SigveloChatIngress,
} from "#/backend/agents/SigveloChatIngress.ts";
import { gitToolsWithGitHubInstallationAuth } from "#/backend/nanites/git-auth.ts";
import type { SigveloMcpAuthProps } from "#/backend/mcp/index.ts";
import { createSigveloAgentLanguageModel } from "#/backend/nanites/language-model.ts";
import { createSigveloThinkTools } from "#/backend/nanites/tools/index.ts";
import { MCP_SCOPES } from "#/mcp.ts";
import { buildNaniteManagerKey, parseNaniteManagerKey } from "#/nanites.ts";

const SIGVELO_MANAGER_CHAT_CLIENT_ID = "sigvelo-github-manager-chat";
const STALE_MANAGER_SUBMISSION_AGE_MS = 120_000;
const NANITES_AUTHORING_REPOSITORY = "WebMCP-org/nanites";
const NANITES_AUTHORING_REPOSITORY_URL = `https://github.com/${NANITES_AUTHORING_REPOSITORY}`;
const NANITES_AUTHORING_CHECKOUT_DIR = "/repos/WebMCP-org/nanites";
const NANITES_AUTHORING_REFERENCE_PATHS = [
  "docs/architecture/README.md",
  "docs/architecture/execution-architecture.md",
  "docs/development.md",
  "plugins/nanites/skills/nanites/SKILL.md",
  "plugins/nanites/skills/nanites/references/authoring.md",
  "plugins/nanites/skills/nanites/references/operations.md",
  "plugins/nanites/commands/create-nanite.md",
  "plugins/nanites/commands/write-nanite-trigger.md",
  "plugins/nanites/commands/test-nanite.md",
  "plugins/nanites/assets/examples/",
] as const;

const TERMINAL_SUBMISSION_STATUSES = new Set<ThinkSubmissionStatus>([
  "completed",
  "aborted",
  "skipped",
  "error",
]);

type ManagerGitHubMessageAcceptance = {
  accepted: boolean;
  status: ThinkSubmissionStatus;
  submissionId: string;
  userMessageId: string;
};

type ManagerGitHubReplyStatus =
  | {
      status: "ready";
      text: string;
    }
  | {
      error: string;
      status: "failed";
      submissionStatus: ThinkSubmissionStatus | "missing";
    }
  | {
      status: "pending";
      submissionStatus: ThinkSubmissionStatus | "pending_reply";
    };

export type ManagerReplyPublication = {
  conversationName: string;
  githubAppId: number;
  startedAt: number;
  statusMessageId: string;
  submissionId: string;
  threadId: string;
  userMessageId: string;
};

type DisconnectedManagerConversationState = {
  status: "disconnected";
  repositories: GitHubInstallationRepository[];
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
};

type ManagerConversationState =
  | DisconnectedManagerConversationState
  | ConnectedManagerConversationState;

type BrowserInstallationConnectionAuth = {
  readonly accountLogin: string;
  readonly githubAppId: number;
  readonly githubInstallationId: number;
  readonly githubLogin: string;
  readonly githubUserId: number;
};

type ManagerConversationConnectionState = {
  readonly browserInstallationAuth?: BrowserInstallationConnectionAuth;
};

export class SigveloManagerConversationAgent extends Think<Env, ManagerConversationState> {
  initialState: ManagerConversationState = {
    status: "disconnected",
    repositories: [],
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
    });
  }

  // AI Gateway owns upstream-provider retries (NANITES_AI_GATEWAY_REQUEST_DEFAULTS); cap the AI
  // SDK's own retry so the two layers don't compound. 1 still covers a transient
  // worker→gateway transport blip.
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
      execute: createExecuteTool({
        ctx: this.ctx,
        tools: workspaceTools,
        state: createWorkspaceStateBackend(this.workspace),
        connectors: [
          new ToolProviderConnector(this.ctx, this.createGitToolProvider()),
          ...(githubMcpConnector ? [githubMcpConnector] : []),
        ],
        loader: this.env.LOADER,
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
    const connection = createSigveloToolAuthPropsFromBrowser(this.name);
    await this.ensureGitHubMcpConnected(connection.props, connection.accountLogin);
    return { connected: true };
  }

  async connectSigveloTools(input: HandleManagerChatMessageInput): Promise<void> {
    const props = createSigveloToolAuthProps(input);
    await this.ensureGitHubMcpConnected(props, getRepositoryOwner(input.surface.raw.repository));
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
        githubAppId: props.githubAppId,
        githubInstallationId: props.githubInstallationId,
      }),
      githubAppId: props.githubAppId,
      githubInstallationId: props.githubInstallationId,
      githubAccountLogin: accountLogin,
      sigveloToolAuthProps: props,
      repositories,
      connectedAt: new Date().toISOString(),
    });
  }

  /**
   * Exposes GitHub MCP inside the codemode sandbox as `github.*`, minting a
   * fresh installation token per turn-setup in createHeaders. Broad access:
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
      `Selected GitHub account: ${context.githubAccountLogin}`,
      `Selected GitHub installation id: ${context.githubInstallationId}`,
      `Connected at: ${context.connectedAt}`,
      "",
      "Accessible repositories in this installation:",
      ...context.repositories.map((repository) => `- ${repository.full_name}`).sort(),
      "",
      "Operating rule: assume user references such as 'my org', 'this org', 'the package repo', and 'the docs repo' refer to this selected installation unless they explicitly name another account.",
      "When a request does not name a repository (for example 'create a demo Nanite'), choose from the accessible repositories above — never from the chat user's personal account.",
    ].join("\n");
  }

  async hasManagerSubmission(submissionId: string): Promise<boolean> {
    return (await this.inspectSubmission(submissionId)) !== null;
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

  async answerGitHubMessage(
    input: HandleManagerChatMessageInput,
    publication: ManagerReplyPublication,
  ): Promise<ManagerGitHubMessageAcceptance> {
    await this.connectSigveloTools(input);
    await this.cancelStaleManagerSubmissions();
    const message = toManagerConversationMessage(input);
    const submission = await this.submitMessages([message], {
      submissionId: message.id,
      idempotencyKey: message.id,
      metadata: {
        surface: input.surface.type,
        repository: input.surface.raw.repository.full_name,
        threadId: input.surface.threadId,
        messageId: input.surface.messageId,
        githubReplyPublication: publication,
      },
    });

    return {
      accepted: submission.accepted,
      status: submission.status,
      submissionId: submission.submissionId,
      userMessageId: message.id,
    };
  }

  async readGitHubReplyForSubmission(input: {
    submissionId: string;
    userMessageId: string;
  }): Promise<ManagerGitHubReplyStatus> {
    const submission = await this.inspectSubmission(input.submissionId);
    if (!submission) {
      return {
        status: "failed",
        submissionStatus: "missing",
        error: "Manager submission was not found.",
      };
    }

    if (!TERMINAL_SUBMISSION_STATUSES.has(submission.status)) {
      return { status: "pending", submissionStatus: submission.status };
    }

    if (submission.status !== "completed") {
      return {
        status: "failed",
        submissionStatus: submission.status,
        error: submission.error ?? `Manager submission ended with status ${submission.status}.`,
      };
    }

    const text = extractAssistantReplyAfter(await this.getMessages(), input.userMessageId);
    return text
      ? { status: "ready", text }
      : { status: "pending", submissionStatus: "pending_reply" };
  }

  protected override async onSubmissionStatus(
    submission: ThinkSubmissionInspection,
  ): Promise<void> {
    if (!TERMINAL_SUBMISSION_STATUSES.has(submission.status)) {
      return;
    }

    const publication = parseGitHubReplyPublication(submission.metadata?.githubReplyPublication);
    if (!publication) {
      return;
    }

    const ingress = await getAgentByName<Env, SigveloChatIngress>(
      this.env.SigveloChatIngress,
      "default",
    );
    await ingress.publishManagerReply(publication);
  }

  private async cancelStaleManagerSubmissions(now = Date.now()): Promise<void> {
    const activeSubmissions = await this.listSubmissions({
      status: ["pending", "running"],
      limit: 50,
    });
    await Promise.all(
      activeSubmissions
        .filter((submission) => now - submission.createdAt >= STALE_MANAGER_SUBMISSION_AGE_MS)
        .map((submission) =>
          this.cancelSubmission(
            submission.submissionId,
            "Canceled stale manager conversation turn before accepting a newer GitHub message.",
          ),
        ),
    );
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

function createSigveloToolAuthProps(input: HandleManagerChatMessageInput): SigveloMcpAuthProps {
  const installationId = input.installationId;
  requireSelectedGitHubAccount(getRepositoryOwner(input.surface.raw.repository));
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new AppError("managerConversationInstallationRequired");
  }

  return {
    authKind: "mcp",
    githubUserId: Number(input.author.userId),
    githubLogin: input.author.userName,
    githubAppId: input.githubAppId,
    githubInstallationId: installationId,
    clientId: SIGVELO_MANAGER_CHAT_CLIENT_ID,
    scopes: [MCP_SCOPES.read, MCP_SCOPES.write],
    visibleRepositories: [],
    authorizedAt: new Date().toISOString(),
  } satisfies SigveloMcpAuthProps;
}

function createSigveloToolAuthPropsFromBrowser(conversationName: string): {
  accountLogin: string;
  props: SigveloMcpAuthProps;
} {
  const auth = requireBrowserInstallationConnectionAuth();
  requireBrowserConversationTarget(conversationName, {
    githubAppId: auth.githubAppId,
    githubInstallationId: auth.githubInstallationId,
    githubUserId: auth.githubUserId,
  });

  const props = {
    authKind: "mcp",
    githubUserId: auth.githubUserId,
    githubLogin: auth.githubLogin,
    githubAppId: auth.githubAppId,
    githubInstallationId: auth.githubInstallationId,
    clientId: SIGVELO_MANAGER_CHAT_CLIENT_ID,
    scopes: [MCP_SCOPES.read, MCP_SCOPES.write],
    visibleRepositories: [],
    authorizedAt: new Date().toISOString(),
  } satisfies SigveloMcpAuthProps;

  return {
    accountLogin: requireSelectedGitHubAccount(auth.accountLogin),
    props,
  };
}

function readBrowserInstallationAuthFromHeaders(
  headers: Headers,
): BrowserInstallationConnectionAuth {
  return {
    githubAppId: readPositiveManagerHeader(headers, "x-nanites-active-github-app-id"),
    githubInstallationId: readPositiveManagerHeader(headers, "x-nanites-active-installation-id"),
    githubUserId: readPositiveActorHeader(headers, "x-nanites-github-user-id"),
    githubLogin: readRequiredActorHeader(headers, "x-nanites-github-login"),
    accountLogin: headers.get("x-nanites-installation-account-login") ?? "",
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

function readPositiveManagerHeader(headers: Headers, name: string): number {
  const value = Number(headers.get(name));
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError("managerConversationInstallationRequired");
  }
  return value;
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
    readonly githubAppId: number;
    readonly githubInstallationId: number;
    readonly githubUserId: number;
  },
): void {
  const target = parseBrowserConversationTarget(conversationName);
  const managerName = buildNaniteManagerKey(expected);

  if (
    target.managerName !== managerName ||
    target.identity.githubAppId !== expected.githubAppId ||
    target.identity.githubInstallationId !== expected.githubInstallationId ||
    target.actorId !== expected.githubUserId
  ) {
    throw new AppError("managerConversationInstallationMismatch");
  }
}

function parseBrowserConversationTarget(conversationName: string) {
  const actorSeparator = ":manager:";
  const separatorIndex = conversationName.lastIndexOf(actorSeparator);
  if (separatorIndex <= 0) {
    throw new AppError("managerConversationInstallationMismatch");
  }

  const managerName = conversationName.slice(0, separatorIndex);
  const actorId = Number(conversationName.slice(separatorIndex + actorSeparator.length));
  const identity = parseNaniteManagerKey(managerName);
  if (!identity || !Number.isInteger(actorId)) {
    throw new AppError("managerConversationInstallationMismatch");
  }

  return { actorId, identity, managerName };
}

function requireSelectedGitHubAccount(accountLogin: string): string {
  const trimmed = accountLogin.trim();
  if (!trimmed) {
    throw new AppError("managerConversationAccountRequired");
  }

  return trimmed;
}

function getRepositoryOwner(
  repository: HandleManagerChatMessageInput["surface"]["raw"]["repository"],
): string {
  return requireSelectedGitHubAccount(repository.owner.login);
}

function buildManagerSystemPrompt(): string {
  return [
    "You are the SigVelo Installation Manager.",
    "Use the loaded nanites skill as the source of truth for Nanite authoring, trigger, permission, testing, and debugging rules.",
    "Use manager_installation_context as selected GitHub installation grounding. Treat that selected installation/account as the user's current org unless they explicitly ask to switch.",
    "The signed-in human's personal login (githubLogin from sigvelo_whoami) identifies who you are talking to, not where you work. Never search, target, or create Nanites against that personal account or its repositories unless the user explicitly asks; pick repositories from the accessible repository list in manager_installation_context.",
    "You have broad GitHub access for the selected installation, exposed inside execute as github.* and bounded by the GitHub App installation and accessible repository list. Discover github.* methods with codemode.search/codemode.describe.",
    "Use SigVelo manager tools for control-plane work: inspect Nanites, create or update one Nanite at a time, deprovision one Nanite, start manual runs, cancel runs, and inspect Nanite workspaces.",
    "Use github.* tools inside execute to investigate repositories, repo instructions, branches, commits, pull requests, issues, and workflow/check state before creating or updating Nanites. You may create pull requests only when that is the user's explicit request or the coherent review surface for the manager's work.",
    "Use built-in workspace tools for repository file review and git work. execute runs Worker-compatible JavaScript, not Node.js: require(), child_process, shell subprocesses, and shell git are unavailable. Use state.*, git.*, and github.* APIs directly.",
    "SigVelo manager tools are not exposed as top-level JavaScript functions inside execute. Call explicit SigVelo tools from the Think tool list instead, one Nanite at a time.",
    "For repository file contents, repo-local instructions, and Nanite authoring references, prefer the durable workspace checkout over github.* so evidence stays inspectable in the manager workspace.",
    `Use nanites_authoring_sources to refresh and inspect ${NANITES_AUTHORING_REPOSITORY} in the manager workspace before creating or updating Nanites.`,
    "If the authoring repo refresh fails because of access, network, or a dirty checkout, continue from the best available evidence and mention the limitation briefly.",
    "Resolve phrases like 'my org', 'this org', 'the package repo', or 'the docs repo' against the selected installation account and accessible repository list before asking for names.",
    "Do not ask which GitHub org to use when the selected installation account is known. Ask only if the user's target is genuinely outside the selected installation or multiple matching repos remain after inspection.",
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

function toManagerConversationMessage(input: HandleManagerChatMessageInput): UIMessage {
  const raw = input.surface.raw;
  return {
    id: `github:${input.surface.messageId}`,
    role: "user",
    parts: [
      {
        type: "text",
        text: [
          `GitHub author: @${input.author.userName}`,
          `Repository: ${raw.repository.full_name}`,
          `Thread: ${getGitHubManagerChatThreadType(raw)} #${raw.prNumber}`,
          "",
          input.text,
        ].join("\n"),
      },
    ],
  };
}

function extractAssistantReplyAfter(messages: UIMessage[], userMessageId: string): string | null {
  const userMessageIndex = messages.findIndex((message) => message.id === userMessageId);
  const candidateMessages =
    userMessageIndex >= 0 ? messages.slice(userMessageIndex + 1) : messages.slice();
  const assistantMessage = candidateMessages
    .slice()
    .reverse()
    .find((message) => message.role === "assistant");
  return assistantMessage ? extractUiMessageText(assistantMessage).trim() || null : null;
}

function extractUiMessageText(message: UIMessage): string {
  return message.parts
    .flatMap((part) => {
      if (part.type === "text") {
        return [part.text];
      }
      return [];
    })
    .join("");
}

function parseGitHubReplyPublication(value: unknown): ManagerReplyPublication | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const publication = value as Record<string, unknown>;
  if (
    typeof publication.conversationName !== "string" ||
    typeof publication.githubAppId !== "number" ||
    typeof publication.startedAt !== "number" ||
    typeof publication.statusMessageId !== "string" ||
    typeof publication.submissionId !== "string" ||
    typeof publication.threadId !== "string" ||
    typeof publication.userMessageId !== "string"
  ) {
    return null;
  }

  return {
    conversationName: publication.conversationName,
    githubAppId: publication.githubAppId,
    startedAt: publication.startedAt,
    statusMessageId: publication.statusMessageId,
    submissionId: publication.submissionId,
    threadId: publication.threadId,
    userMessageId: publication.userMessageId,
  };
}
