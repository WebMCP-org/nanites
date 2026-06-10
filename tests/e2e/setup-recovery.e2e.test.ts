import { env } from "cloudflare:test";
import { getAgentByName } from "agents";
import { saveTestDeploymentGitHubAppMetadata } from "../helpers/d1-baseline.ts";
import {
  createInitialNanitesSetupState,
  type NanitesSetupAgent,
  type NanitesSetupAgentState,
} from "#/backend/agents/NanitesSetupAgent.ts";

const SETUP_ORIGIN = "https://sigvelo-agent-tests.example.workers.dev";
const SETUP_AGENT_INSTANCE_NAME = "setup-recovery-e2e";

type SetupAgentTestRpc = {
  setState(state: NanitesSetupAgentState): void;
  refresh: NanitesSetupAgent["refresh"];
  issueSetupClaim: NanitesSetupAgent["issueSetupClaim"];
  recordRepositoryInstall: NanitesSetupAgent["recordRepositoryInstall"];
};

function buildCloudflareVerifiedSetupState(): NanitesSetupAgentState {
  const initialState = createInitialNanitesSetupState();
  return {
    ...initialState,
    cloudflare: {
      status: "verified",
      authorizationUrl: null,
      accountId: "test-account",
      accountName: "Test Account",
      scriptName: "sigvelo-agent-tests",
      error: null,
      connectedAt: new Date().toISOString(),
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

async function saveGeneratedGitHubAppMetadata(): Promise<void> {
  await saveTestDeploymentGitHubAppMetadata(env.DB);
}

test("setup Agent restores selected installation from deployment metadata after state reset", async () => {
  await saveGeneratedGitHubAppMetadata();
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const setupClaim = await setupAgent.issueSetupClaim();
  const setupState = await setupAgent.refresh({ origin: SETUP_ORIGIN });
  const installState = setupState.repositories.installState;
  if (!installState) {
    throw new Error("Expected setup Agent to expose a repository install nonce.");
  }

  await setupAgent.recordRepositoryInstall({
    githubInstallationId: 42,
    setupClaimToken: setupClaim.claimToken,
    installState,
  });

  setupAgent.setState(createInitialNanitesSetupState());
  await expect(setupAgent.refresh({ origin: SETUP_ORIGIN })).resolves.toMatchObject({
    currentStep: "upstream-star",
    githubApp: {
      status: "complete",
      slug: "nanites-test",
    },
    repositories: {
      status: "complete",
      githubInstallationId: 42,
    },
    upstreamStar: {
      status: "ready",
    },
    launch: {
      status: "locked",
    },
  });
});
