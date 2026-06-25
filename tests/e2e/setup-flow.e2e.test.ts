import { NANITES_SETUP_AGENT_INSTANCE_NAME } from "#/shared/constants.ts";
import { createExecutionContext, env } from "cloudflare:test";
import { getAgentByName } from "agents";
import worker from "#/server.ts";
import { resetGitHubAppTables, saveTestGitHubApp } from "../helpers/d1-baseline.ts";
import {
  buildCloudflareVerifiedSetupState,
  readSetupInstallNonce,
} from "../helpers/setup-state.ts";
import {
  createInitialSetupState,
  type NanitesSetupAgent,
  type NanitesSetupState,
} from "#/backend/agents/NanitesSetupAgent.ts";

const SETUP_ORIGIN = "https://sigvelo-agent-tests.example.workers.dev";

type SetupAgentTestRpc = {
  setState(state: NanitesSetupState): void;
  issueSetupClaim: NanitesSetupAgent["issueSetupClaim"];
  refresh: NanitesSetupAgent["refresh"];
  recordRepositoryInstall: NanitesSetupAgent["recordRepositoryInstall"];
};

async function resetSetup(
  input: {
    readonly withGitHubApp?: boolean;
    readonly gitHubApp?: Parameters<typeof saveTestGitHubApp>[1];
  } = {},
): Promise<SetupAgentTestRpc> {
  await resetGitHubAppTables(env.DB);
  const setupAgent = (await getAgentByName<Env, NanitesSetupAgent>(
    env.NanitesSetupAgent,
    NANITES_SETUP_AGENT_INSTANCE_NAME,
  )) as unknown as SetupAgentTestRpc;
  setupAgent.setState(createInitialSetupState());
  await setupAgent.refresh({ origin: SETUP_ORIGIN });
  if (input.withGitHubApp !== false) {
    await saveTestGitHubApp(env.DB, input.gitHubApp);
    await setupAgent.refresh({ origin: SETUP_ORIGIN });
  }
  setupAgent.setState(buildCloudflareVerifiedSetupState());
  return setupAgent;
}

async function fetchSetup(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return worker.fetch(
    input instanceof Request ? input : new Request(input, init),
    env,
    createExecutionContext(),
  );
}

function readRedirect(response: Response): URL {
  return new URL(response.headers.get("Location") ?? "", SETUP_ORIGIN);
}

test("GitHub install callback without setup claim returns to setup before app config exists", async () => {
  await resetSetup({ withGitHubApp: false });

  const response = await fetchSetup(
    `${SETUP_ORIGIN}/setup/github/installed?installation_id=42&setup_action=install&state=test-install-state`,
  );

  expect(response.status).toBe(302);
  const location = readRedirect(response);
  expect(location.pathname).toBe("/setup");
  expect(location.searchParams.get("setup_error")).toBe("setup_claim_required");
});

test("GitHub install callback without setup claim returns to setup while app secrets are unreadable", async () => {
  await resetSetup({
    gitHubApp: {
      appId: 987654,
      slug: "nanites-unreadable",
      htmlUrl: "https://github.com/apps/nanites-unreadable",
    },
  });

  const response = await fetchSetup(
    `${SETUP_ORIGIN}/setup/github/installed?installation_id=42&setup_action=update&state=test-install-state`,
  );

  expect(response.status).toBe(302);
  const location = readRedirect(response);
  expect(location.pathname).toBe("/setup");
  expect(location.searchParams.get("setup_error")).toBe("setup_claim_required");
});

test("GitHub install callback without setup claim recovers through GitHub OAuth when app config exists", async () => {
  await resetSetup();

  for (const setupAction of ["install", "update"]) {
    const response = await fetchSetup(
      `${SETUP_ORIGIN}/setup/github/installed?installation_id=42&setup_action=${setupAction}&state=test-install-state`,
    );

    expect(response.status).toBe(302);
    const location = readRedirect(response);
    expect(location.pathname).toBe("/auth/github/login");
    expect(location.searchParams.get("returnTo")).toBe(
      "/setup/github/verify?installation_id=42&state=test-install-state",
    );
  }
});

test("GitHub setup verification without browser auth restarts GitHub login", async () => {
  await resetSetup();

  const response = await fetchSetup(
    `${SETUP_ORIGIN}/setup/github/verify?installation_id=42&state=test-install-state`,
  );

  expect(response.status).toBe(302);
  const location = readRedirect(response);
  expect(location.pathname).toBe("/auth/github/login");
  expect(location.searchParams.get("returnTo")).toBe(
    "/setup/github/verify?installation_id=42&state=test-install-state",
  );
});

test("repository install is blocked while app secrets are unreadable", async () => {
  const setupAgent = await resetSetup({
    gitHubApp: {
      appId: 987654,
      slug: "nanites-unreadable",
      htmlUrl: "https://github.com/apps/nanites-unreadable",
    },
  });
  const setupClaim = await setupAgent.issueSetupClaim();
  const installState = readSetupInstallNonce(await setupAgent.refresh({ origin: SETUP_ORIGIN }));

  await expect(
    setupAgent.recordRepositoryInstall({
      githubInstallationId: 42,
      repositoryFullName: "WebMCP-org/nanites",
      claimToken: setupClaim.token,
      installState,
    }),
  ).resolves.toEqual({ ok: false, errorKind: "invalidSetupState" });
});
