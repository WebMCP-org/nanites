import { GITHUB_WEBHOOK_PATH, GITHUB_WEBHOOK_TARGET_ID_HEADER } from "#/shared/constants.ts";
import { getLogger } from "@logtape/logtape";
import { Hono } from "hono";
import { createWebMiddleware, Webhooks } from "@octokit/webhooks";
import { getAgentByName } from "agents";
import type { WorkerHonoEnv } from "#/backend/api/apps.ts";
import { AppError } from "#/backend/errors.ts";
import { requireDeploymentGitHubInstallation } from "#/backend/auth/installations.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import { dispatchGitHubWebhookToNaniteManager } from "#/backend/agents/SigveloNaniteManager.ts";
import {
  buildGitHubManagerMessengerName,
  type SigveloManagerConversationAgent,
} from "#/backend/agents/SigveloManagerConversationAgent.ts";
import { requireDeploymentGitHubApp } from "#/backend/github/apps.ts";
import {
  getGitHubWebhookAction,
  getGitHubWebhookEventName,
  getGitHubWebhookInstallationId,
  getGitHubWebhookRepositoryFullName,
  getGitHubWebhookRepositoryId,
} from "#/shared/utils/github.ts";

const githubWebhookLogger = getLogger(LOGGING.SERVER_CATEGORY)
  .getChild("github")
  .with({
    [OTEL_ATTRS.PROCESS_RUNTIME_NAME]: LOGGING.WORKER_RUNTIME,
  });

/**
 * GitHub stamps every app webhook delivery with the owning app's id. The
 * header only selects which app's webhook secret verifies the delivery — the
 * HMAC signature remains the authentication gate.
 */
function readGitHubWebhookTargetAppId(request: Request): number | null {
  const targetType = request.headers.get("x-github-hook-installation-target-type");
  if (targetType !== null && targetType !== "integration") {
    return null;
  }

  const rawTargetId = request.headers.get(GITHUB_WEBHOOK_TARGET_ID_HEADER);
  const targetId = Number(rawTargetId);
  return rawTargetId && Number.isInteger(targetId) && targetId > 0 ? targetId : null;
}

export const githubWebhookRoutes = new Hono<WorkerHonoEnv>().post(
  GITHUB_WEBHOOK_PATH,
  async (context) => {
    // Clone before createWebMiddleware consumes the body; the GitHub messenger
    // still needs the original signed webhook request.
    const chatRequest = context.req.raw.clone();
    const isPing = context.req.header("x-github-event") === "ping";
    const githubAppId = readGitHubWebhookTargetAppId(context.req.raw);
    const githubAppConfig = requireDeploymentGitHubApp(context.env);
    if (githubAppId === null || githubAppId !== githubAppConfig.appId) {
      return context.text("Unknown GitHub App for this deployment.", 401);
    }
    const webhooks = new Webhooks({ secret: githubAppConfig.webhookSecret });

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
      if (eventName === "ping") {
        return;
      }
      // ponytail: installation repair/re-provision is the external provisioner's job, not runtime's
      if (
        eventName === "issue_comment" ||
        eventName.startsWith("issue_comment.") ||
        eventName === "pull_request_review_comment" ||
        eventName.startsWith("pull_request_review_comment.")
      ) {
        context.executionCtx.waitUntil(
          (async () => {
            const githubInstallationId = getGitHubWebhookInstallationId(event);
            const deploymentInstallation = await requireDeploymentGitHubInstallation(context.env);
            if (
              typeof githubInstallationId !== "number" ||
              githubInstallationId !== deploymentInstallation.githubInstallationId ||
              githubAppId !== deploymentInstallation.githubAppId
            ) {
              throw new AppError("managerConversationInstallationMismatch", {
                details: { githubAppId, githubInstallationId },
              });
            }
            const conversation = await getAgentByName<Env, SigveloManagerConversationAgent>(
              context.env.SigveloManagerConversationAgent,
              buildGitHubManagerMessengerName({
                managerName: deploymentInstallation.managerName,
                githubAppId,
                githubAppSlug: githubAppConfig.slug,
              }),
            );
            const messengerUrl = new URL("/messengers/github/webhook", chatRequest.url);
            const response = await conversation.fetch(messengerUrl.toString(), {
              method: chatRequest.method,
              headers: chatRequest.headers,
              body: await chatRequest.arrayBuffer(),
            });
            if (!response.ok) {
              const responseText = await response.text();
              throw new AppError("githubWebhookMessengerFailed", {
                details: {
                  githubResponseStatus: response.status,
                  githubResponseText: responseText,
                },
                message: `GitHub messenger delivery failed: ${response.status} ${responseText}`,
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
    if (!response.ok) {
      return response;
    }

    return isPing ? context.text("pong") : context.text("ok");
  },
);
