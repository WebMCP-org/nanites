import { z } from "zod";
import type { NaniteWorkspaceExploreOutput } from "#/backend/agents/SigveloNaniteAgent.ts";
import {
  createObjectOutputSchema,
  defineSigveloMcpTool,
  nonEmptyStringSchema,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";

// MCP tool registration only advertises top-level object schemas; a top-level
// discriminated union is published as an empty input schema, so clients never see
// the parameters. Advertise this flat object and enforce the per-action rules below.
const exploreWorkspaceToolInputSchema = z
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

const exploreWorkspaceActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("info"),
    naniteId: nonEmptyStringSchema,
  }),
  z.object({
    action: z.literal("list"),
    naniteId: nonEmptyStringSchema,
    path: nonEmptyStringSchema.default("/"),
    limit: z.number().int().min(1).max(1_000).default(200),
  }),
  z.object({
    action: z.literal("read"),
    naniteId: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
    maxBytes: z.number().int().min(1_000).max(1_000_000).default(100_000),
  }),
  z.object({
    action: z.literal("search"),
    naniteId: nonEmptyStringSchema,
    path: nonEmptyStringSchema.default("/"),
    query: nonEmptyStringSchema,
    limit: z.number().int().min(1).max(500).default(50),
    maxFileBytes: z.number().int().min(1_000).max(1_000_000).default(200_000),
  }),
]);

export const exploreWorkspaceTool = defineSigveloMcpTool({
  name: "sigvelo_explore_nanite_workspace",
  title: "Explore a SigVelo Nanite workspace",
  description:
    "Reads child-owned Think workspace information, directory listings, file content, or text search results for one Nanite.",
  inputSchema: exploreWorkspaceToolInputSchema,
  outputSchema: createObjectOutputSchema("SigVelo Nanite workspace exploration result."),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async execute(input, { manager }) {
    return manager.exploreNaniteWorkspace(exploreWorkspaceActionSchema.parse(input));
  },
} satisfies SigveloMcpToolDefinition<
  typeof exploreWorkspaceToolInputSchema,
  NaniteWorkspaceExploreOutput
>);
