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

async function getSetupAgent(): Promise<SetupAgentTestRpc> {
  return getAgentByName<Env, NanitesSetupAgent>(
    env.NanitesSetupAgent,
    SETUP_AGENT_INSTANCE_NAME,
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
