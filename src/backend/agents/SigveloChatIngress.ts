import { createGitHubAdapter } from "@chat-adapter/github";
import type { GitHubAdapter, GitHubRawMessage } from "@chat-adapter/github";
import { ThinkMessengerStateAgent } from "@cloudflare/think/messengers";
import { getLogger } from "@logtape/logtape";
import { Agent, getAgentByName } from "agents";
import { createChatSdkState } from "agents/chat-sdk";
import { Chat } from "chat";
import type { Author, Message, SentMessage, Thread } from "chat";
import { APP_ERRORS, AppError, describeError } from "#/backend/errors.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import type {
  SigveloManagerConversationAgent,
  ManagerReplyPublication,
} from "#/backend/agents/SigveloManagerConversationAgent.ts";
import { GITHUB_WEBHOOK_PATH, GITHUB_WEBHOOK_TARGET_ID_HEADER } from "#/github.ts";
import { buildNaniteManagerKey } from "#/nanites.ts";
import { createDbClient } from "#/backend/db/index.ts";
import { requireGitHubApp } from "#/backend/github/apps.ts";

const MANAGER_REPLY_POLL_INTERVAL_SECONDS = 2;
const MANAGER_REPLY_TIMEOUT_MS = 120_000;
const chatIngressLogger = getLogger(LOGGING.NANITES_CATEGORY)
  .getChild("chat_ingress")
  .with({
    [OTEL_ATTRS.PROCESS_RUNTIME_NAME]: LOGGING.WORKER_RUNTIME,
    [OTEL_ATTRS.AGENT_CLASS]: "SigveloChatIngress",
  });

// Preserve the existing Durable Object/facet class name while adopting the
// upstream Think messenger state implementation.
export class ChatSdkStateAgent extends ThinkMessengerStateAgent {}

export type GitHubManagerThreadType =
  | NonNullable<Extract<GitHubRawMessage, { type: "issue_comment" }>["threadType"]>
  | "review_comment";

export function getGitHubManagerChatThreadType(raw: GitHubRawMessage): GitHubManagerThreadType {
  if (raw.type === "review_comment") {
    return "review_comment";
  }

  return raw.threadType ?? "pr";
}

export type HandleManagerChatMessageInput = {
  githubAppId: number;
  installationId: number;
  surface: {
    type: "github";
    threadId: Thread<Record<string, unknown>, GitHubRawMessage>["id"];
    messageId: Message<GitHubRawMessage>["id"];
    raw: GitHubRawMessage;
  };
  author: Author;
  text: string;
};

type GitHubManagerChatThread = Thread<Record<string, unknown>, GitHubRawMessage>;
type GitHubManagerChatMessage = Message<GitHubRawMessage>;
type UnknownChatThread = Thread<Record<string, unknown>, unknown>;
type UnknownChatMessage = Message<unknown>;

type ChatIngressRuntimeState =
  | {
      status: "not_started";
    }
  | {
      status: "ready";
      bot: Chat;
      github: GitHubAdapter;
    }
  | {
      status: "failed";
      error: Error;
    };

export function getGitHubChatIngress(env: Env): Promise<DurableObjectStub<SigveloChatIngress>> {
  return getAgentByName<Env, SigveloChatIngress>(env.SigveloChatIngress, "default");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function setupErrorResponse(error: AppError): Response {
  return new Response(error.message, {
    status: APP_ERRORS[error.kind].status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function createGitHubConversationLogContext(input: {
  readonly conversationName?: string;
  readonly error?: unknown;
  readonly lastStatus?: string | null;
  readonly managerName?: string;
  readonly messageId?: string;
  readonly statusMessageId?: string;
  readonly submissionId?: string;
  readonly threadId?: string;
  readonly userMessageId?: string;
}) {
  return {
    ...(input.conversationName ? { [OTEL_ATTRS.CONVERSATION_NAME]: input.conversationName } : {}),
    ...(input.error ? { [OTEL_ATTRS.EXCEPTION_MESSAGE]: toError(input.error).message } : {}),
    ...(input.lastStatus ? { lastStatus: input.lastStatus } : {}),
    ...(input.managerName ? { [OTEL_ATTRS.NANITE_MANAGER_NAME]: input.managerName } : {}),
    ...(input.messageId ? { [OTEL_ATTRS.GITHUB_MESSAGE_ID]: input.messageId } : {}),
    ...(input.statusMessageId ? { [OTEL_ATTRS.STATUS_MESSAGE_ID]: input.statusMessageId } : {}),
    ...(input.submissionId ? { [OTEL_ATTRS.SUBMISSION_ID]: input.submissionId } : {}),
    ...(input.threadId ? { [OTEL_ATTRS.GITHUB_THREAD_ID]: input.threadId } : {}),
    ...(input.userMessageId ? { [OTEL_ATTRS.USER_MESSAGE_ID]: input.userMessageId } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGitHubRawMessage(raw: unknown): raw is GitHubRawMessage {
  if (!isRecord(raw) || !isRecord(raw.comment) || !isRecord(raw.repository)) {
    return false;
  }

  return (
    (raw.type === "issue_comment" || raw.type === "review_comment") &&
    typeof raw.prNumber === "number"
  );
}

function readGitHubManagerChatInput(
  thread: UnknownChatThread,
  message: UnknownChatMessage,
): {
  thread: GitHubManagerChatThread;
  message: GitHubManagerChatMessage;
} {
  if (!isGitHubRawMessage(message.raw)) {
    throw new AppError("chatIngressInvalidGitHubMessage");
  }

  return {
    thread: thread as GitHubManagerChatThread,
    message: message as GitHubManagerChatMessage,
  };
}

export class SigveloChatIngress extends Agent<Env> {
  // One Chat runtime per registered GitHub App; the webhook target-id header
  // names which app a delivery belongs to.
  private runtimes = new Map<number, ChatIngressRuntimeState>();
  private runtimePromises = new Map<number, Promise<ChatIngressRuntimeState>>();

  onStart(): void {
    this.runtimes.clear();
    this.runtimePromises.clear();
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== GITHUB_WEBHOOK_PATH) {
      return setupErrorResponse(new AppError("chatIngressNotFound"));
    }

    const rawTargetId = request.headers.get(GITHUB_WEBHOOK_TARGET_ID_HEADER);
    const targetIdNum = Number(rawTargetId);
    const githubAppId =
      rawTargetId && Number.isInteger(targetIdNum) && targetIdNum > 0 ? targetIdNum : null;
    if (githubAppId === null) {
      return setupErrorResponse(new AppError("chatIngressNotFound"));
    }

    const bot = await this.getBot(githubAppId);
    if (bot instanceof Error) {
      return setupErrorResponse(bot);
    }

    return bot.webhooks.github(request, {
      waitUntil: (task: Promise<unknown>) => this.ctx.waitUntil(task),
    });
  }

  private async createRuntime(githubAppId: number): Promise<ChatIngressRuntimeState> {
    const githubAppConfig = await requireGitHubApp(
      createDbClient(this.env.DB),
      this.env,
      githubAppId,
    );
    // The bot acts as this app's GitHub identity, so mention matching keys on
    // the app's own slug rather than a fixed product name.
    const botUserName = githubAppConfig.slug;
    const github = createGitHubAdapter({
      appId: String(githubAppConfig.appId),
      privateKey: githubAppConfig.privateKey,
      webhookSecret: githubAppConfig.webhookSecret,
      userName: botUserName,
    });

    const bot = new Chat({
      userName: botUserName,
      adapters: { github },
      state: createChatSdkState({ agent: ChatSdkStateAgent }),
      concurrency: { strategy: "burst", debounceMs: 600 },
    });

    bot.onNewMention(async (thread, message) => {
      const githubInput = readGitHubManagerChatInput(thread, message);
      await this.acceptManagerRequest(githubAppId, githubInput.thread, githubInput.message);
    });

    bot.onSubscribedMessage(async (thread, message) => {
      const githubInput = readGitHubManagerChatInput(thread, message);
      await this.acceptManagerRequest(githubAppId, githubInput.thread, githubInput.message);
    });

    return {
      status: "ready",
      bot: bot.registerSingleton(),
      github,
    };
  }

  private async getRuntimeState(githubAppId: number): Promise<ChatIngressRuntimeState> {
    const cached = this.runtimes.get(githubAppId);
    if (cached && (cached.status === "ready" || cached.status === "failed")) {
      return cached;
    }

    let pending = this.runtimePromises.get(githubAppId);
    if (!pending) {
      pending = this.createRuntime(githubAppId).catch((error: unknown) => ({
        status: "failed" as const,
        error: toError(error),
      }));
      this.runtimePromises.set(githubAppId, pending);
    }
    const runtime = await pending;
    this.runtimes.set(githubAppId, runtime);
    return runtime;
  }

  private async acceptManagerRequest(
    githubAppId: number,
    thread: GitHubManagerChatThread,
    message: GitHubManagerChatMessage,
  ): Promise<void> {
    await thread.createSentMessageFromMessage(message).addReaction("eyes");
    this.ctx.waitUntil(
      thread.subscribe().catch((error: unknown) => {
        chatIngressLogger.warn(LOG_EVENTS.GITHUB_MANAGER_CONVERSATION_SUBSCRIBE_FAILED, {
          ...createGitHubConversationLogContext({
            error,
            messageId: message.id,
            threadId: thread.id,
          }),
        });
      }),
    );
    const statusMessage = await thread.post(
      "SigVelo manager accepted this message and is queueing a Think turn.",
    );
    await this.enqueueManagerRequest(githubAppId, thread, message, statusMessage);
  }

  private async enqueueManagerRequest(
    githubAppId: number,
    thread: GitHubManagerChatThread,
    message: GitHubManagerChatMessage,
    statusMessage: SentMessage,
  ): Promise<void> {
    let managerName: string | undefined;
    try {
      const managerMessage = await this.createManagerMessage(githubAppId, thread, message);
      managerName = buildNaniteManagerKey({
        githubAppId: managerMessage.githubAppId,
        githubInstallationId: managerMessage.installationId,
      });
      const conversationName = `github-manager-chat-v4:${thread.id}:user:${message.author.userId}`;
      const conversation = await getAgentByName<Env, SigveloManagerConversationAgent>(
        this.env.SigveloManagerConversationAgent,
        conversationName,
      );
      const startedAt = Date.now();
      const userMessageId = `github:${managerMessage.surface.messageId}`;
      const acceptance = await conversation.answerGitHubMessage(managerMessage, {
        conversationName,
        githubAppId,
        startedAt,
        statusMessageId: statusMessage.id,
        submissionId: userMessageId,
        threadId: thread.id,
        userMessageId,
      });
      if (acceptance.status !== "pending" && acceptance.status !== "running") {
        await this.publishManagerReply({
          conversationName,
          githubAppId,
          startedAt,
          statusMessageId: statusMessage.id,
          submissionId: acceptance.submissionId,
          threadId: thread.id,
          userMessageId: acceptance.userMessageId,
        });
      }
    } catch (error) {
      chatIngressLogger.error(LOG_EVENTS.GITHUB_MANAGER_CONVERSATION_FAILED, {
        ...createGitHubConversationLogContext({
          error,
          managerName,
          messageId: message.id,
          threadId: thread.id,
        }),
      });
      await thread.post(
        "SigVelo manager accepted the message, but the manager Think turn could not be queued.",
      );
    }
  }

  async publishManagerReply(input: ManagerReplyPublication): Promise<void> {
    try {
      await this.publishManagerReplyOnce(input);
    } catch (error) {
      chatIngressLogger.error(LOG_EVENTS.GITHUB_MANAGER_CONVERSATION_PUBLISH_FAILED, {
        ...createGitHubConversationLogContext({
          conversationName: input.conversationName,
          error,
          statusMessageId: input.statusMessageId,
          submissionId: input.submissionId,
          threadId: input.threadId,
          userMessageId: input.userMessageId,
        }),
      });
      if (Date.now() - input.startedAt < MANAGER_REPLY_TIMEOUT_MS) {
        await this.schedule(MANAGER_REPLY_POLL_INTERVAL_SECONDS, "publishManagerReply", input);
      }
    }
  }

  private async publishManagerReplyOnce(input: ManagerReplyPublication): Promise<void> {
    const conversation = await getAgentByName<Env, SigveloManagerConversationAgent>(
      this.env.SigveloManagerConversationAgent,
      input.conversationName,
    );
    const reply = await conversation.readGitHubReplyForSubmission({
      submissionId: input.submissionId,
      userMessageId: input.userMessageId,
    });

    if (reply.status === "ready") {
      await this.editStatusMessage(input, reply.text);
      return;
    }

    if (reply.status === "failed") {
      await this.editStatusMessage(input, `SigVelo manager turn failed: ${reply.error}`);
      return;
    }

    if (Date.now() - input.startedAt >= MANAGER_REPLY_TIMEOUT_MS) {
      chatIngressLogger.warn(LOG_EVENTS.GITHUB_MANAGER_CONVERSATION_REPLY_TIMEOUT, {
        ...createGitHubConversationLogContext({
          conversationName: input.conversationName,
          lastStatus: reply.submissionStatus,
          submissionId: input.submissionId,
          threadId: input.threadId,
          userMessageId: input.userMessageId,
        }),
      });
      await this.editStatusMessage(
        input,
        `SigVelo manager turn is still running. Submission: \`${input.submissionId}\`.`,
      );
      return;
    }

    await this.schedule(MANAGER_REPLY_POLL_INTERVAL_SECONDS, "publishManagerReply", input);
  }

  private async editStatusMessage(input: ManagerReplyPublication, text: string): Promise<void> {
    const bot = await this.getBot(input.githubAppId);
    if (bot instanceof Error) {
      throw bot;
    }

    const thread = bot.thread(input.threadId);
    await thread.refresh();
    const message = thread.recentMessages.find((recent) => recent.id === input.statusMessageId);
    if (!message) {
      chatIngressLogger.warn(LOG_EVENTS.GITHUB_MANAGER_CONVERSATION_STATUS_MESSAGE_NOT_FOUND, {
        ...createGitHubConversationLogContext({
          conversationName: input.conversationName,
          statusMessageId: input.statusMessageId,
          submissionId: input.submissionId,
          threadId: input.threadId,
          userMessageId: input.userMessageId,
        }),
      });
      await thread.post(text);
      return;
    }

    await thread.createSentMessageFromMessage(message).edit(text);
  }

  private async createManagerMessage(
    githubAppId: number,
    thread: GitHubManagerChatThread,
    message: GitHubManagerChatMessage,
  ): Promise<HandleManagerChatMessageInput> {
    const github = this.getGitHubAdapter(githubAppId);
    const installationId = await github.getInstallationId(thread);
    if (
      typeof installationId !== "number" ||
      !Number.isInteger(installationId) ||
      installationId <= 0
    ) {
      throw new AppError("chatIngressInstallationRequired");
    }

    return {
      githubAppId,
      installationId,
      surface: {
        type: "github",
        threadId: thread.id,
        messageId: message.id,
        raw: message.raw,
      },
      author: message.author,
      text: message.text,
    };
  }

  private getGitHubAdapter(githubAppId: number): GitHubAdapter {
    const runtime = this.runtimes.get(githubAppId);
    if (!runtime || runtime.status !== "ready") {
      throw this.getRuntimeError(githubAppId);
    }

    return runtime.github;
  }

  private async getBot(githubAppId: number): Promise<Chat | AppError> {
    const runtime = await this.getRuntimeState(githubAppId);
    if (runtime.status === "ready") {
      return runtime.bot;
    }

    return this.getRuntimeError(githubAppId);
  }

  private getRuntimeError(githubAppId: number): AppError {
    const runtime = this.runtimes.get(githubAppId);
    if (runtime?.status === "failed") {
      return new AppError("chatIngressUnavailable", {
        cause: runtime.error,
        message: `${APP_ERRORS.chatIngressUnavailable.message}: ${describeError(runtime.error)}`,
      });
    }

    return new AppError("chatIngressUnavailable", {
      message: `${APP_ERRORS.chatIngressUnavailable.message}: Chat SDK runtime for GitHub App ${githubAppId} was not created.`,
    });
  }
}
