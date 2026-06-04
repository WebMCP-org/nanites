import type { ToolSet } from "ai";
import { cancelRunsTool } from "#/backend/nanites/tools/cancel-runs.ts";
import { createNaniteTool } from "#/backend/nanites/tools/create-nanite.ts";
import { deprovisionTool } from "#/backend/nanites/tools/deprovision.ts";
import {
  createSigveloThinkTool,
  type AnySigveloMcpToolDefinition,
  type CreateSigveloThinkToolsInput,
} from "#/backend/nanites/tools/define-tool.ts";
import { exploreWorkspaceTool } from "#/backend/nanites/tools/explore-workspace.ts";
import { inspectDebugTool } from "#/backend/nanites/tools/inspect-debug.ts";
import { resetDebugTool } from "#/backend/nanites/tools/reset-debug.ts";
import { startNaniteRunTool } from "#/backend/nanites/tools/start-run.ts";
import { testNaniteTriggerTool } from "#/backend/nanites/tools/test-trigger.ts";
import { whoamiTool } from "#/backend/nanites/tools/whoami.ts";

export const naniteTools = [
  whoamiTool,
  createNaniteTool,
  inspectDebugTool,
  deprovisionTool,
  startNaniteRunTool,
  cancelRunsTool,
  testNaniteTriggerTool,
  exploreWorkspaceTool,
  resetDebugTool,
] as const satisfies readonly AnySigveloMcpToolDefinition[];

export function createSigveloThinkTools(input: CreateSigveloThinkToolsInput): ToolSet {
  return Object.fromEntries(
    naniteTools.map((definition) => [definition.name, createSigveloThinkTool(definition, input)]),
  );
}
