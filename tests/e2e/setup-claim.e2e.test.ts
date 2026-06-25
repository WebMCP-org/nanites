import { env } from "cloudflare:test";
import { getAgentByName } from "agents";
import { ensureD1BaselineSchema, saveTestGitHubApp } from "../helpers/d1-baseline.ts";
import {
  buildCloudflareVerifiedSetupState,
  readSetupInstallNonce,
} from "../helpers/setup-state.ts";
import {
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

async function getSetupAgent(): Promise<SetupAgentTestRpc> {
  return getAgentByName<Env, NanitesSetupAgent>(
    env.NanitesSetupAgent,
    SETUP_AGENT_INSTANCE_NAME,
  ) as unknown as SetupAgentTestRpc;
}

test("repository install requires the issued setup claim and install nonce", async () => {
  await ensureD1BaselineSchema(env.DB);
  await saveTestGitHubApp(env.DB);
  const setupAgent = await getSetupAgent();
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  const installState = readSetupInstallNonce(await setupAgent.refresh({ origin: SETUP_ORIGIN }));

  await expect(
    setupAgent.recordRepositoryInstall({
      githubInstallationId: 42,
      repositoryFullName: "WebMCP-org/nanites",
      claimToken: "",
      installState,
    }),
  ).resolves.toEqual({ ok: false, errorKind: "setupClaimRequired" });

  const claim = await setupAgent.issueSetupClaim();
  await expect(
    setupAgent.recordRepositoryInstall({
      githubInstallationId: 42,
      repositoryFullName: "WebMCP-org/nanites",
      claimToken: "not-the-claimed-browser",
      installState,
    }),
  ).resolves.toEqual({ ok: false, errorKind: "setupClaimRequired" });
  await expect(
    setupAgent.recordRepositoryInstall({
      githubInstallationId: 42,
      repositoryFullName: "WebMCP-org/nanites",
      claimToken: claim.token,
      installState: "not-the-issued-install-nonce",
    }),
  ).resolves.toEqual({ ok: false, errorKind: "installStateMismatch" });

  await expect(
    setupAgent.recordRepositoryInstall({
      githubInstallationId: 42,
      repositoryFullName: "WebMCP-org/nanites",
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
