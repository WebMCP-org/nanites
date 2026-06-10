import { createExecutionContext, env } from "cloudflare:test";
import { getAgentByName } from "agents";
import worker from "#/server.ts";
import { ensureD1BaselineSchema } from "../helpers/d1-baseline.ts";
import {
  createInitialNanitesSetupState,
  type NanitesSetupAgent,
  type NanitesSetupAgentState,
} from "#/backend/agents/NanitesSetupAgent.ts";
import { NANITES_SETUP_AGENT_INSTANCE_NAME } from "#/nanites.ts";

const SETUP_ORIGIN = "https://sigvelo-agent-tests.example.workers.dev";

type SetupAgentTestRpc = {
  setState(state: NanitesSetupAgentState): void;
  claimSetupOwner: NanitesSetupAgent["claimSetupOwner"];
  resetSetupOwner: NanitesSetupAgent["resetSetupOwner"];
  connectCloudflare: NanitesSetupAgent["connectCloudflare"];
};

async function getSetupAgent(): Promise<SetupAgentTestRpc> {
  return getAgentByName<Env, NanitesSetupAgent>(
    env.NanitesSetupAgent,
    NANITES_SETUP_AGENT_INSTANCE_NAME,
  ) as unknown as SetupAgentTestRpc;
}

async function resetSetupAgent(): Promise<SetupAgentTestRpc> {
  await ensureD1BaselineSchema(env.DB);
  const setupAgent = await getSetupAgent();
  setupAgent.setState(createInitialNanitesSetupState());
  await setupAgent.resetSetupOwner({ setupOwnerToken: null });
  return setupAgent;
}

test("setup owner claim blocks another browser from mutating Cloudflare setup", async () => {
  const setupAgent = await resetSetupAgent();
  const firstOwner = await setupAgent.claimSetupOwner();

  expect(firstOwner).toMatchObject({
    claimed: true,
    setupOwnerToken: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
    expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
  });
  await expect(setupAgent.claimSetupOwner()).resolves.toMatchObject({
    claimed: false,
    setupOwnerToken: null,
    expiresAt: firstOwner.expiresAt,
  });
  await expect(
    setupAgent.connectCloudflare({
      origin: SETUP_ORIGIN,
      setupOwnerToken: "not-the-owner",
    }),
  ).resolves.toMatchObject({
    authorizationUrl: null,
    setupOwnerClaimRequired: true,
  });

  const response = await worker.fetch(
    new Request(`${SETUP_ORIGIN}/agents/nanites-setup-agent/default`),
    env,
    createExecutionContext(),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    cloudflare: { status: "idle" },
    setupOwner: {
      status: "claimed",
      claimExpiresAt: firstOwner.expiresAt,
    },
  });
});
