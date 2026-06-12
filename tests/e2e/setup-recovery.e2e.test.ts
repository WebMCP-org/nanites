import { env } from "cloudflare:test";
import { getAgentByName } from "agents";
import { saveTestGitHubApp } from "../helpers/d1-baseline.ts";
import {
  createInitialSetupState,
  type NanitesSetupAgent,
  type NanitesSetupState,
} from "#/backend/agents/NanitesSetupAgent.ts";

const SETUP_ORIGIN = "https://sigvelo-agent-tests.example.workers.dev";
const SETUP_AGENT_INSTANCE_NAME = "setup-recovery-e2e";

type SetupAgentTestRpc = {
  setState(state: NanitesSetupState): void;
  /** Private on the class; reachable over RPC to simulate the onStart recovery pass. */
  recoverInterruptedSteps(): void;
  refresh: NanitesSetupAgent["refresh"];
  issueSetupClaim: NanitesSetupAgent["issueSetupClaim"];
  recordRepositoryInstall: NanitesSetupAgent["recordRepositoryInstall"];
};

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

async function getSetupAgent(
  instanceName: string = SETUP_AGENT_INSTANCE_NAME,
): Promise<SetupAgentTestRpc> {
  return getAgentByName<Env, NanitesSetupAgent>(
    env.NanitesSetupAgent,
    instanceName,
  ) as unknown as SetupAgentTestRpc;
}

test("setup Agent restores selected installation from deployment metadata after state reset", async () => {
  await saveTestGitHubApp(env.DB);
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await setupAgent.issueSetupClaim();
  const setupState = await setupAgent.refresh({ origin: SETUP_ORIGIN });
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

  setupAgent.setState(createInitialSetupState());
  await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject({
    setupComplete: true,
    currentStep: "launch",
    githubApp: {
      status: "complete",
      slug: "nanites-test",
    },
    repositories: {
      status: "complete",
      githubInstallationId: 42,
    },
  });
});

test("setup Agent demotes an interrupted Cloudflare verification to a retryable failure on restart", async () => {
  const setupAgent = await getSetupAgent("setup-recovery-interrupted-verify");
  const initialState = createInitialSetupState();
  setupAgent.setState({
    ...initialState,
    cloudflare: {
      ...initialState.cloudflare,
      status: "verifying",
      scriptName: "sigvelo-agent-tests",
      readiness: { status: "checking", checkedAt: null, items: [] },
    },
  });

  // A Durable Object restart re-runs onStart; the request that set
  // "verifying" cannot have survived it.
  await setupAgent.onStart();

  await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject({
    currentStep: "cloudflare",
    cloudflare: {
      status: "failed",
      error: "Cloudflare verification was interrupted. Retry the connection.",
    },
    githubApp: { status: "locked" },
  });
});

test("setup Agent demotes an interrupted GitHub App secret write to a retryable failure on restart", async () => {
  const setupAgent = await getSetupAgent("setup-recovery-interrupted-secrets");
  const verifiedState = buildCloudflareVerifiedSetupState();
  setupAgent.setState({
    ...verifiedState,
    githubApp: { ...verifiedState.githubApp, status: "writing-secrets" },
  });

  await setupAgent.onStart();

  await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject({
    cloudflare: { status: "verified" },
    githubApp: {
      status: "ready",
      error:
        "GitHub App setup was interrupted while writing Worker secrets. Retry creating the app.",
    },
  });
});
