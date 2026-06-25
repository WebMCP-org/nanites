import {
  isTerminalNaniteRunRecord,
  type InspectNaniteDebugInput,
  type InspectNaniteDebugOutput,
  type NaniteManagerState,
  type RunWorkflowDebugRecord,
  type TerminalNaniteRunRecord,
} from "#/backend/agents/SigveloNaniteManager.ts";

type DisposableRpcResult = {
  [Symbol.dispose]?: () => void;
};

function detachRpcResult<T>(value: T): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const detached = structuredClone(value) as T;
  (value as DisposableRpcResult)[Symbol.dispose]?.();
  return detached;
}

export function withDetachedRpcResults<T extends object>(rpc: T): T {
  return new Proxy(rpc, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") {
        return value;
      }

      return (...args: unknown[]) => {
        const result = (value as (...args: unknown[]) => unknown)(...args);
        if (
          result &&
          typeof result === "object" &&
          typeof (result as PromiseLike<unknown>).then === "function"
        ) {
          return Promise.resolve(result)
            .then(detachRpcResult)
            .finally(() => (result as DisposableRpcResult)[Symbol.dispose]?.());
        }

        return detachRpcResult(result);
      };
    },
  });
}

export async function waitForTerminalRun(
  manager: {
    getSnapshot(): Promise<Pick<NaniteManagerState, "runs">>;
  },
  input: { runId: string; naniteId?: never } | { naniteId: string; runId?: never },
): Promise<TerminalNaniteRunRecord> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const runs = (await manager.getSnapshot()).runs;
    const run = input.runId
      ? runs[input.runId]
      : Object.values(runs).find((candidate) => candidate.naniteId === input.naniteId);
    if (run && isTerminalNaniteRunRecord(run)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    input.runId
      ? `Run ${input.runId} did not reach a terminal status in time.`
      : `Nanite ${input.naniteId} did not reach a terminal run in time.`,
  );
}

export async function waitForRunWorkflowStatus(
  manager: {
    inspectNaniteDebug(input?: InspectNaniteDebugInput): Promise<InspectNaniteDebugOutput>;
  },
  input: {
    runId: string;
    status?: string;
    timeoutMs?: number;
    intervalMs?: number;
  },
): Promise<RunWorkflowDebugRecord> {
  const status = input.status ?? "complete";
  const deadline = Date.now() + (input.timeoutMs ?? 10_000);
  const intervalMs = input.intervalMs ?? 100;

  while (Date.now() < deadline) {
    const workflow = (
      await manager.inspectNaniteDebug({
        runId: input.runId,
        include: ["workflows"],
      })
    ).workflows?.[0];
    if (workflow?.workflow?.status === status) {
      return workflow;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Run ${input.runId} Workflow tracking did not reach ${status} in time.`);
}
