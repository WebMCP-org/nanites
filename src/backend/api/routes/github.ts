import {
  GITHUB_WEBHOOK_PATH,
  GITHUB_WEBHOOK_TARGET_ID_HEADER,
  NANITES_SETUP_AGENT_INSTANCE_NAME,
} from "#/shared/constants.ts";
import { getLogger } from "@logtape/logtape";
import { Hono } from "hono";
import { createWebMiddleware, Webhooks } from "@octokit/webhooks";
import { getAgentByName } from "agents";
import type { WorkerHonoEnv } from "#/backend/api/apps.ts";
import { AppError } from "#/backend/errors.ts";
import { LOG_EVENTS, LOGGING, OTEL_ATTRS } from "#/backend/logging.ts";
import { dispatchGitHubWebhookToNaniteManager } from "#/backend/agents/SigveloNaniteManager.ts";
import type {
  GitHubInstallationRepairReason,
  NanitesSetupAgent,
} from "#/backend/agents/NanitesSetupAgent.ts";
import { getGitHubChatIngress } from "#/backend/agents/SigveloChatIngress.ts";
import { createDbClient } from "#/backend/db/index.ts";
import { recordAuthFunnelFact } from "#/backend/db/facts.ts";
import { resolveGitHubApp } from "#/backend/github/apps.ts";
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

function readGitHubInstallationRepairReason(
  eventName: string,
): GitHubInstallationRepairReason | null {
  switch (eventName) {
    case "installation.deleted":
      return "installation_deleted";
    case "installation.suspend":
      return "installation_suspended";
    case "installation_repositories.removed":
      return "installation_repositories_removed";
    case "installation.new_permissions_accepted":
      return "installation_permissions_changed";
    default:
      return null;
  }
}

async function recordGitHubInstallationRepairSignal({
  env,
  githubAppId,
  githubInstallationId,
  reason,
}: {
  readonly env: Env;
  readonly githubAppId: number;
  readonly githubInstallationId: number;
  readonly reason: GitHubInstallationRepairReason;
}): Promise<void> {
  const setupAgent = await getAgentByName<Env, NanitesSetupAgent>(
    env.NanitesSetupAgent,
    NANITES_SETUP_AGENT_INSTANCE_NAME,
  );

  await setupAgent.recordInstallationRepair({
    githubAppId,
    githubInstallationId,
    reason,
  });
}

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
    // Clone before createWebMiddleware consumes the body for signature verification,
    // so the chat ingress can run its own verification on the original payload.
    const chatRequest = context.req.raw.clone();
    const isPing = context.req.header("x-github-event") === "ping";
    const db = createDbClient(context.env.DB);
    const githubAppId = readGitHubWebhookTargetAppId(context.req.raw);
    const githubAppConfig =
      githubAppId === null ? null : await resolveGitHubApp(db, context.env, githubAppId);
    if (githubAppId === null || !githubAppConfig) {
      context.executionCtx.waitUntil(
        recordAuthFunnelFact(db, {
          eventType: "github_webhook_rejected_unknown_app",
          metadata: { githubAppId },
        }),
      );
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
      const repairReason = readGitHubInstallationRepairReason(eventName);
      if (repairReason) {
        const githubInstallationId = getGitHubWebhookInstallationId(event);
        if (typeof githubInstallationId === "number") {
          context.executionCtx.waitUntil(
            recordGitHubInstallationRepairSignal({
              env: context.env,
              githubAppId,
              githubInstallationId,
              reason: repairReason,
            }),
          );
        }
        return;
      }
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
            githubAppId,
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
