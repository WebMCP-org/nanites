import { env } from "cloudflare:test";
import { getAgentByName } from "agents";
import { resetGitHubAppTables, saveTestGitHubApp } from "../helpers/d1-baseline.ts";
import {
  buildCloudflareVerifiedSetupState,
  repositoryInstalledSetupState,
  readSetupInstallNonce,
} from "../helpers/setup-state.ts";
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

async function getSetupAgent(
  instanceName: string = SETUP_AGENT_INSTANCE_NAME,
): Promise<SetupAgentTestRpc> {
  return getAgentByName<Env, NanitesSetupAgent>(
    env.NanitesSetupAgent,
    instanceName,
  ) as unknown as SetupAgentTestRpc;
}

test("setup Agent restores deployment installation from deployment metadata after state reset", async () => {
  await saveTestGitHubApp(env.DB);
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await setupAgent.issueSetupClaim();
  const installState = readSetupInstallNonce(await setupAgent.refresh({ origin: SETUP_ORIGIN }));

  await expect(
    setupAgent.recordRepositoryInstall({
      githubInstallationId: 42,
      repositoryFullName: "WebMCP-org/nanites",
      claimToken: setupClaim.token,
      installState,
    }),
  ).resolves.toMatchObject({ ok: true });

  setupAgent.setState(createInitialSetupState());
  await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject(
    repositoryInstalledSetupState,
  );
});

test("setup Agent demotes an interrupted Cloudflare verification to a retryable failure on restart", async () => {
  await resetGitHubAppTables(env.DB);
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

  // A Durable Object restart re-runs onStart, whose recovery pass treats the
  // lingering "verifying" as interrupted: the request that set it cannot have
  // survived the restart.
  await setupAgent.recoverInterruptedSteps();

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
  await resetGitHubAppTables(env.DB);
  const setupAgent = await getSetupAgent("setup-recovery-interrupted-secrets");
  const verifiedState = buildCloudflareVerifiedSetupState();
  setupAgent.setState({
    ...verifiedState,
    githubApp: { ...verifiedState.githubApp, status: "writing-secrets" },
  });

  await setupAgent.recoverInterruptedSteps();

  await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject({
    cloudflare: { status: "verified" },
    githubApp: {
      status: "ready",
      error:
        "GitHub App setup was interrupted while writing Worker secrets. Retry creating the app.",
    },
  });
});
