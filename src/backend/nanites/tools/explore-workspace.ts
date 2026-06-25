import { MCP_SCOPES } from "#/shared/constants.ts";
import { z } from "zod";
import type { NaniteWorkspaceExploreOutput } from "#/backend/agents/SigveloNaniteAgent.ts";
import type { ExploreNaniteWorkspaceInput } from "#/backend/agents/SigveloNaniteManager.ts";
import {
  createObjectOutputSchema,
  defineSigveloMcpTool,
  nonEmptyStringSchema,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";

// MCP tool registration only advertises top-level object schemas; a top-level
// discriminated union is published as an empty input schema, so clients never see
// the parameters. Advertise this flat object and enforce the per-action rules below.
const exploreWorkspaceFlatToolInputSchema = z
  .object({
    action: z
      .enum(["info", "list", "read", "search"])
      .describe("Workspace exploration action to perform."),
    naniteId: nonEmptyStringSchema,
    path: nonEmptyStringSchema
      .optional()
      .describe('Workspace path. Required for "read"; defaults to "/" for "list" and "search".'),
    query: nonEmptyStringSchema.optional().describe('Search text. Required for "search".'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1_000)
      .optional()
      .describe(
        'Maximum entries for "list" (default 200) or matches for "search" (default 50, max 500).',
      ),
    maxBytes: z
      .number()
      .int()
      .min(1_000)
      .max(1_000_000)
      .optional()
      .describe('Maximum bytes returned by "read" (default 100000).'),
    maxFileBytes: z
      .number()
      .int()
      .min(1_000)
      .max(1_000_000)
      .optional()
      .describe('Per-file scan limit in bytes for "search" (default 200000).'),
  })
  .describe("Explore a Nanite's child-owned Think workspace.");

const exploreWorkspaceToolInputSchema = exploreWorkspaceFlatToolInputSchema.refine(
  (input) =>
    (input.action !== "read" || input.path !== undefined) &&
    (input.action !== "search" || input.query !== undefined),
  {
    message: 'The "read" action requires path and the "search" action requires query.',
  },
);

function toExploreWorkspaceInput(
  input: z.output<typeof exploreWorkspaceToolInputSchema>,
): ExploreNaniteWorkspaceInput {
  switch (input.action) {
    case "info":
      return {
        action: "info",
        naniteId: input.naniteId,
      };
    case "list":
      return {
        action: "list",
        naniteId: input.naniteId,
        path: input.path ?? "/",
        limit: input.limit ?? 200,
      };
    case "read":
      return {
        action: "read",
        naniteId: input.naniteId,
        path: input.path!,
        maxBytes: input.maxBytes ?? 100_000,
      };
    case "search":
      return {
        action: "search",
        naniteId: input.naniteId,
        path: input.path ?? "/",
        query: input.query!,
        limit: input.limit ?? 50,
        maxFileBytes: input.maxFileBytes ?? 200_000,
      };
  }
}

export const exploreWorkspaceTool = defineSigveloMcpTool({
  name: "sigvelo_explore_nanite_workspace",
  title: "Explore a SigVelo Nanite workspace",
  description:
    "Reads child-owned Think workspace information, directory listings, file content, or text search results for one Nanite.",
  inputSchema: exploreWorkspaceToolInputSchema,
  outputSchema: createObjectOutputSchema("SigVelo Nanite workspace exploration result."),
  requiredScope: MCP_SCOPES.read,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async execute(input, { manager }) {
    return manager.exploreNaniteWorkspace(toExploreWorkspaceInput(input));
  },
} satisfies SigveloMcpToolDefinition<
  typeof exploreWorkspaceToolInputSchema,
  NaniteWorkspaceExploreOutput
>);
