import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import {
  type NanitesRuntimeModelSettings,
  resolveDefaultSigveloAgentModelSettings,
} from "#/backend/nanites/model-settings.ts";

type WorkersAIBinding = NonNullable<Parameters<typeof createWorkersAI>[0]["binding"]>;

interface PromptCachedWorkersAIModelInput {
  binding: WorkersAIBinding;
  model: string;
  sessionAffinity: string;
  gatewayId?: string;
  gatewayMetadata?: Record<string, string>;
}

function createPromptCachedWorkersAIModel(input: PromptCachedWorkersAIModelInput) {
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

interface SigveloAgentLanguageModelInput {
  env: Env;
  sessionAffinity: string;
  gatewayMetadata?: Record<string, string>;
  modelSettings?: NanitesRuntimeModelSettings;
}

export function createSigveloAgentLanguageModel(
  input: SigveloAgentLanguageModelInput,
): LanguageModel {
  const testFixture = String(input.env.NANITES_LLM_FIXTURE);
  if (
    testFixture === "complete" ||
    testFixture === "no_change" ||
    testFixture === "ask_human" ||
    testFixture === "no_lifecycle" ||
    testFixture === "tool_output_budget"
  ) {
    return createOpenAI({
      apiKey: "mock",
      baseURL: "https://sigvelo.test/aimock-compatible/v1",
      fetch: createFixtureOpenAIFetch(testFixture),
      name: "aimock-compatible",
    }).chat("gpt-4o-mini");
  }

  const llmBaseUrl = String(input.env.NANITES_LLM_BASE_URL);
  if (llmBaseUrl) {
    return createOpenAI({
      apiKey: "mock",
      baseURL: llmBaseUrl,
      name: "aimock",
    }).chat("gpt-4o-mini");
  }

  const modelSettings = input.modelSettings ?? resolveDefaultSigveloAgentModelSettings(input.env);

  return createPromptCachedWorkersAIModel({
    binding: input.env.AI,
    model: modelSettings.modelId,
    sessionAffinity: input.sessionAffinity,
    gatewayId: modelSettings.gatewayId || undefined,
    gatewayMetadata: input.gatewayMetadata,
  });
}

type NaniteLlmFixture =
  | "complete"
  | "no_change"
  | "ask_human"
  | "no_lifecycle"
  | "tool_output_budget";

function createFixtureOpenAIFetch(fixture: NaniteLlmFixture): typeof fetch {
  return async (_url, init) => {
    const requestBody = typeof init?.body === "string" ? init.body : "{}";
    const body = JSON.parse(requestBody) as {
      messages?: Array<{ role?: string }>;
      model?: string;
    };
    const model = body.model ?? "gpt-4o-mini";
    if (fixture === "tool_output_budget") {
      return new Response(
        toEventStream(buildToolOutputBudgetFixtureChunks(body.messages ?? [], model)),
        {
          headers: {
            "content-type": "text/event-stream",
          },
        },
      );
    }

    const hasToolResult = hasToolResultAfterLatestUser(body.messages ?? []);
    const toolCall = fixture === "no_lifecycle" ? null : buildFixtureToolCall(fixture);
    const chunks = hasToolResult
      ? buildTextChunks({
          content: "The host accepted my lifecycle tool call and linked the transcript to the run.",
          finishReason: "stop",
          model,
        })
      : toolCall === null
        ? buildTextChunks({
            content: "I inspected the trigger but did not call a lifecycle tool.",
            finishReason: "stop",
            model,
          })
        : buildToolCallChunks({
            content: "I accepted the trigger and can finish through the host lifecycle tool.",
            finishReason: "tool_calls",
            model,
            toolCall,
          });

    return new Response(toEventStream(chunks), {
      headers: {
        "content-type": "text/event-stream",
      },
    });
  };
}

function buildToolOutputBudgetFixtureChunks(
  messages: readonly { role?: string }[],
  model: string,
): OpenAIChatChunk[] {
  if (JSON.stringify(messages).includes("call_budget_no_change")) {
    return buildTextChunks({
      content: "The host accepted my no_change lifecycle tool call after the output-budget probe.",
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
      toolCall: {
        id: "call_budget_no_change",
        name: "no_change",
        arguments: JSON.stringify({
          summary:
            "Verified large tool output was capped inline and preserved as a current-run KV artifact.",
        }),
      },
    });
  }

  return buildTextChunks({
    content: "The host accepted my no_change lifecycle tool call after the output-budget probe.",
    finishReason: "stop",
    model,
  });
}

function findLatestToolOutputArtifactId(messages: readonly unknown[]): string | null {
  const serialized = JSON.stringify(messages);
  return serialized.match(/toolout_[a-f0-9]{32}/)?.[0] ?? null;
}

function hasToolResultAfterLatestUser(messages: readonly { role?: string }[]): boolean {
  return countToolResultsAfterLatestUser(messages) > 0;
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

function buildFixtureToolCall(fixture: Exclude<NaniteLlmFixture, "no_lifecycle">): {
  name: string;
  arguments: string;
} {
  if (fixture === "no_change") {
    return {
      name: "no_change",
      arguments: JSON.stringify({
        summary: "Docs sync inspected the trigger and found no documentation changes needed.",
      }),
    };
  }

  if (fixture === "ask_human") {
    return {
      name: "ask_human",
      arguments: JSON.stringify({
        summary: "Need contents:write before opening the documentation PR.",
        requestedScopes: ["contents:write"],
      }),
    };
  }

  return {
    name: "complete",
    arguments: JSON.stringify({
      summary: "Docs sync completed through the mocked provider layer.",
      outputUrl: "https://example.com/runs/docs-syncer",
      agentFeedback: {
        severity: "info",
        message: "The trigger reached the Nanite model with usable runtime context.",
        suggestions: ["Keep repository, pull number, and head SHA in trigger input."],
      },
    }),
  };
}

type OpenAIChatChunk = {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Record<string, unknown>;
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
  delta: Record<string, unknown>,
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
