import { DEFAULT_SIGVELO_AGENT_MODEL_ID } from "#/shared/constants.ts";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import type { NaniteRunWorkflowResult } from "#/backend/agents/NaniteRunWorkflow.ts";

// AI Gateway policy. The provisioner writes the gateway config with these values,
// and runtime deployments keep using the same identifier after install.
// The default model id lives in #/shared/constants.ts so the browser can share it.
export const NANITES_AI_GATEWAY_ID = "sigvelo-nanites";

type WorkersAIBinding = NonNullable<Parameters<typeof createWorkersAI>[0]["binding"]>;

function createPromptCachedWorkersAIModel(input: {
  binding: WorkersAIBinding;
  model: string;
  sessionAffinity: string;
  gatewayId?: string;
  gatewayMetadata?: Record<string, string>;
}) {
  // Workers AI maps sessionAffinity to the x-session-affinity header so
  // repeated turns for the same durable agent instance can reuse prefix-cache state.
  return createWorkersAI({ binding: input.binding })(input.model, {
    sessionAffinity: input.sessionAffinity,
    ...(input.gatewayId
      ? {
          gateway: {
            id: input.gatewayId,
            skipCache: true,
            metadata: input.gatewayMetadata,
          },
        }
      : {}),
  });
}

type SigveloAgentLanguageModelInput = {
  env: Env;
  sessionAffinity: string;
  gatewayMetadata?: Record<string, string>;
  /** Override the default agent model (e.g. a user-picked model from the dropdown). */
  modelId?: string;
};

function createConfiguredTestLanguageModel(input: { env: Env }): LanguageModel | null {
  const testFixture = input.env.NANITES_LLM_FIXTURE ?? "";
  if (
    testFixture === "complete" ||
    testFixture === "no_change" ||
    testFixture === "ask_manager" ||
    testFixture === "no_lifecycle" ||
    testFixture === "github_mcp_issue_actions" ||
    testFixture === "tool_output_budget"
  ) {
    const fixtureFetch: typeof fetch = async (_url, init) => {
      const requestBody = typeof init?.body === "string" ? init.body : "{}";
      const body = JSON.parse(requestBody) as {
        messages?: Array<{ role?: string }>;
        model?: string;
        tools?: Array<{ function?: { name?: string } }>;
      };
      const model = body.model ?? "gpt-4o-mini";
      const messages = body.messages ?? [];
      const finalAnswerToolName = findThinkFinalAnswerToolName(body.tools);
      let chunks: OpenAIChatChunk[];

      if (testFixture === "github_mcp_issue_actions") {
        const serialized = JSON.stringify(messages);
        if (countToolResultsAfterLatestUser(messages) === 0) {
          chunks = buildToolCallChunks({
            content: "I will call the scoped GitHub MCP issue tools through execute.",
            finishReason: "tool_calls",
            model,
            toolCall: {
              id: "call_github_mcp_issue_actions",
              name: "execute",
              arguments: JSON.stringify({
                code: `async () => {
  await github.issue_write({
    method: "create",
    owner: "WebMCP-org",
    repo: "nanites",
    title: "Nanite fixture follow-up",
    body: "Created by the fixture-backed GitHub MCP issue action test."
  });
  await github.add_issue_comment({
    owner: "WebMCP-org",
    repo: "nanites",
    issue_number: 130,
    body: "Fixture-backed Nanite issue comment."
  });
}`,
              }),
            },
          });
        } else {
          const sawCreatedIssue = serialized.includes("Nanite fixture follow-up");
          const sawIssueComment = serialized.includes("Fixture-backed Nanite issue comment");
          const calledBoth = sawCreatedIssue && sawIssueComment;
          chunks = buildToolCallChunks({
            content: "I called the scoped GitHub MCP issue tools and can finish.",
            finishReason: "tool_calls",
            model,
            toolCall: buildFinalToolCall({
              finalAnswerToolName,
              id: "call_github_mcp_issue_actions_no_change",
              result: {
                kind: "no_change",
                summary: "Called scoped GitHub MCP issue tools.",
                agentFeedback: {
                  severity: calledBoth ? "info" : "error",
                  message: calledBoth
                    ? "GitHub MCP issue actions executed."
                    : "GitHub MCP issue action missed.",
                  suggestions: [
                    `issue_write_called=${String(sawCreatedIssue)}`,
                    `add_issue_comment_called=${String(sawIssueComment)}`,
                  ],
                },
              },
            }),
          });
        }
      } else if (testFixture === "tool_output_budget") {
        chunks = buildToolOutputBudgetFixtureChunks(messages, model, finalAnswerToolName);
      } else {
        const hasToolResult = countToolResultsAfterLatestUser(messages) > 0;
        const toolCall =
          testFixture === "no_lifecycle"
            ? null
            : buildFixtureToolCall(testFixture, finalAnswerToolName);
        chunks = hasToolResult
          ? buildTextChunks({
              content:
                "The host accepted my structured run output and linked the transcript to the run.",
              finishReason: "stop",
              model,
            })
          : toolCall === null
            ? buildTextChunks({
                content: "I inspected the trigger but did not produce a structured run output.",
                finishReason: "stop",
                model,
              })
            : buildToolCallChunks({
                content: "I accepted the trigger and can finish through the host run output.",
                finishReason: "tool_calls",
                model,
                toolCall,
              });
      }

      return new Response(toEventStream(chunks), {
        headers: {
          "content-type": "text/event-stream",
        },
      });
    };

    return createOpenAI({
      apiKey: "mock",
      baseURL: "https://sigvelo.test/aimock-compatible/v1",
      fetch: fixtureFetch,
      name: "aimock-compatible",
    }).chat("gpt-4o-mini");
  }

  const llmBaseUrl = input.env.NANITES_LLM_BASE_URL?.trim() ?? "";
  if (llmBaseUrl) {
    return createOpenAI({
      apiKey: "mock",
      baseURL: llmBaseUrl,
      name: "aimock",
    }).chat("gpt-4o-mini");
  }

  return null;
}

export function createSigveloAgentLanguageModel(
  input: SigveloAgentLanguageModelInput,
): LanguageModel {
  const testLanguageModel = createConfiguredTestLanguageModel(input);
  if (testLanguageModel) {
    return testLanguageModel;
  }

  return createPromptCachedWorkersAIModel({
    binding: input.env.AI,
    model: input.modelId?.trim() || DEFAULT_SIGVELO_AGENT_MODEL_ID,
    sessionAffinity: input.sessionAffinity,
    gatewayId: NANITES_AI_GATEWAY_ID,
    gatewayMetadata: input.gatewayMetadata,
  });
}

export async function createNaniteRunLanguageModel(
  input: SigveloAgentLanguageModelInput & {
    modelId: string;
    gatewayId: string;
  },
): Promise<LanguageModel> {
  const testLanguageModel = createConfiguredTestLanguageModel(input);
  if (testLanguageModel) {
    return testLanguageModel;
  }

  return createPromptCachedWorkersAIModel({
    binding: input.env.AI,
    model: input.modelId,
    sessionAffinity: input.sessionAffinity,
    gatewayId: input.gatewayId,
    gatewayMetadata: input.gatewayMetadata,
  });
}

type NaniteLlmFixture =
  | "complete"
  | "no_change"
  | "ask_manager"
  | "no_lifecycle"
  | "github_mcp_issue_actions"
  | "tool_output_budget";

function buildToolOutputBudgetFixtureChunks(
  messages: readonly { role?: string }[],
  model: string,
  finalAnswerToolName: string | null,
): OpenAIChatChunk[] {
  if (JSON.stringify(messages).includes("call_budget_no_change")) {
    return buildTextChunks({
      content: "The host accepted my no_change run output after the output-budget probe.",
      finishReason: "stop",
      model,
    });
  }

  const toolResultCount = countToolResultsAfterLatestUser(messages);
  if (toolResultCount === 0) {
    return buildToolCallChunks({
      content: "I will run a bounded large-output probe through execute.",
      finishReason: "tool_calls",
      model,
      toolCall: {
        id: "call_budget_execute",
        name: "execute",
        arguments: JSON.stringify({
          code: "() => 'SIGVELO_TOOL_OUTPUT_BUDGET_START\\n' + 'x'.repeat(5000) + '\\nSIGVELO_TOOL_OUTPUT_BUDGET_END'",
          _sigvelo: {
            maxResponseChars: 1200,
          },
        }),
      },
    });
  }

  if (toolResultCount === 1) {
    const artifactId = findLatestToolOutputArtifactId(messages);
    if (artifactId) {
      return buildToolCallChunks({
        content:
          "The large output came back as a bounded artifact notice. I will grep it through the artifact tool.",
        finishReason: "tool_calls",
        model,
        toolCall: {
          id: "call_budget_artifact_read",
          name: "artifact_read",
          arguments: JSON.stringify({
            artifactId,
            pattern: "SIGVELO_TOOL_OUTPUT_BUDGET_END",
            matchLimit: 10,
          }),
        },
      });
    }
  }

  if (toolResultCount >= 2) {
    return buildToolCallChunks({
      content:
        "The large output came back as a bounded artifact notice and was grep-readable through the artifact tool, so I can finish.",
      finishReason: "tool_calls",
      model,
      toolCall: buildFinalToolCall({
        finalAnswerToolName,
        id: "call_budget_no_change",
        result: {
          kind: "no_change",
          summary:
            "Verified large tool output was capped inline and preserved as a current-run KV artifact.",
          agentFeedback: null,
        },
      }),
    });
  }

  return buildTextChunks({
    content: "The host accepted my no_change run output after the output-budget probe.",
    finishReason: "stop",
    model,
  });
}

function findLatestToolOutputArtifactId(messages: readonly unknown[]): string | null {
  const serialized = JSON.stringify(messages);
  return serialized.match(/toolout_[a-f0-9]{32}/)?.[0] ?? null;
}

function countToolResultsAfterLatestUser(messages: readonly { role?: string }[]): number {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }

  const currentTurnMessages = latestUserIndex >= 0 ? messages.slice(latestUserIndex + 1) : messages;

  return currentTurnMessages.filter((message) => message.role === "tool").length;
}

function buildFixtureToolCall(
  fixture: Exclude<NaniteLlmFixture, "no_lifecycle">,
  finalAnswerToolName: string | null,
): {
  name: string;
  arguments: string;
} {
  if (fixture === "no_change") {
    return buildFinalToolCall({
      finalAnswerToolName,
      result: {
        kind: "no_change",
        summary: "Docs sync inspected the trigger and found no documentation changes needed.",
        agentFeedback: null,
      },
    });
  }

  if (fixture === "ask_manager") {
    return buildFinalToolCall({
      finalAnswerToolName,
      result: {
        kind: "ask_manager",
        request:
          "I tried to open the documentation PR, but the current run does not have enough repository authority. Please update my access so I can continue.",
      },
    });
  }

  return buildFinalToolCall({
    finalAnswerToolName,
    result: {
      kind: "complete",
      summary: "Docs sync completed through the mocked provider layer.",
      outputUrl: "https://example.com/runs/docs-syncer",
      agentFeedback: {
        severity: "info",
        message: "The trigger reached the Nanite model with usable runtime context.",
        suggestions: ["Keep repository, pull number, and head SHA in trigger input."],
      },
    },
  });
}

function buildFinalToolCall(input: {
  finalAnswerToolName: string | null;
  id?: string;
  result: NaniteRunWorkflowResult;
}): {
  id?: string;
  name: string;
  arguments: string;
} {
  if (!input.finalAnswerToolName) {
    throw new Error("Think final-answer tool is required for Nanite run fixtures.");
  }

  return {
    id: input.id,
    name: input.finalAnswerToolName,
    arguments: JSON.stringify({ result: input.result }),
  };
}

function findThinkFinalAnswerToolName(
  tools: Array<{ function?: { name?: string } }> | undefined,
): string | null {
  return (
    tools?.find((candidate) => candidate.function?.name?.startsWith("think_final_answer"))?.function
      ?.name ?? null
  );
}

type OpenAIToolCallDelta = {
  index: number;
  id?: string;
  type?: "function";
  function: {
    name?: string;
    arguments: string;
  };
};

type OpenAIChatDelta =
  | Record<string, never>
  | { role: "assistant"; content: string }
  | { content: string }
  | { tool_calls: OpenAIToolCallDelta[] };

type OpenAIChatChunk = {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: OpenAIChatDelta;
    logprobs: null;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
};

function buildTextChunks(input: {
  content: string;
  finishReason: string;
  model: string;
}): OpenAIChatChunk[] {
  return [
    createChunk(input.model, { role: "assistant", content: "" }),
    createChunk(input.model, { content: input.content }),
    createChunk(input.model, {}, input.finishReason),
    createUsageChunk(input.model),
  ];
}

function buildToolCallChunks(input: {
  content: string;
  finishReason: string;
  model: string;
  toolCall: { id?: string; name: string; arguments: string };
}): OpenAIChatChunk[] {
  const toolCallId = input.toolCall.id ?? "call_done";
  return [
    createChunk(input.model, { role: "assistant", content: "" }),
    createChunk(input.model, { content: input.content }),
    createChunk(input.model, {
      tool_calls: [
        {
          index: 0,
          id: toolCallId,
          type: "function",
          function: { name: input.toolCall.name, arguments: "" },
        },
      ],
    }),
    createChunk(input.model, {
      tool_calls: [{ index: 0, function: { arguments: input.toolCall.arguments } }],
    }),
    createChunk(input.model, {}, input.finishReason),
    createUsageChunk(input.model),
  ];
}

function createChunk(
  model: string,
  delta: OpenAIChatDelta,
  finishReason: string | null = null,
): OpenAIChatChunk {
  return {
    id: "chatcmpl_nanite_fixture",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
  };
}

function createUsageChunk(model: string): OpenAIChatChunk {
  return {
    id: "chatcmpl_nanite_fixture",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 10,
      total_tokens: 20,
    },
  };
}

function toEventStream(chunks: readonly OpenAIChatChunk[]): string {
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
}
