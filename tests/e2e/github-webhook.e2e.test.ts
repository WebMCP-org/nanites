import { GITHUB_WEBHOOK_PATH, NANITES_SETUP_AGENT_INSTANCE_NAME } from "#/shared/constants.ts";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { getAgentByName } from "agents";
import worker from "#/server.ts";
import { ensureD1BaselineSchema, saveTestGitHubApp } from "../helpers/d1-baseline.ts";
import {
  createInitialSetupState,
  type NanitesSetupAgent,
  type NanitesSetupState,
} from "#/backend/agents/NanitesSetupAgent.ts";
import {
  buildTestGitHubWebhookRequest,
  type TestGitHubWebhookPayload,
} from "../helpers/github-webhook.ts";

type GitHubPingPayload = TestGitHubWebhookPayload<"ping">;
type GitHubInstallationDeletedPayload = TestGitHubWebhookPayload<"installation.deleted">;

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

function buildGitHubPingBody(): string {
  const payload = {
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
  } satisfies GitHubPingPayload;
  return JSON.stringify(payload);
}

function buildGitHubInstallationDeletedBody(githubInstallationId: number): string {
  const payload = {
    action: "deleted",
    installation: {
      id: githubInstallationId,
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
  } satisfies GitHubInstallationDeletedPayload;
  return JSON.stringify(payload);
}

async function resetSetupAgent(): Promise<SetupAgentTestRpc> {
  await ensureD1BaselineSchema(env.DB);
  const setupAgent = await getSetupAgent();
  setupAgent.setState(createInitialSetupState());
  return setupAgent;
}

function buildCloudflareVerifiedSetupState(): NanitesSetupState {
  const initialState = createInitialSetupState();
  return {
    ...initialState,
    currentStep: "github-app",
    cloudflare: {
      status: "verified",
      authorizationUrl: null,
      accountId: "test-account",
      accountName: "Test Account",
      scriptName: "sigvelo-agent-tests",
      readiness: { status: "ready", checkedAt: new Date().toISOString(), items: [] },
      error: null,
    },
    githubApp: {
      ...initialState.githubApp,
      status: "ready",
    },
  };
}

test("GitHub webhook ping requires the configured app secret and a valid signature", async () => {
  await saveTestGitHubApp(env.DB);
  const body = buildGitHubPingBody();
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
  const setupAgent = await resetSetupAgent();
  await saveTestGitHubApp(env.DB);
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await setupAgent.issueSetupClaim();
  const setupState = await setupAgent.refresh();
  const installUrl = setupState.githubApp.installUrl;
  const installState = installUrl ? new URL(installUrl).searchParams.get("state") : null;
  if (!installState) {
    throw new Error("Expected setup Agent to expose a repository install nonce.");
  }
  await expect(
    setupAgent.recordRepositoryInstall({
      githubInstallationId: 42,
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

  const body = buildGitHubInstallationDeletedBody(42);
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
