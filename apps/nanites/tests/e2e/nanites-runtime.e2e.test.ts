import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { getAgentByName } from "agents";
import { githubInstallationIdSchema, githubUserIdSchema } from "@nanites/contracts/ids";
import { buildBrowserSessionExpiration } from "#/backend/browser-auth/policy.ts";
import { sealGitHubUserTokenCookie, sealSessionCookie } from "#/backend/browser-auth/cookies.ts";
import { healthCheckOutputSchema } from "#/backend/orpc/contracts/health.ts";
import {
  createNaniteInputSchema,
  createNaniteOutputSchema,
  managerStateOutputSchema,
} from "#/backend/orpc/contracts/nanites.ts";
import { buildGitHubPullRequestFixture } from "#/backend/nanites/github-trigger-fixtures.ts";
import type { NaniteManager } from "#/backend/nanites/host.ts";
import type { GitHubPushWebhookPayload } from "#/backend/github-types.ts";
import type { UIMessage } from "ai";
import worker from "#/server.ts";
import { NANITE_AGENT_NAME, NANITE_MANAGER_NAME } from "#/shared/constants/nanites.ts";
import { buildNaniteManagerKey } from "#/shared/nanites.ts";
import { parseJsonResponse } from "../helpers/json-response.ts";

function getE2eManager() {
  return getAgentByName(
    env.SigveloNaniteManager as DurableObjectNamespace<NaniteManager>,
    `nanites-e2e-${crypto.randomUUID()}`,
  );
}

function createFixtureGitHubInstallationId() {
  return Math.floor(Math.random() * 1_000_000_000) + 1;
}

function buildGitHubPushFixture(input: {
  installationId: number;
  repository: string;
  branch: string;
  afterSha?: string;
}): GitHubPushWebhookPayload {
  const [owner = "WebMCP-org", name = "sigvelo"] = input.repository.split("/", 2);
  return {
    ref: `refs/heads/${input.branch}`,
    after: input.afterSha ?? `test${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
    repository: {
      id: 101,
      name,
      full_name: input.repository,
      owner: {
        login: owner,
      },
    },
    installation: {
      id: input.installationId,
    },
  } as unknown as GitHubPushWebhookPayload;
}

async function buildAuthenticatedNanitesCookieHeader(githubInstallationId: number) {
  const request = new Request("http://example.com/api/nanites/create");
  const sessionCookie = await sealSessionCookie(
    {
      githubUserId: githubUserIdSchema.parse(7),
      githubLogin: "alex",
      activeGithubInstallationId: githubInstallationIdSchema.parse(githubInstallationId),
      expiresAt: buildBrowserSessionExpiration(),
    },
    request,
    env,
  );
  const githubUserTokenCookie = await sealGitHubUserTokenCookie(
    {
      accessToken: "github-user-token-fixture",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      refreshToken: null,
      refreshTokenExpiresAt: null,
    },
    request,
    env,
  );

  return `${sessionCookie.split(";", 1)[0]}; ${githubUserTokenCookie.split(";", 1)[0]}`;
}

async function registerFixtureNanite(manager: Awaited<ReturnType<typeof getE2eManager>>) {
  await manager.registerNanite({
    manifest: {
      id: "docs-syncer",
      name: "Docs syncer",
      description: "Updates repo B documentation after repo A changes on main.",
      trigger: { type: "manual" },
      permissions: {},
    },
  });
}

function startFixtureManualRun(manager: Awaited<ReturnType<typeof getE2eManager>>) {
  return manager.startRun({
    naniteId: "docs-syncer",
    trigger: {
      type: "manual",
      requestId: "manual-fixture-run",
      actorId: null,
    },
  });
}

async function startFixtureRuntimeManualRun(manager: Awaited<ReturnType<typeof getE2eManager>>) {
  const run = await manager.startRun({
    naniteId: "docs-syncer",
    trigger: {
      type: "manual",
      requestId: `manual-runtime-${crypto.randomUUID()}`,
      actorId: null,
    },
  });
  return manager.dispatchRun({ runId: run.runId });
}

async function withNaniteLlmFixture<T>(
  fixture: "complete" | "no_change" | "ask_human" | "no_lifecycle" | "tool_output_budget",
  run: () => Promise<T>,
): Promise<T> {
  const previousFixture = Reflect.get(env, "NANITES_LLM_FIXTURE");
  Reflect.set(env, "NANITES_LLM_FIXTURE", fixture);
  try {
    return await run();
  } finally {
    Reflect.set(env, "NANITES_LLM_FIXTURE", previousFixture);
  }
}

async function waitForRun(
  manager: Awaited<ReturnType<typeof getE2eManager>>,
  runId: string,
  predicate: (status: string) => boolean,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    const snapshot = await manager.getSnapshot();
    const run = snapshot.runs[runId];
    if (run && predicate(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const snapshot = await manager.getSnapshot();
  const latest = snapshot.runs[runId];
  throw new Error(
    `Timed out waiting for run ${runId}; latest=${latest?.status}; summary=${latest?.summary}`,
  );
}

function getMessageTextContent(message: UIMessage): string {
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function getNaniteLifecycleToolOutputs(messages: UIMessage[], toolName: string): unknown[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      const record = part as Record<string, unknown>;
      if (record.toolName === toolName && record.state === "output-available") {
        return [record.output];
      }
      return [];
    }),
  );
}

async function fetchNaniteMessages(input: {
  managerName: string;
  naniteId: string;
  cookieHeader: string;
}): Promise<UIMessage[]> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(
      `http://example.com/agents/${NANITE_MANAGER_NAME}/${input.managerName}/sub/${NANITE_AGENT_NAME}/${encodeURIComponent(input.naniteId)}/get-messages`,
      {
        headers: { cookie: input.cookieHeader },
      },
    ),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  expect(response.status).toBe(200);
  return (await response.json()) as UIMessage[];
}

test("Nanites e2e harness reaches the real Worker runtime", async () => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request("http://example.com/api/health"), env, ctx);
  await waitOnExecutionContext(ctx);

  await expect(parseJsonResponse(response, healthCheckOutputSchema)).resolves.toEqual({
    status: "ok",
  });
});

test("oRPC Nanite creation requires an authenticated active installation", async () => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("http://example.com/api/nanites/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        createNaniteInputSchema.parse({
          manifest: {
            id: "docs-syncer",
            name: "Docs syncer",
            description: "Updates repo B documentation after repo A changes on main.",
            trigger: { type: "manual" },
            permissions: {},
          },
        }),
      ),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  expect(response.status).toBe(401);
});

test("Nanite creation schema accepts documented GitHub and schedule trigger shapes", () => {
  expect(() =>
    createNaniteInputSchema.parse({
      manifest: {
        id: "repro-pr",
        name: "Repro PR",
        description: "Exercises the documented GitHub pull request trigger shape.",
        trigger: {
          type: "github",
          event: "pull_request",
          repositories: ["WebMCP-org/WebMCP"],
          actions: ["opened"],
        },
        permissions: {
          github: {
            repositories: ["WebMCP-org/WebMCP"],
          },
        },
        capabilities: {
          githubMcp: { tier: "github_pr_read" },
        },
      },
    }),
  ).not.toThrow();

  expect(() =>
    createNaniteInputSchema.parse({
      manifest: {
        id: "repro-schedule",
        name: "Repro Schedule",
        description: "Exercises the documented cron schedule shape.",
        trigger: {
          type: "schedule",
          schedule: { type: "cron", cron: "0 8 * * *" },
        },
        permissions: {
          github: {
            repositories: ["WebMCP-org/WebMCP"],
          },
        },
        capabilities: {
          githubMcp: { tier: "github_ci_reader" },
        },
      },
    }),
  ).not.toThrow();
});

test("manager registers a fixture Nanite and starts one visible manual run", async () => {
  const manager = await getE2eManager();

  await registerFixtureNanite(manager);

  const run = await startFixtureManualRun(manager);
  const snapshot = await manager.getSnapshot();

  expect(snapshot.nanites["docs-syncer"]?.manifest.name).toBe("Docs syncer");
  expect(snapshot.runOrder).toEqual([run.runId]);
  expect(snapshot.runs[run.runId]).toMatchObject({
    naniteId: "docs-syncer",
    status: "running",
    versionId: snapshot.nanites["docs-syncer"]?.latestVersion.versionId,
  });
});

test("scheduled Nanite trigger is installed on the sub-agent and starts a run", async () => {
  const manager = await getE2eManager();

  await manager.registerNanite({
    manifest: {
      id: "scheduled-docs-syncer",
      name: "Scheduled docs syncer",
      description: "Uses a Cloudflare Agent schedule to wake its generated trigger.",
      trigger: {
        type: "schedule",
        schedule: {
          type: "delayed",
          delayInSeconds: 1,
        },
      },
      inboundTrigger: {
        sourceCode: `
export default {
  async handle(event, ctx) {
    if (event.type !== "schedule.tick") {
      return ctx.noop("Not a schedule tick");
    }
    return ctx.dispatchSelf({ reason: "scheduled e2e" });
  },
};
`,
      },
      permissions: {},
    },
  });

  await withNaniteLlmFixture("complete", async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10_000) {
      const snapshot = await manager.getSnapshot();
      const runId = snapshot.runOrder.find(
        (candidateRunId) => snapshot.runs[candidateRunId]?.naniteId === "scheduled-docs-syncer",
      );
      if (runId) {
        const run = await waitForRun(manager, runId, (status) => status === "complete");
        expect(run.trigger).toMatchObject({
          type: "schedule",
          input: {
            reason: "scheduled e2e",
          },
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Timed out waiting for scheduled Nanite run.");
  });
});

test("manager keeps runtime activity separate from run outcome", async () => {
  const manager = await getE2eManager();

  await registerFixtureNanite(manager);

  const run = await startFixtureManualRun(manager);
  const startedSnapshot = await manager.getSnapshot();
  expect(startedSnapshot.runs[run.runId]?.status).toBe("running");
  expect(startedSnapshot.runtimeActivityByNanite["docs-syncer"]).toMatchObject({
    state: "idle",
    runId: run.runId,
    toolName: null,
    error: null,
  });

  await manager.recordRuntimeActivity({
    naniteId: "docs-syncer",
    runId: run.runId,
    state: "tool_calling",
    toolName: "read",
  });
  const activeSnapshot = await manager.getSnapshot();
  expect(activeSnapshot.runs[run.runId]?.status).toBe("running");
  expect(activeSnapshot.runtimeActivityByNanite["docs-syncer"]).toMatchObject({
    state: "tool_calling",
    runId: run.runId,
    toolName: "read",
    error: null,
  });

  await manager.completeRun({
    runId: run.runId,
    status: "complete",
    summary: "Documentation is up to date.",
  });
  const completedSnapshot = await manager.getSnapshot();
  expect(completedSnapshot.runs[run.runId]?.status).toBe("complete");
  expect(completedSnapshot.runtimeActivityByNanite["docs-syncer"]).toMatchObject({
    state: "idle",
    runId: run.runId,
    toolName: null,
    error: null,
  });
});

test("manager treats duplicate terminal completion as idempotent", async () => {
  const manager = await getE2eManager();

  await registerFixtureNanite(manager);

  const run = await startFixtureManualRun(manager);

  const firstCompletion = await manager.completeRun({
    runId: run.runId,
    status: "complete",
    summary: "Documentation is up to date.",
    outputUrl: "https://example.com/runs/docs-syncer",
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const duplicateCompletion = await manager.completeRun({
    runId: run.runId,
    status: "complete",
    summary: "Duplicate completion should not replace the first result.",
    outputUrl: "https://example.com/runs/duplicate",
  });

  expect(duplicateCompletion).toEqual(firstCompletion);
});

test("terminal lifecycle outcome ignores later Think submission cleanup", async () => {
  const manager = await getE2eManager();

  await registerFixtureNanite(manager);

  const run = await startFixtureManualRun(manager);
  const completedRun = await manager.completeRun({
    runId: run.runId,
    status: "complete",
    summary: "Documentation is up to date.",
  });
  const cleanupResult = await manager.recordUnreportedRunCompletion({
    runId: run.runId,
    status: "aborted",
    error: "Nanite lifecycle finished with complete.",
  });
  const snapshot = await manager.getSnapshot();

  expect(cleanupResult).toEqual(completedRun);
  expect(snapshot.runs[run.runId]).toEqual(completedRun);
  expect(snapshot.runtimeActivityByNanite["docs-syncer"]).toMatchObject({
    state: "idle",
    runId: run.runId,
    toolName: null,
    error: null,
  });
});

test("manager treats duplicate human request as idempotent while a run is waiting", async () => {
  const manager = await getE2eManager();

  await registerFixtureNanite(manager);

  const run = await startFixtureManualRun(manager);

  const firstRequest = await manager.askHuman({
    runId: run.runId,
    summary: "Need contents:write before opening the documentation PR.",
    requestedScopes: ["contents:write"],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const duplicateRequest = await manager.askHuman({
    runId: run.runId,
    summary: "Duplicate request should not replace the first blocker.",
    requestedScopes: ["pull_requests:write"],
  });

  expect(duplicateRequest).toEqual(firstRequest);
  expect(duplicateRequest).toMatchObject({
    status: "waiting_for_human",
    completedAt: null,
    humanRequest: {
      summary: "Need contents:write before opening the documentation PR.",
      requestedScopes: ["contents:write"],
      resolvedAt: null,
    },
  });
});

test("manager maintenance cancels stale running runs without canceling human blockers", async () => {
  const manager = await getE2eManager();

  await registerFixtureNanite(manager);

  const staleRun = await startFixtureManualRun(manager);
  const waitingRun = await manager.startRun({
    naniteId: "docs-syncer",
    trigger: {
      type: "manual",
      requestId: `manual-waiting-${crypto.randomUUID()}`,
      actorId: null,
    },
  });
  await manager.askHuman({
    runId: waitingRun.runId,
    summary: "Need contents:write before opening the documentation PR.",
    requestedScopes: ["contents:write"],
  });

  const output = await manager.maintainNanites({
    nowIso: new Date(Date.now() + 60_000).toISOString(),
    staleRunningAfterMs: 0,
    terminalSubmissionRetentionMs: 0,
    runCancelLimit: 10,
  });
  const snapshot = await manager.getSnapshot();

  expect(output.canceledRuns.map((run) => run.runId)).toContain(staleRun.runId);
  expect(output.waitingForHumanRunIds).toContain(waitingRun.runId);
  expect(output.failedNaniteAgentMaintenance).toEqual([]);
  expect(output.failedNaniteSyncs).toEqual([]);
  expect(snapshot.runs[staleRun.runId]?.status).toBe("canceled");
  expect(snapshot.runs[waitingRun.runId]?.status).toBe("waiting_for_human");
});

test("manager maintenance refreshes recurring Nanites without replaying one-time schedules", async () => {
  const manager = await getE2eManager();

  await manager.registerNanite({
    manifest: {
      id: "daily-docs-syncer",
      name: "Daily docs syncer",
      description: "Uses a recurring Cloudflare Agent schedule.",
      trigger: {
        type: "schedule",
        schedule: {
          type: "cron",
          cron: "0 8 * * *",
        },
      },
      permissions: {},
    },
  });
  await manager.registerNanite({
    manifest: {
      id: "one-time-docs-syncer",
      name: "One-time docs syncer",
      description: "Uses a one-time Cloudflare Agent schedule.",
      trigger: {
        type: "schedule",
        schedule: {
          type: "scheduled",
          date: "2099-01-01T00:00:00.000Z",
        },
      },
      permissions: {},
    },
  });

  const output = await manager.maintainNanites({
    nowIso: new Date(Date.now() + 60_000).toISOString(),
    staleRunningAfterMs: 0,
    terminalSubmissionRetentionMs: 0,
  });

  expect(output.registeredNaniteIds).toEqual(
    expect.arrayContaining(["daily-docs-syncer", "one-time-docs-syncer"]),
  );
  expect(output.maintainedNaniteAgents.map((agent) => agent.naniteId)).toEqual(
    expect.arrayContaining(["daily-docs-syncer", "one-time-docs-syncer"]),
  );
  expect(output.resyncedNaniteIds).toContain("daily-docs-syncer");
  expect(output.resyncedNaniteIds).not.toContain("one-time-docs-syncer");
  expect(output.failedNaniteAgentMaintenance).toEqual([]);
  expect(output.failedNaniteSyncs).toEqual([]);
});

test.todo("signed GitHub trigger creates one visible Nanite run and check");
test.todo("duplicate GitHub delivery does not create duplicate run artifacts");

test("fixture runtime completes through a real Think sub-agent turn", async () => {
  await withNaniteLlmFixture("complete", async () => {
    const manager = await getE2eManager();

    await registerFixtureNanite(manager);

    const run = await startFixtureRuntimeManualRun(manager);
    const completedRun = await waitForRun(manager, run.runId, (status) => status === "complete");

    expect(completedRun).toMatchObject({
      status: "complete",
      summary: "Docs sync completed through the mocked provider layer.",
      outputUrl: "https://example.com/runs/docs-syncer",
    });
  });
});

test("manager maintenance prunes terminal Think submissions", async () => {
  await withNaniteLlmFixture("complete", async () => {
    const manager = await getE2eManager();

    await registerFixtureNanite(manager);

    const run = await startFixtureRuntimeManualRun(manager);
    await waitForRun(manager, run.runId, (status) => status === "complete");
    const debugManager = manager as unknown as NaniteManager;
    const before = await debugManager.inspectNaniteDebug({
      naniteId: "docs-syncer",
      include: ["submissions"],
      submissions: { limit: 10 },
    });

    expect(before.think?.submissions?.map((submission) => submission.submissionId)).toContain(
      run.runId,
    );

    const output = await manager.maintainNanites({
      nowIso: new Date(Date.now() + 60_000).toISOString(),
      terminalSubmissionRetentionMs: 0,
    });
    const maintainedAgent = output.maintainedNaniteAgents.find(
      (agent) => agent.naniteId === "docs-syncer",
    );
    const after = await debugManager.inspectNaniteDebug({
      naniteId: "docs-syncer",
      include: ["submissions"],
      submissions: { limit: 10 },
    });

    expect(maintainedAgent?.deletedSubmissions).toBeGreaterThan(0);
    expect(after.think?.submissions?.map((submission) => submission.submissionId)).not.toContain(
      run.runId,
    );
  });
});

test("generated pull request trigger can start a real Nanite and return authoring feedback", async () => {
  await withNaniteLlmFixture("complete", async () => {
    const manager = await getE2eManager();
    await manager.registerNanite({
      manifest: {
        id: "trigger-tested-docs-syncer",
        name: "Trigger-tested docs syncer",
        description: "Accepts pull request events and reports trigger test feedback.",
        trigger: {
          type: "github",
          event: "pull_request",
          repositories: ["WebMCP-org/nanites"],
          actions: ["opened"],
        },
        inboundTrigger: {
          sourceCode: `
export default {
  async handle(event, ctx) {
    if (event.type !== "github.pull_request") {
      return ctx.noop("Not a pull request event.");
    }

    if (event.payload.action !== "opened") {
      return ctx.noop("Only opened pull requests wake this Nanite.");
    }

    return ctx.dispatchSelf({
      reason: "Generated trigger accepted trigger-test pull request.",
      repository: event.payload.repository.full_name,
      pullNumber: event.payload.pull_request.number,
    });
  },
};
`,
        },
        permissions: {},
      },
    });

    const payload = buildGitHubPullRequestFixture({
      fixture: "github.pull_request.opened",
      installationId: 1,
      overrides: {
        repository: {
          full_name: "WebMCP-org/nanites",
          name: "nanites",
          owner: { login: "WebMCP-org" },
        },
      },
    });
    const dispatches = await manager.handleGitHubPullRequestWebhook({
      githubInstallationId: githubInstallationIdSchema.parse(1),
      deliveryId: `trigger-test-${crypto.randomUUID()}`,
      payload,
      onlyNaniteId: "trigger-tested-docs-syncer",
      dispatchInput: {
        sigveloTriggerTest: true,
        sigveloTestInstruction:
          "This is a trigger acceptance test. Do not modify GitHub. Complete immediately with authoring feedback.",
      },
    });

    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.created).toBe(true);
    const dispatchedRun = await manager.dispatchRun({ runId: dispatches[0]?.run.runId ?? "" });
    const completedRun = await waitForRun(
      manager,
      dispatchedRun.runId,
      (status) => status === "complete",
    );

    expect(completedRun).toMatchObject({
      naniteId: "trigger-tested-docs-syncer",
      status: "complete",
      trigger: {
        type: "github",
        event: "pull_request",
        input: {
          reason: "Generated trigger accepted trigger-test pull request.",
          sigveloTriggerTest: true,
          sigveloTestInstruction:
            "This is a trigger acceptance test. Do not modify GitHub. Complete immediately with authoring feedback.",
        },
      },
      agentFeedback: {
        severity: "info",
        message: "The trigger reached the Nanite model with usable runtime context.",
      },
    });
  });
});

test("trigger acceptance failures return before creating a Nanite run", async () => {
  const manager = await getE2eManager();
  await manager.registerNanite({
    manifest: {
      id: "broken-trigger-docs-syncer",
      name: "Broken trigger docs syncer",
      description: "Exercises trigger authoring diagnostics.",
      trigger: {
        type: "github",
        event: "pull_request",
        repositories: ["WebMCP-org/nanites"],
        actions: ["opened"],
      },
      inboundTrigger: {
        sourceCode: `
export default {
  async handle() {
    throw new Error("generated trigger exploded before dispatch");
  },
};
`,
      },
      permissions: {},
    },
  });

  const payload = buildGitHubPullRequestFixture({
    fixture: "github.pull_request.opened",
    installationId: 1,
    overrides: {
      repository: {
        full_name: "WebMCP-org/nanites",
        name: "nanites",
        owner: { login: "WebMCP-org" },
      },
    },
  });

  const triggerResult = await manager.testGeneratedTrigger({
    naniteId: "broken-trigger-docs-syncer",
    event: {
      type: "github.pull_request",
      deliveryId: `broken-trigger-test-${crypto.randomUUID()}`,
      payload,
    },
  });

  expect(triggerResult).toMatchObject({
    ok: false,
    hasGeneratedTrigger: true,
    accepted: false,
  });
  expect(triggerResult.error).toContain("phase=response");
  expect(triggerResult.error).toContain("generated trigger exploded before dispatch");
  expect(triggerResult.error).toContain("sourceBytes=");
  expect((await manager.getSnapshot()).runOrder).toEqual([]);
});

test("GitHub pull request trigger fixtures cover supported actions", () => {
  expect(
    [
      "github.pull_request.opened",
      "github.pull_request.synchronize",
      "github.pull_request.reopened",
      "github.pull_request.closed",
    ].map(
      (fixture) =>
        buildGitHubPullRequestFixture({
          fixture: fixture as Parameters<typeof buildGitHubPullRequestFixture>[0]["fixture"],
          installationId: 1,
        }).action,
    ),
  ).toEqual(["opened", "synchronize", "reopened", "closed"]);
});

test("generated push trigger can start a real Nanite", async () => {
  await withNaniteLlmFixture("complete", async () => {
    const manager = await getE2eManager();
    await manager.registerNanite({
      manifest: {
        id: "push-tested-package-docs",
        name: "Push-tested package docs",
        description: "Accepts package repository pushes and reports trigger context.",
        trigger: {
          type: "github",
          event: "push",
          repository: "WebMCP-org/npm-packages",
          branch: "main",
        },
        inboundTrigger: {
          sourceCode: `
export default {
  async handle(event, ctx) {
    if (event.type !== "github.push") {
      return ctx.noop("Not a push event.");
    }

    if (event.payload.repository.full_name !== "WebMCP-org/npm-packages") {
      return ctx.noop("Not the package repo.");
    }

    return ctx.dispatchSelf({
      reason: "Generated trigger accepted package push.",
      repository: event.payload.repository.full_name,
      afterSha: event.payload.after,
    });
  },
};
`,
        },
        permissions: {},
      },
    });

    const payload = buildGitHubPushFixture({
      installationId: 1,
      repository: "WebMCP-org/npm-packages",
      branch: "main",
      afterSha: "pushtriggerfixture1",
    });
    const dispatches = await manager.handleGitHubPushWebhook({
      githubInstallationId: githubInstallationIdSchema.parse(1),
      deliveryId: `push-trigger-test-${crypto.randomUUID()}`,
      payload,
      onlyNaniteId: "push-tested-package-docs",
      dispatchInput: {
        sigveloTriggerTest: true,
        sigveloTestInstruction:
          "This is a push trigger acceptance test. Do not modify GitHub. Complete immediately with authoring feedback.",
      },
    });

    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.created).toBe(true);
    const dispatchedRun = await manager.dispatchRun({ runId: dispatches[0]?.run.runId ?? "" });
    const completedRun = await waitForRun(
      manager,
      dispatchedRun.runId,
      (status) => status === "complete",
    );

    expect(completedRun).toMatchObject({
      naniteId: "push-tested-package-docs",
      status: "complete",
      trigger: {
        type: "github",
        event: "push",
        repository: "WebMCP-org/npm-packages",
        branch: "main",
        afterSha: "pushtriggerfixture1",
        input: {
          reason: "Generated trigger accepted package push.",
          sigveloTriggerTest: true,
        },
      },
    });
  });
});

test("fixture runtime can finish no-change through the stable lifecycle tool", async () => {
  await withNaniteLlmFixture("no_change", async () => {
    const manager = await getE2eManager();

    await registerFixtureNanite(manager);

    const run = await startFixtureRuntimeManualRun(manager);
    const noChangeRun = await waitForRun(manager, run.runId, (status) => status === "no_change");

    expect(noChangeRun).toMatchObject({
      status: "no_change",
      summary: "Docs sync inspected the trigger and found no documentation changes needed.",
      outputUrl: null,
    });
  });
});

test("runtime caps oversized tool output inline and preserves the artifact for follow-up reads", async () => {
  await withNaniteLlmFixture("tool_output_budget", async () => {
    const manager = await getE2eManager();

    await registerFixtureNanite(manager);

    const run = await startFixtureRuntimeManualRun(manager);
    const noChangeRun = await waitForRun(manager, run.runId, (status) => status === "no_change");

    expect(noChangeRun).toMatchObject({
      status: "no_change",
      summary:
        "Verified large tool output was capped inline and preserved as a temporary KV artifact.",
      outputUrl: null,
    });

    const workspaceRoot = await (manager as unknown as NaniteManager).exploreNaniteWorkspace({
      naniteId: "docs-syncer",
      action: "list",
      path: "/",
      limit: 100,
    });

    expect(workspaceRoot.action).toBe("list");
    if (workspaceRoot.action !== "list") {
      throw new Error("Expected workspace list result.");
    }
    expect(workspaceRoot.entries.map((entry) => entry.path)).not.toContain("/.sigvelo");
  });
});

test("fixture runtime can pause for a human decision through the stable lifecycle tool", async () => {
  await withNaniteLlmFixture("ask_human", async () => {
    const manager = await getE2eManager();

    await registerFixtureNanite(manager);

    const run = await startFixtureRuntimeManualRun(manager);
    const waitingRun = await waitForRun(
      manager,
      run.runId,
      (status) => status === "waiting_for_human",
    );

    expect(waitingRun).toMatchObject({
      status: "waiting_for_human",
      summary: "Need contents:write before opening the documentation PR.",
      completedAt: null,
      humanRequest: {
        summary: "Need contents:write before opening the documentation PR.",
        requestedScopes: ["contents:write"],
        resolvedAt: null,
      },
    });
    const snapshot = await manager.getSnapshot();
    expect(snapshot.runtimeActivityByNanite["docs-syncer"]).toMatchObject({
      state: "waiting_for_human",
      runId: run.runId,
      error: null,
    });
  });
});

test("completed Think submission without a lifecycle tool fails instead of staying running", async () => {
  await withNaniteLlmFixture("no_lifecycle", async () => {
    const manager = await getE2eManager();

    await registerFixtureNanite(manager);

    const run = await startFixtureRuntimeManualRun(manager);
    const failedRun = await waitForRun(manager, run.runId, (status) => status === "fail");

    expect(failedRun).toMatchObject({
      status: "fail",
    });
    expect(failedRun.summary).toContain(
      "The Think turn completed before the Nanite reported a lifecycle outcome.",
    );
    expect(failedRun.summary).toContain("Submission status: completed.");
    expect(failedRun.summary).toContain("Lifecycle continuation attempted: yes.");
    expect(failedRun.summary).toContain("Last step:");
    const debugManager = manager as unknown as NaniteManager;
    const debug = await debugManager.inspectNaniteDebug({
      naniteId: "docs-syncer",
      include: ["submissions"],
      submissions: { limit: 10 },
    });
    expect(debug.think?.submissions?.map((submission) => submission.submissionId)).toContain(
      `${run.runId}:lifecycle-continuation`,
    );
    const snapshot = await manager.getSnapshot();
    expect(snapshot.runtimeActivityByNanite["docs-syncer"]).toMatchObject({
      state: "idle",
      runId: run.runId,
      toolName: null,
    });
  });
});

test("sub-agent route serves the stable Think transcript directly", async () => {
  const githubInstallationId = githubInstallationIdSchema.parse(
    createFixtureGitHubInstallationId(),
  );
  const managerName = buildNaniteManagerKey(githubInstallationId);
  const manager = await getAgentByName(
    env.SigveloNaniteManager as DurableObjectNamespace<NaniteManager>,
    managerName,
  );
  await registerFixtureNanite(manager);
  const run = await startFixtureRuntimeManualRun(manager);
  await waitForRun(manager, run.runId, (status) => status === "complete");
  const cookieHeader = await buildAuthenticatedNanitesCookieHeader(githubInstallationId);

  const messages = await fetchNaniteMessages({
    managerName,
    naniteId: "docs-syncer",
    cookieHeader,
  });
  expect(
    messages.some(
      (message) =>
        message.role === "user" &&
        getMessageTextContent(message).includes(`Start Nanite work attempt ${run.runId}.`),
    ),
  ).toBe(true);
  expect(
    messages.some(
      (message) =>
        message.role === "assistant" &&
        getMessageTextContent(message).includes(
          "The host accepted my lifecycle tool call and linked the transcript to the run.",
        ),
    ),
  ).toBe(true);

  const lifecycleOutputs = getNaniteLifecycleToolOutputs(messages, "complete");
  expect(lifecycleOutputs).toContainEqual({
    accepted: true,
    status: "complete",
    summary: "Docs sync completed through the mocked provider layer.",
    outputUrl: "https://example.com/runs/docs-syncer",
  });
  const serializedLifecycleOutputs = JSON.stringify(lifecycleOutputs);
  expect(serializedLifecycleOutputs).not.toContain('"runId"');
  expect(serializedLifecycleOutputs).not.toContain('"trigger"');
  expect(serializedLifecycleOutputs).not.toContain('"versionId"');
});

test("multiple manager-dispatched runs stay visible through the direct Think transcript", async () => {
  const githubInstallationId = githubInstallationIdSchema.parse(
    createFixtureGitHubInstallationId(),
  );
  const managerName = buildNaniteManagerKey(githubInstallationId);
  const manager = await getAgentByName(
    env.SigveloNaniteManager as DurableObjectNamespace<NaniteManager>,
    managerName,
  );
  await registerFixtureNanite(manager);

  const firstRunRecord = await manager.startRun({
    naniteId: "docs-syncer",
    trigger: {
      type: "manual",
      requestId: `manual-first-${crypto.randomUUID()}`,
      actorId: null,
      message: "FIRST_RUN_SENTINEL",
    },
  });
  const firstRun = await manager.dispatchRun({ runId: firstRunRecord.runId });
  await waitForRun(manager, firstRun.runId, (status) => status === "complete");

  const secondRunRecord = await manager.startRun({
    naniteId: "docs-syncer",
    trigger: {
      type: "manual",
      requestId: `manual-second-${crypto.randomUUID()}`,
      actorId: null,
      message: "SECOND_RUN_SENTINEL",
    },
  });
  const secondRun = await manager.dispatchRun({ runId: secondRunRecord.runId });
  await waitForRun(manager, secondRun.runId, (status) => status === "complete");

  const messages = await fetchNaniteMessages({
    managerName,
    naniteId: "docs-syncer",
    cookieHeader: await buildAuthenticatedNanitesCookieHeader(githubInstallationId),
  });
  const transcript = messages.map(getMessageTextContent).join("\n\n");

  expect(transcript).toContain(`Start Nanite work attempt ${firstRun.runId}.`);
  expect(transcript).toContain("FIRST_RUN_SENTINEL");
  expect(transcript).toContain(`Start Nanite work attempt ${secondRun.runId}.`);
  expect(transcript).toContain("SECOND_RUN_SENTINEL");
  expect(messages.filter((message) => message.role === "user")).toHaveLength(2);
});

test("oRPC creates a Nanite on the real manager without starting a run", async () => {
  const githubInstallationId = createFixtureGitHubInstallationId();
  const cookie = await buildAuthenticatedNanitesCookieHeader(githubInstallationId);
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request("http://example.com/api/nanites/create", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(
        createNaniteInputSchema.parse({
          manifest: {
            id: "docs-syncer",
            name: "Docs syncer",
            description: "Updates repo B documentation after repo A changes on main.",
            trigger: { type: "manual" },
            permissions: {},
          },
        }),
      ),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  expect(response.status).toBe(200);
  const output = await parseJsonResponse(response, createNaniteOutputSchema);
  expect(output).toMatchObject({
    managerName: `installation:${githubInstallationId}`,
    naniteId: "docs-syncer",
  });

  const manager = await getAgentByName(
    env.SigveloNaniteManager as DurableObjectNamespace<NaniteManager>,
    output.managerName,
  );
  const snapshot = await manager.getSnapshot();
  expect(snapshot.nanites["docs-syncer"]?.latestVersion.manifestHash).toBe(output.manifestHash);
  expect(snapshot.runOrder).toHaveLength(0);
});

test("manager stores GitHub MCP tier-derived app permissions on registration", async () => {
  const manager = await getE2eManager();

  await manager.registerNanite({
    manifest: {
      id: "pr-author",
      name: "PR author",
      description: "Exercises permission derivation from GitHub MCP tiers.",
      trigger: { type: "manual" },
      permissions: {
        github: {
          repositories: ["WebMCP-org/nanites"],
          appPermissions: {},
        },
      },
      capabilities: {
        githubMcp: {
          tier: "github_pr_author",
        },
      },
    },
  });

  const snapshot = await manager.getSnapshot();
  expect(snapshot.nanites["pr-author"]?.manifest.permissions.github?.appPermissions).toEqual({
    pull_requests: "write",
  });
});

test("oRPC can inspect manager state without runtime transcript shims", async () => {
  const githubInstallationId = createFixtureGitHubInstallationId();
  const cookie = await buildAuthenticatedNanitesCookieHeader(githubInstallationId);
  const createCtx = createExecutionContext();
  const createResponse = await worker.fetch(
    new Request("http://example.com/api/nanites/create", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(
        createNaniteInputSchema.parse({
          manifest: {
            id: "docs-syncer",
            name: "Docs syncer",
            description: "Updates repo B documentation after repo A changes on main.",
            trigger: { type: "manual" },
            permissions: {},
          },
        }),
      ),
    }),
    env,
    createCtx,
  );
  await waitOnExecutionContext(createCtx);

  expect(createResponse.status).toBe(200);
  const createOutput = await parseJsonResponse(createResponse, createNaniteOutputSchema);
  const managerName = createOutput.managerName;

  const managerResponse = await worker.fetch(
    new Request(`http://example.com/api/nanites/manager/${encodeURIComponent(managerName)}`, {
      headers: { cookie },
    }),
    env,
    createExecutionContext(),
  );
  expect(managerResponse.status).toBe(200);
  const managerOutput = await parseJsonResponse(managerResponse, managerStateOutputSchema);
  expect(managerOutput).toMatchObject({
    managerName,
    state: {
      nanites: {
        "docs-syncer": {
          manifest: {
            name: "Docs syncer",
          },
        },
      },
    },
  });
});
