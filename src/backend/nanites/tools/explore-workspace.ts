import { z } from "zod";
import type { NaniteWorkspaceExploreOutput } from "#/backend/agents/SigveloNaniteAgent.ts";
import {
  createObjectOutputSchema,
  defineSigveloMcpTool,
  nonEmptyStringSchema,
  optionalNaniteManagerNameSchema,
  type SigveloMcpToolDefinition,
} from "#/backend/nanites/tools/define-tool.ts";

const exploreWorkspaceToolInputSchema = z
  .discriminatedUnion("action", [
    z.object({
      action: z.literal("info"),
      managerName: optionalNaniteManagerNameSchema,
      naniteId: nonEmptyStringSchema,
    }),
    z.object({
      action: z.literal("list"),
      managerName: optionalNaniteManagerNameSchema,
      naniteId: nonEmptyStringSchema,
      path: nonEmptyStringSchema.default("/"),
      limit: z.number().int().min(1).max(1_000).default(200),
    }),
    z.object({
      action: z.literal("read"),
      managerName: optionalNaniteManagerNameSchema,
      naniteId: nonEmptyStringSchema,
      path: nonEmptyStringSchema,
      maxBytes: z.number().int().min(1_000).max(1_000_000).default(100_000),
    }),
    z.object({
      action: z.literal("search"),
      managerName: optionalNaniteManagerNameSchema,
      naniteId: nonEmptyStringSchema,
      path: nonEmptyStringSchema.default("/"),
      query: nonEmptyStringSchema,
      limit: z.number().int().min(1).max(500).default(50),
      maxFileBytes: z.number().int().min(1_000).max(1_000_000).default(200_000),
    }),
  ])
  .describe("Explore a Nanite's child-owned Think workspace.");

export const exploreWorkspaceTool = defineSigveloMcpTool({
  name: "sigvelo_explore_nanite_workspace",
  title: "Explore a Sigvelo Nanite workspace",
  description:
    "Reads child-owned Think workspace information, directory listings, file content, or text search results for one Nanite.",
  inputSchema: exploreWorkspaceToolInputSchema,
  outputSchema: createObjectOutputSchema("Sigvelo Nanite workspace exploration result."),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async execute(input, { manager }) {
    return manager.exploreNaniteWorkspace(input);
  },
} satisfies SigveloMcpToolDefinition<
  typeof exploreWorkspaceToolInputSchema,
  NaniteWorkspaceExploreOutput
>);
