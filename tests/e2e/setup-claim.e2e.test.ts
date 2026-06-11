import { env } from "cloudflare:test";
import { getAgentByName } from "agents";
import {
  ensureD1BaselineSchema,
  saveTestDeploymentGitHubAppMetadata,
} from "../helpers/d1-baseline.ts";
import {
  createInitialSetupState,
  type NanitesSetupAgent,
  type NanitesSetupState,
} from "#/backend/agents/NanitesSetupAgent.ts";

const SETUP_ORIGIN = "https://sigvelo-agent-tests.example.workers.dev";
const SETUP_AGENT_INSTANCE_NAME = "setup-claim-e2e";

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

function readInstallNonce(setupState: NanitesSetupState): string {
  const installUrl = setupState.githubApp.installUrl;
  const installState = installUrl ? new URL(installUrl).searchParams.get("state") : null;
  if (!installState) {
    throw new Error("Expected setup Agent to expose a repository install nonce.");
  }
  return installState;
}

test("repository install requires the issued setup claim and install nonce", async () => {
  await ensureD1BaselineSchema(env.DB);
  await saveTestDeploymentGitHubAppMetadata(env.DB);
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const installState = readInstallNonce(await setupAgent.refresh({ origin: SETUP_ORIGIN }));

  await expect(
    setupAgent.recordRepositoryInstall({
      githubInstallationId: 42,
      claimToken: "",
      installState,
    }),
  ).resolves.toEqual({ ok: false, errorKind: "setupClaimRequired" });

  const claim = await setupAgent.issueSetupClaim();
  await expect(
    setupAgent.recordRepositoryInstall({
      githubInstallationId: 42,
      claimToken: "not-the-claimed-browser",
      installState,
    }),
  ).resolves.toEqual({ ok: false, errorKind: "setupClaimRequired" });
  await expect(
    setupAgent.recordRepositoryInstall({
      githubInstallationId: 42,
      claimToken: claim.token,
      installState: "not-the-issued-install-nonce",
    }),
  ).resolves.toEqual({ ok: false, errorKind: "installStateMismatch" });

  await expect(
    setupAgent.recordRepositoryInstall({
      githubInstallationId: 42,
      claimToken: claim.token,
      installState,
    }),
  ).resolves.toMatchObject({
    ok: true,
    state: {
      setupComplete: true,
      currentStep: "launch",
      repositories: {
        status: "complete",
        githubInstallationId: 42,
      },
    },
  });
});
