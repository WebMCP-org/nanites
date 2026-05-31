import { createGitHubAdapter } from "@chat-adapter/github";
import type { GitHubAdapter, GitHubRawMessage } from "@chat-adapter/github";
import { Agent, getAgentByName } from "agents";
import { githubInstallationIdSchema } from "@nanites/contracts/ids";
import { createChatSdkState } from "agents/chat-sdk";
import { Chat } from "chat";
import type { Message, SentMessage, Thread } from "chat";
import type { HandleManagerChatMessageInput } from "#/backend/nanites/host.ts";
import { SigveloManagerConversationAgent } from "#/backend/manager-conversation-agent.ts";
import { GITHUB_WEBHOOK_PATH } from "#/shared/constants/routes.ts";
import { buildNaniteManagerKey } from "#/shared/nanites.ts";

const SIGVELO_GITHUB_BOT_USERNAME = "sigvelo";
const MANAGER_REPLY_POLL_INTERVAL_SECONDS = 2;
const MANAGER_REPLY_TIMEOUT_MS = 120_000;

export type ManagerReplyPublication = {
  conversationName: string;
  startedAt: number;
  statusMessageId: string;
  submissionId: string;
  threadId: string;
  userMessageId: string;
};

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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function setupErrorResponse(error: Error): Response {
  return new Response(`Sigvelo chat ingress is not configured: ${error.message}`, {
    status: 500,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function getGitHubThreadType(
  raw: GitHubRawMessage,
): HandleManagerChatMessageInput["surface"]["threadType"] {
  if (raw.type === "review_comment") {
    return "review_comment";
  }

  return raw.threadType ?? "pr";
}

export class SigveloChatIngress extends Agent<Env> {
  private runtime: ChatIngressRuntimeState = { status: "not_started" };

  onStart(): void {
    try {
      this.runtime = this.createRuntime();
    } catch (error) {
      this.runtime = { status: "failed", error: toError(error) };
    }
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== GITHUB_WEBHOOK_PATH) {
      return new Response("Not found", { status: 404 });
    }

    const bot = this.getBot();
    if (bot instanceof Error) {
      return setupErrorResponse(bot);
    }

    return bot.webhooks.github(request, {
      waitUntil: (task: Promise<unknown>) => this.ctx.waitUntil(task),
    });
  }

  private createRuntime(): ChatIngressRuntimeState {
    const github = createGitHubAdapter({
      appId: this.env.GITHUB_APP_ID,
      privateKey: this.env.GITHUB_APP_PRIVATE_KEY,
      webhookSecret: this.env.GITHUB_WEBHOOK_SECRET,
      userName: SIGVELO_GITHUB_BOT_USERNAME,
    });

    const bot = new Chat({
      userName: SIGVELO_GITHUB_BOT_USERNAME,
      adapters: { github },
      state: createChatSdkState(),
      concurrency: { strategy: "burst", debounceMs: 600 },
    });

    bot.onNewMention(async (thread, message) => {
      await this.acceptManagerRequest(thread, message);
    });

    bot.onSubscribedMessage(async (thread, message) => {
      await this.acceptManagerRequest(thread, message);
    });

    return {
      status: "ready",
      bot: bot.registerSingleton(),
      github,
    };
  }

  private async acceptManagerRequest(thread: Thread, message: Message): Promise<void> {
    await thread.createSentMessageFromMessage(message).addReaction("eyes");
    this.ctx.waitUntil(
      thread.subscribe().catch((error: unknown) => {
        console.error("github_manager_conversation.subscribe_failed", {
          error: toError(error).message,
          threadId: thread.id,
          messageId: message.id,
        });
      }),
    );
    const statusMessage = await thread.post(
      "Sigvelo manager accepted this message and is queueing a Think turn.",
    );
    await this.enqueueManagerRequest(thread, message, statusMessage);
  }

  private async enqueueManagerRequest(
    thread: Thread,
    message: Message,
    statusMessage: SentMessage,
  ): Promise<void> {
    let managerName: string | undefined;
    try {
      const managerMessage = await this.createManagerMessage(thread, message);
      managerName = buildNaniteManagerKey(managerMessage.installationId);
      const conversation = await getAgentByName<Env, SigveloManagerConversationAgent>(
        this.env.SigveloManagerConversationAgent,
        managerConversationName(thread, message),
      );
      const acceptance = await conversation.answerGitHubMessage(managerMessage, {
        conversationName: managerConversationName(thread, message),
        startedAt: Date.now(),
        statusMessageId: statusMessage.id,
        threadId: thread.id,
      });
      if (acceptance.status !== "pending" && acceptance.status !== "running") {
        await this.publishManagerReply({
          conversationName: managerConversationName(thread, message),
          startedAt: Date.now(),
          statusMessageId: statusMessage.id,
          submissionId: acceptance.submissionId,
          threadId: thread.id,
          userMessageId: acceptance.userMessageId,
        });
      }
    } catch (error) {
      console.error("github_manager_conversation.failed", {
        error: toError(error).message,
        threadId: thread.id,
        messageId: message.id,
        managerName,
      });
      await thread.post(
        "Sigvelo manager accepted the message, but the manager Think turn could not be queued.",
      );
    }
  }

  async publishManagerReply(input: ManagerReplyPublication): Promise<void> {
    try {
      await this.publishManagerReplyOnce(input);
    } catch (error) {
      console.error("github_manager_conversation.publish_failed", {
        error: toError(error).message,
        submissionId: input.submissionId,
        threadId: input.threadId,
        statusMessageId: input.statusMessageId,
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
      await this.editStatusMessage(input, `Sigvelo manager turn failed: ${reply.error}`);
      return;
    }

    if (Date.now() - input.startedAt >= MANAGER_REPLY_TIMEOUT_MS) {
      console.error("github_manager_conversation.reply_timeout", {
        submissionId: input.submissionId,
        threadId: input.threadId,
        userMessageId: input.userMessageId,
        lastStatus: reply.submissionStatus,
      });
      await this.editStatusMessage(
        input,
        `Sigvelo manager turn is still running. Submission: \`${input.submissionId}\`.`,
      );
      return;
    }

    await this.schedule(MANAGER_REPLY_POLL_INTERVAL_SECONDS, "publishManagerReply", input);
  }

  private async editStatusMessage(input: ManagerReplyPublication, text: string): Promise<void> {
    const bot = this.getBot();
    if (bot instanceof Error) {
      throw bot;
    }

    const thread = bot.thread(input.threadId);
    await thread.refresh();
    const message = thread.recentMessages.find((recent) => recent.id === input.statusMessageId);
    if (!message) {
      console.error("github_manager_conversation.status_message_not_found", {
        threadId: input.threadId,
        statusMessageId: input.statusMessageId,
        submissionId: input.submissionId,
      });
      await thread.post(text);
      return;
    }

    await thread.createSentMessageFromMessage(message).edit(text);
  }

  private async createManagerMessage(
    thread: Thread,
    message: Message,
  ): Promise<HandleManagerChatMessageInput> {
    const raw = message.raw as GitHubRawMessage;
    const github = this.getGitHubAdapter();
    const installationId = githubInstallationIdSchema.parse(await github.getInstallationId(thread));

    return {
      installationId,
      surface: {
        type: "github",
        threadId: thread.id,
        messageId: message.id,
        repository: raw.repository.full_name,
        prNumber: raw.prNumber,
        threadType: getGitHubThreadType(raw),
      },
      author: {
        userId: message.author.userId,
        userName: message.author.userName,
        isBot: message.author.isBot,
      },
      text: message.text,
    };
  }

  private getGitHubAdapter(): GitHubAdapter {
    if (this.runtime.status !== "ready") {
      throw this.getRuntimeError();
    }

    return this.runtime.github;
  }

  private getBot(): Chat | Error {
    if (this.runtime.status === "ready") {
      return this.runtime.bot;
    }

    return this.getRuntimeError();
  }

  private getRuntimeError(): Error {
    if (this.runtime.status === "failed") {
      return this.runtime.error;
    }

    return new Error("Chat SDK runtime was not created during Agent startup.");
  }
}

function managerConversationName(thread: Thread, message: Message): string {
  return `github-manager-chat-v4:${thread.id}:user:${message.author.userId}`;
}
