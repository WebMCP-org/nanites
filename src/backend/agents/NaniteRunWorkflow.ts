import { ThinkWorkflow, type ThinkWorkflowStep } from "@cloudflare/think/workflows";
import type { AgentWorkflowEvent } from "agents/workflows";
import { z } from "zod";
import type {
  NaniteWorkspaceCheckout,
  SigveloNaniteAgent,
} from "#/backend/agents/SigveloNaniteAgent.ts";
import type { NaniteAgentFeedback } from "#/backend/agents/SigveloNaniteManager.ts";

export const NANITE_RUN_WORKFLOW_NAME = "NANITE_RUN_WORKFLOW";

export type NaniteRunWorkflowParams = {
  runId: string;
  managerName: string;
};

const agentFeedbackSchema: z.ZodType<NaniteAgentFeedback> = z.object({
  severity: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
  suggestions: z.array(z.string().min(1)).optional(),
});

export const naniteRunWorkflowResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("complete"),
    summary: z.string().min(1),
    outputUrl: z.string().url().nullable(),
    agentFeedback: agentFeedbackSchema.nullable(),
  }),
  z.object({
    kind: z.literal("no_change"),
    summary: z.string().min(1),
    agentFeedback: agentFeedbackSchema.nullable(),
  }),
  z.object({
    kind: z.literal("fail"),
    summary: z.string().min(1),
    agentFeedback: agentFeedbackSchema.nullable(),
  }),
  z.object({
    kind: z.literal("ask_manager"),
    request: z.string().min(1),
  }),
]);

const naniteRunWorkflowOutputSchema = z.object({
  result: naniteRunWorkflowResultSchema,
});

export type NaniteRunWorkflowResult = z.infer<typeof naniteRunWorkflowResultSchema>;

export class NaniteRunWorkflow extends ThinkWorkflow<
  SigveloNaniteAgent,
  NaniteRunWorkflowParams,
  never,
  Env
> {
  async run(
    event: AgentWorkflowEvent<NaniteRunWorkflowParams>,
    step: ThinkWorkflowStep,
  ): Promise<NaniteRunWorkflowResult> {
    const { runId, managerName } = event.payload;
    const workspaceCheckouts = await step.do<NaniteWorkspaceCheckout[]>(
      "prepare-workspace",
      async () => this.agent.prepareWorkflowWorkspace({ managerName, runId }),
    );
    const prompt = await step.do<string>("prepare-run-prompt", async () =>
      this.agent.prepareWorkflowRun({ managerName, runId, workspaceCheckouts }),
    );

    const output = await step.prompt("nanite-run", {
      key: runId,
      prompt,
      output: naniteRunWorkflowOutputSchema,
      timeout: "7 days",
    });

    await step.reportComplete(output.result);
    return output.result;
  }
}
