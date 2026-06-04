import { Think, Workspace } from "@cloudflare/think";
import type { Session, ThinkSubmissionInspection, ThinkSubmissionStatus } from "@cloudflare/think";
import { createExecuteTool } from "@cloudflare/think/tools/execute";
import { createWorkspaceTools } from "@cloudflare/think/tools/workspace";
import { createWorkspaceStateBackend } from "@cloudflare/shell";
import { callable, getAgentByName } from "agents";
import type { LanguageModel, ToolSet, UIMessage } from "ai";
import { AppError } from "#/backend/errors.ts";
import {
  issueScopedGitHubInstallationToken,
  type GitHubInstallationRepository,
  listReposAccessibleToInstallation,
} from "#/backend/github/index.ts";
import type { SigveloChatIngress } from "#/backend/agents/SigveloChatIngress.ts";
import { gitToolsWithGitHubInstallationAuth } from "#/backend/nanites/git-auth.ts";
import { sigveloMcpAuthPropsSchema, type SigveloMcpAuthProps } from "#/backend/mcp/index.ts";
import { createSigveloAgentLanguageModel } from "#/backend/nanites/language-model.ts";
import { createSigveloThinkTools } from "#/backend/nanites/tools/index.ts";
import {
  getGitHubManagerChatThreadType,
  type HandleManagerChatMessageInput,
} from "#/backend/agents/SigveloNaniteManager.ts";
import { MCP_SCOPES } from "#/mcp.ts";
import { buildNaniteManagerKey } from "#/nanites.ts";

const SIGVELO_MANAGER_CHAT_CLIENT_ID = "sigvelo-github-manager-chat";
const GITHUB_MCP_SERVER_NAME = "github";
const GITHUB_MCP_SERVER_URL = "https://api.githubcopilot.com/mcp/";
const STALE_MANAGER_SUBMISSION_AGE_MS = 120_000;
const NANITES_AUTHORING_REPOSITORY = "WebMCP-org/nanites";
const NANITES_AUTHORING_REPOSITORY_URL = `https://github.com/${NANITES_AUTHORING_REPOSITORY}`;
const NANITES_AUTHORING_CHECKOUT_DIR = "/repos/WebMCP-org/nanites";
const NANITES_AUTHORING_REFERENCE_PATHS = [
  "plugins/nanites/skills/nanites/SKILL.md",
  "plugins/nanites/skills/nanites/references/authoring.md",
  "plugins/nanites/skills/nanites/references/operations.md",
  "plugins/nanites/assets/examples/",
] as const;

const TERMINAL_SUBMISSION_STATUSES = new Set<ThinkSubmissionStatus>([
  "completed",
  "aborted",
  "skipped",
  "error",
]);

function shouldConnectGitHubMcp(env: Env): boolean {
  return String(env.MANAGER_CONVERSATION_DISABLE_GITHUB_MCP) !== "true";
}

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
  startedAt: number;
  statusMessageId: string;
  submissionId: string;
  threadId: string;
  userMessageId: string;
};

export type ManagerBrowserSessionInput = {
  managerName: string;
  githubInstallationId: number;
  accountLogin: string;
  actor: {
    id: number;
    login: string;
  };
};

type DisconnectedManagerConversationState = {
  status: "disconnected";
  repositories: GitHubInstallationRepository[];
};

type ConnectedManagerConversationState = {
  status: "connected";
  managerName: string;
  githubInstallationId: number;
  githubAccountLogin: string;
  sigveloToolAuthProps: SigveloMcpAuthProps;
  repositories: GitHubInstallationRepository[];
  connectedAt: string;
};

type ManagerConversationState =
  | DisconnectedManagerConversationState
  | ConnectedManagerConversationState;

export class SigveloManagerConversationAgent extends Think<Env, ManagerConversationState> {
  initialState: ManagerConversationState = {
    status: "disconnected",
    repositories: [],
  };
  override maxSteps = 1000;
  override waitForMcpConnections = { timeout: 10_000 };
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

  override configureSession(session: Session): Session {
    return session
      .withContext("manager_installation_context", {
        description:
          "Selected GitHub installation, account, and repository grounding for the Sigvelo installation manager.",
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

  override getTools(): ToolSet {
    const workspaceTools = createWorkspaceTools(this.workspace);

    return {
      ...workspaceTools,
      ...createSigveloThinkTools({
        env: this.env,
        getProps: () =>
          this.state.status === "connected" ? this.state.sigveloToolAuthProps : null,
      }),
      execute: createExecuteTool({
        tools: workspaceTools,
        state: createWorkspaceStateBackend(this.workspace),
        providers: [this.createGitToolProvider()],
        loader: this.env.LOADER,
      }),
    };
  }

  @callable()
  async connectBrowserInstallation(
    input: ManagerBrowserSessionInput,
  ): Promise<{ connected: true }> {
    const props = createSigveloToolAuthPropsFromBrowser(input);
    await this.ensureSigveloToolsConnected(props, requireSelectedGitHubAccount(input.accountLogin));
    return { connected: true };
  }

  async connectSigveloTools(input: HandleManagerChatMessageInput): Promise<void> {
    const props = createSigveloToolAuthProps(input);
    await this.ensureSigveloToolsConnected(props, getRepositoryOwner(input.surface.raw.repository));
  }

  private async ensureSigveloToolsConnected(props: SigveloMcpAuthProps, accountLogin: string) {
    await this.ensureGitHubMcpConnected(props, accountLogin);
  }

  private async ensureGitHubMcpConnected(props: SigveloMcpAuthProps, accountLogin: string) {
    const repositories = await listReposAccessibleToInstallation({
      env: this.env,
      githubInstallationId: props.githubInstallationId,
    });
    this.setState({
      status: "connected",
      managerName: buildNaniteManagerKey(props.githubInstallationId),
      githubInstallationId: props.githubInstallationId,
      githubAccountLogin: accountLogin,
      sigveloToolAuthProps: props,
      repositories,
      connectedAt: new Date().toISOString(),
    });
    if (repositories.length === 0) {
      return;
    }
    if (!shouldConnectGitHubMcp(this.env)) {
      return;
    }

    await this.removeGitHubMcpServers();
    const scopedToken = await issueScopedGitHubInstallationToken({
      env: this.env,
      installationId: props.githubInstallationId,
      repositories: repositories.map((repository) => repository.full_name).sort(),
    });
    await this.addMcpServer(GITHUB_MCP_SERVER_NAME, GITHUB_MCP_SERVER_URL, {
      transport: {
        type: "streamable-http",
        headers: {
          Authorization: `Bearer ${scopedToken.token}`,
        },
      },
      retry: {
        maxAttempts: 2,
        baseDelayMs: 500,
        maxDelayMs: 2_000,
      },
    });
  }

  private async removeGitHubMcpServers(): Promise<void> {
    const servers = this.getMcpServers().servers;
    await Promise.all(
      Object.entries(servers)
        .filter(([, server]) => server.name === GITHUB_MCP_SERVER_NAME)
        .map(([serverId]) => this.removeMcpServer(serverId)),
    );
  }

  private formatInstallationContext(): string {
    const context = this.state;
    if (context.status === "disconnected") {
      return [
        "No GitHub installation has been connected for this manager conversation yet.",
        "If the human asks about repositories or Nanites, first inspect Sigvelo manager state and connected MCP tools before asking for missing names.",
      ].join("\n");
    }

    return [
      `Selected GitHub account: ${context.githubAccountLogin}`,
      `Selected GitHub installation id: ${context.githubInstallationId}`,
      `Manager name: ${context.managerName}`,
      `Connected at: ${context.connectedAt}`,
      "",
      "Accessible repositories in this installation:",
      ...context.repositories.map((repository) => `- ${repository.full_name}`).sort(),
      "",
      "Operating rule: assume user references such as 'my org', 'this org', 'the package repo', and 'the docs repo' refer to this selected installation unless they explicitly name another account.",
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
    publication?: ManagerReplyPublication,
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

  return sigveloMcpAuthPropsSchema.parse({
    authKind: "mcp",
    githubUserId: Number(input.author.userId),
    githubLogin: input.author.userName,
    githubInstallationId: installationId,
    clientId: SIGVELO_MANAGER_CHAT_CLIENT_ID,
    scopes: [MCP_SCOPES.read, MCP_SCOPES.write],
    authorizedAt: new Date().toISOString(),
  });
}

function createSigveloToolAuthPropsFromBrowser(
  input: ManagerBrowserSessionInput,
): SigveloMcpAuthProps {
  requireSelectedGitHubAccount(input.accountLogin);
  const installationId = input.githubInstallationId;
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new AppError("managerConversationInstallationRequired");
  }
  if (input.managerName !== buildNaniteManagerKey(installationId)) {
    throw new AppError("managerConversationInstallationMismatch");
  }

  const props = {
    authKind: "mcp",
    githubUserId: input.actor.id,
    githubLogin: input.actor.login,
    githubInstallationId: installationId,
    clientId: SIGVELO_MANAGER_CHAT_CLIENT_ID,
    scopes: [MCP_SCOPES.read, MCP_SCOPES.write],
    authorizedAt: new Date().toISOString(),
  };

  return sigveloMcpAuthPropsSchema.parse(props);
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
    "You are the Sigvelo Installation Manager.",
    "You operate inside the currently selected GitHub installation. Treat that selected installation/account as the user's current org unless they explicitly ask to switch.",
    "As Installation Manager, you have broad GitHub MCP access for the selected installation, bounded by the GitHub App installation and accessible repository list.",
    "Use Sigvelo manager tools for control-plane work: inspect Nanites, create or update Nanites, deprovision Nanites, start manual runs, cancel runs, and inspect Nanite workspaces.",
    "Use GitHub MCP tools to investigate repositories, repo instructions, branches, commits, pull requests, issues, and workflow/check state before creating or updating Nanites. You may create pull requests only when that is the user's explicit request or the coherent review surface for the manager's work.",
    "Use built-in workspace tools for repository file review: read, list, grep, find, write, edit, delete, and execute with git.* for clone, fetch, pull, branch, commit, and push work.",
    "For repository file contents, repo-local instructions, and Nanite authoring references, prefer the durable workspace checkout over GitHub MCP so evidence stays inspectable in the manager workspace.",
    `Before creating or updating Nanites, try to refresh the Nanites authoring repo ${NANITES_AUTHORING_REPOSITORY}: clone ${NANITES_AUTHORING_REPOSITORY_URL} into ${NANITES_AUTHORING_CHECKOUT_DIR} if missing, otherwise pull or fetch the latest default branch there.`,
    `After refreshing ${NANITES_AUTHORING_REPOSITORY}, review the Nanites skill and authoring references at ${NANITES_AUTHORING_REFERENCE_PATHS.join(", ")} before drafting manifests, generated triggers, or capability choices.`,
    "If the Nanites authoring repo refresh fails because of access, network, or a dirty checkout, do not get stuck: use the best available GitHub MCP evidence and explain the limitation briefly.",
    'When creating a Nanite, define a constrained Nanite Capability: repositories plus the GitHub MCP tier or tool allowlist needed by that runtime. Sigvelo derives the minimum GitHub App token permissions for the Nanite. Declare permissions.github.appPermissions only for extra non-MCP repository operations, such as contents: "write" when the Nanite will edit files, commit, or push branches.',
    "When the user says 'my org', 'this org', 'the package repo', or 'the docs repo', resolve that against the selected installation's account and accessible repository list before asking them for names.",
    "Do not ask which GitHub org to use when the selected installation account is known. Ask only if the user's target is genuinely outside the selected installation or multiple matching repos remain after inspection.",
    "When starting a manual Nanite run, use sigvelo_start_nanite_run.",
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
    `- If ${NANITES_AUTHORING_CHECKOUT_DIR}/.git/config is missing, clone the repository into ${NANITES_AUTHORING_CHECKOUT_DIR}.`,
    `- If the checkout already exists, pull or fetch the latest default branch before reading Nanite authoring files.`,
    "- If refresh fails because of access, network, or dirty checkout state, continue from the best available evidence and mention the limitation.",
    "",
    "Nanite skill and reference paths to review before creating or updating Nanites:",
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
    startedAt: publication.startedAt,
    statusMessageId: publication.statusMessageId,
    submissionId: publication.submissionId,
    threadId: publication.threadId,
    userMessageId: publication.userMessageId,
  };
}
