import { getLogger } from "@logtape/logtape";
import { Hono } from "hono";
import { createWebMiddleware, Webhooks } from "@octokit/webhooks";
import type { WorkerHonoEnv } from "#/backend/api/apps.ts";
import { AppError } from "#/backend/errors.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import { dispatchGitHubWebhookToNaniteManager } from "#/backend/agents/SigveloNaniteManager.ts";
import { getGitHubChatIngress } from "#/backend/agents/SigveloChatIngress.ts";
import {
  GITHUB_WEBHOOK_PATH,
  getGitHubWebhookAction,
  getGitHubWebhookEventName,
  getGitHubWebhookInstallationId,
  getGitHubWebhookRepositoryFullName,
  getGitHubWebhookRepositoryId,
} from "#/github.ts";

const githubWebhookLogger = getLogger(LOGGING.SERVER_CATEGORY)
  .getChild("github")
  .with({
    [OTEL_ATTRS.PROCESS_RUNTIME_NAME]: LOGGING.WORKER_RUNTIME,
  });

export const githubWebhookRoutes = new Hono<WorkerHonoEnv>().post(
  GITHUB_WEBHOOK_PATH,
  async (context) => {
    if (context.req.header("x-github-event") === "ping") {
      return context.text("pong");
    }

    // Clone before createWebMiddleware consumes the body for signature verification,
    // so the chat ingress can run its own verification on the original payload.
    const chatRequest = context.req.raw.clone();
    const webhooks = new Webhooks({ secret: context.env.GITHUB_WEBHOOK_SECRET });

    webhooks.onAny((event) => {
      githubWebhookLogger.info(LOG_EVENTS.GITHUB_WEBHOOK_RECEIVED, {
        [OTEL_ATTRS.GITHUB_INSTALLATION_ID]: getGitHubWebhookInstallationId(event),
        [OTEL_ATTRS.GITHUB_REPOSITORY_FULL_NAME]: getGitHubWebhookRepositoryFullName(event),
        [OTEL_ATTRS.GITHUB_WEBHOOK_DELIVERY_ID]: event.id,
        [OTEL_ATTRS.GITHUB_WEBHOOK_EVENT_NAME]: event.name,
        [OTEL_ATTRS.GITHUB_WEBHOOK_EVENT_ACTION]: getGitHubWebhookAction(event),
        repositoryId: getGitHubWebhookRepositoryId(event),
      });

      const eventName = getGitHubWebhookEventName(event);
      if (
        eventName === "issue_comment" ||
        eventName.startsWith("issue_comment.") ||
        eventName === "pull_request_review_comment" ||
        eventName.startsWith("pull_request_review_comment.")
      ) {
        context.executionCtx.waitUntil(
          (async () => {
            const ingress = await getGitHubChatIngress(context.env);
            const response = await ingress.fetch(chatRequest.url, {
              method: chatRequest.method,
              headers: chatRequest.headers,
              body: await chatRequest.arrayBuffer(),
            });
            if (!response.ok) {
              const responseText = await response.text();
              throw new AppError("githubWebhookChatIngressFailed", {
                details: {
                  githubResponseStatus: response.status,
                  githubResponseText: responseText,
                },
                message: `GitHub chat ingress failed: ${response.status} ${responseText}`,
              });
            }
          })(),
        );
        return;
      }

      context.executionCtx.waitUntil(
        (async () => {
          const githubInstallationId = getGitHubWebhookInstallationId(event);
          if (typeof githubInstallationId !== "number") {
            throw new AppError("githubWebhookInstallationRequired", {
              details: { githubWebhookEventName: event.name },
              message: `GitHub ${event.name} webhook is missing installation.id.`,
            });
          }
          await dispatchGitHubWebhookToNaniteManager({
            env: context.env,
            event,
            githubInstallationId,
          });
        })(),
      );
    });

    const response = await createWebMiddleware(webhooks, { path: GITHUB_WEBHOOK_PATH })(
      context.req.raw,
    );
    return response.ok ? context.text("ok") : response;
  },
);
