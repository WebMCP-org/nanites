import { GITHUB_WEBHOOK_PATH } from "#/shared/constants.ts";
import { createExecutionContext, env } from "cloudflare:test";
import worker from "#/server.ts";
import {
  buildTestGitHubWebhookRequest,
  type TestGitHubWebhookPayload,
} from "../helpers/github-webhook.ts";

test("GitHub webhook ping requires the configured app secret and a valid signature", async () => {
  const body = JSON.stringify({
    zen: "Approachable is better than simple.",
    hook_id: 123,
    hook: {
      id: 123,
      type: "App",
      active: true,
      events: ["push"],
      config: {
        content_type: "json",
        insecure_ssl: "0",
        url: `https://sigvelo-agent-tests.example.workers.dev${GITHUB_WEBHOOK_PATH}`,
      },
    },
    repository: {
      id: 456,
      name: "nanites",
      full_name: "WebMCP-org/nanites",
    },
    sender: {
      id: 789,
      login: "alice",
      type: "User",
    },
  } satisfies TestGitHubWebhookPayload<"ping">);
  const unsignedResponse = await worker.fetch(
    await buildTestGitHubWebhookRequest({
      body,
      delivery: "e2e-ping-unsigned",
      event: "ping",
      origin: "https://sigvelo-agent-tests.example.workers.dev",
      signed: false,
    }),
    env,
    createExecutionContext(),
  );

  expect(unsignedResponse.status).not.toBe(200);

  const signedResponse = await worker.fetch(
    await buildTestGitHubWebhookRequest({
      body,
      delivery: "e2e-ping-signed",
      event: "ping",
      origin: "https://sigvelo-agent-tests.example.workers.dev",
    }),
    env,
    createExecutionContext(),
  );

  expect(signedResponse.status).toBe(200);
  await expect(signedResponse.text()).resolves.toBe("pong");
});
