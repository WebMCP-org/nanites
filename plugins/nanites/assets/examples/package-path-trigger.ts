type PushCommit = {
  added?: string[];
  modified?: string[];
  removed?: string[];
};

type PushEvent = {
  type: string;
  payload: {
    repository: {
      full_name: string;
    };
    ref?: string;
    before?: string;
    after?: string;
    commits?: PushCommit[];
  };
};

type TriggerIntent = Record<string, unknown>;

type TriggerContext = {
  noop(reason: string): TriggerIntent;
  dispatchSelf(input?: Record<string, unknown>): TriggerIntent;
};

const ownedPackagePrefix = "packages/react-webmcp/";

export default {
  async handle(event: PushEvent, ctx: TriggerContext) {
    if (event.type !== "github.push") {
      return ctx.noop("Not a push event.");
    }

    if (event.payload.repository.full_name !== "WebMCP-org/npm-packages") {
      return ctx.noop("Different repository.");
    }

    if (event.payload.ref !== "refs/heads/main") {
      return ctx.noop(`Ignoring non-main ref: ${event.payload.ref ?? "unknown"}`);
    }

    const changed =
      event.payload.commits?.flatMap((commit) => [
        ...(commit.added ?? []),
        ...(commit.modified ?? []),
        ...(commit.removed ?? []),
      ]) ?? [];

    const relevant = changed.filter((file) => file.startsWith(ownedPackagePrefix));
    if (relevant.length === 0) {
      return ctx.noop(`No ${ownedPackagePrefix} files changed.`);
    }

    return ctx.dispatchSelf({
      reason: "Owned package changed",
      packageName: "react-webmcp",
      repository: event.payload.repository.full_name,
      before: event.payload.before,
      after: event.payload.after,
      files: relevant.slice(0, 80),
    });
  },
};
