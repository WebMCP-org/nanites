import { GITHUB_WEBHOOK_PATH, NANITES_SETUP_AGENT_INSTANCE_NAME } from "#/shared/constants.ts";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { getAgentByName } from "agents";
import worker from "#/server.ts";
import { ensureD1BaselineSchema, saveTestGitHubApp } from "../helpers/d1-baseline.ts";
import {
  buildCloudflareVerifiedSetupState,
  readSetupInstallNonce,
} from "../helpers/setup-state.ts";
import {
  createInitialSetupState,
  type NanitesSetupAgent,
  type NanitesSetupState,
} from "#/backend/agents/NanitesSetupAgent.ts";
import {
  buildTestGitHubWebhookRequest,
  type TestGitHubWebhookPayload,
} from "../helpers/github-webhook.ts";

type SetupAgentTestRpc = {
  setState(state: NanitesSetupState): void;
  issueSetupClaim: NanitesSetupAgent["issueSetupClaim"];
  refresh(): Promise<NanitesSetupState>;
  recordRepositoryInstall: NanitesSetupAgent["recordRepositoryInstall"];
  recordUpstreamStar: NanitesSetupAgent["recordUpstreamStar"];
};

async function getSetupAgent(): Promise<SetupAgentTestRpc> {
  return getAgentByName<Env, NanitesSetupAgent>(
    env.NanitesSetupAgent,
    NANITES_SETUP_AGENT_INSTANCE_NAME,
  ) as unknown as SetupAgentTestRpc;
}

test("GitHub webhook ping requires the configured app secret and a valid signature", async () => {
  await saveTestGitHubApp(env.DB);
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

test("GitHub installation deletion webhook moves completed setup back to repository repair", async () => {
  await ensureD1BaselineSchema(env.DB);
  const setupAgent = await getSetupAgent();
  setupAgent.setState(createInitialSetupState());
  await saveTestGitHubApp(env.DB);
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await setupAgent.issueSetupClaim();
  const installState = readSetupInstallNonce(await setupAgent.refresh());
  await expect(
    setupAgent.recordRepositoryInstall({
      githubInstallationId: 42,
      repositoryFullName: "WebMCP-org/nanites",
      claimToken: setupClaim.token,
      installState,
    }),
  ).resolves.toMatchObject({ ok: true });
  await setupAgent.recordUpstreamStar({ starred: true });
  await expect(setupAgent.refresh()).resolves.toMatchObject({
    setupComplete: true,
    currentStep: "launch",
    repositories: {
      status: "complete",
      githubInstallationId: 42,
    },
    upstreamStar: {
      starred: true,
    },
  });

  const body = JSON.stringify({
    action: "deleted",
    installation: {
      id: 42,
      account: {
        id: 456,
        login: "WebMCP-org",
        type: "Organization",
      },
    },
    sender: {
      id: 789,
      login: "alice",
      type: "User",
    },
  } satisfies TestGitHubWebhookPayload<"installation.deleted">);
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    await buildTestGitHubWebhookRequest({
      body,
      delivery: "e2e-installation-deleted",
      event: "installation",
      origin: "https://sigvelo-agent-tests.example.workers.dev",
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  expect(response.status).toBe(200);
  await expect(setupAgent.refresh()).resolves.toMatchObject({
    setupComplete: false,
    currentStep: "repositories",
    repositories: {
      status: "ready",
      githubInstallationId: null,
      error: expect.stringContaining("GitHub App installation was deleted"),
    },
  });
});
