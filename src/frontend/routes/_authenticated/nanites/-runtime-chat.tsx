import { MANAGER_CONVERSATION_AGENT_NAME } from "#/shared/constants.ts";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { isRecord } from "#/shared/utils/values.ts";
import { getToolName, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import { useAgent } from "agents/react";
import { Component, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { Streamdown } from "streamdown";
import {
  CodeBlock,
  CodeBlockContainer,
  CodeBlockContent,
} from "#/frontend/ui/components/CodeBlock.tsx";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "#/frontend/ui/components/Conversation.tsx";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "#/frontend/ui/components/Message.tsx";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "#/frontend/ui/components/PromptInput.tsx";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "#/frontend/ui/components/Reasoning.tsx";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "#/frontend/ui/components/Tool.tsx";
import { formatStructuredCodeDisplay } from "#/frontend/ui/code-display/structured-code.ts";
import { RoutePendingPage } from "#/frontend/lib/route-state.tsx";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  HandPalmIcon,
  TrashIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type {
  ManagerConversationState,
  SigveloManagerConversationAgent,
} from "#/backend/agents/SigveloManagerConversationAgent.ts";
import type { NaniteAgentState, SigveloNaniteAgent } from "#/backend/agents/SigveloNaniteAgent.ts";

type RuntimeConversationProps = {
  readonly agentMessages: readonly UIMessage[];
  readonly isRecovering?: boolean;
  readonly isStreaming: boolean;
  readonly error?: unknown;
  readonly emptyDescription?: string;
  readonly emptyTitle?: string;
  readonly onSubmit?: (text: string) => void;
  readonly onStop?: () => void;
  readonly onRegenerate?: () => void;
  readonly onClearConversation?: () => void;
  readonly placeholder?: string;
};

const DATA_URL_BASE64_RE = /^\s*data:([^;,]+(?:;[^;,=]+=[^;,]+)*)?;base64,/i;
const BARE_BASE64_RE = /^[A-Za-z0-9+/=]+$/;
const MIN_BASE64_LENGTH = 128;
const STREAMDOWN_LINK_SAFETY = {
  enabled: false,
};

function isSuspiciousBase64String(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= MIN_BASE64_LENGTH && BARE_BASE64_RE.test(trimmed);
}

function summarizeBinaryString(value: string): string {
  const trimmed = value.trim();
  if (DATA_URL_BASE64_RE.test(trimmed)) {
    const mediaTypeMatch = trimmed.match(/^data:([^;,]+)/i);
    const mediaType = mediaTypeMatch?.[1] ?? "application/octet-stream";
    return `[binary data omitted: ${mediaType} data URL, ${trimmed.length} chars]`;
  }

  return `[binary data omitted: base64 payload, ${trimmed.length} chars]`;
}

function redactBinaryPayloads(value: unknown): unknown {
  if (typeof value === "string") {
    return DATA_URL_BASE64_RE.test(value.trim()) || isSuspiciousBase64String(value)
      ? summarizeBinaryString(value)
      : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactBinaryPayloads(entry));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactBinaryPayloads(entry)]),
    );
  }

  return value;
}

function normalizeMessages(value: unknown): UIMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((message, index) => {
    if (!isRecord(message)) {
      return [];
    }

    return [
      {
        id: typeof message.id === "string" ? message.id : `runtime-message-${index}`,
        role:
          message.role === "system" || message.role === "user" || message.role === "assistant"
            ? message.role
            : "assistant",
        parts: Array.isArray(message.parts) ? message.parts : [],
      } satisfies UIMessage,
    ];
  });
}

function shouldShowStreamedTextPart(part: { text: string; state?: "streaming" | "done" }): boolean {
  return part.text.length > 0 || part.state === "streaming";
}

function getToolInputForDisplay(part: {
  readonly input?: unknown;
  readonly rawInput?: unknown;
  readonly state: string;
}): unknown {
  if (part.state === "output-error" && part.input === undefined && "rawInput" in part) {
    return part.rawInput;
  }

  return part.input;
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "The Nanite chat hit an error.";
}

type NaniteLifecycleToolName = "complete" | "no_change" | "fail" | "ask_manager";
type NaniteLifecycleToolTone = "success" | "neutral" | "danger" | "warning" | "active";

type NaniteLifecycleOutcome = {
  readonly title: string;
  readonly statusLabel: string;
  readonly tone: NaniteLifecycleToolTone;
  readonly summary: string | null;
  readonly outputUrl: string | null;
};

const naniteLifecycleToolNames = new Set<string>(["complete", "no_change", "fail", "ask_manager"]);

function isNaniteLifecycleToolName(toolName: string): toolName is NaniteLifecycleToolName {
  return naniteLifecycleToolNames.has(toolName);
}

function getStringField(value: unknown, field: string): string | null {
  if (!isRecord(value)) return null;
  const candidate = value[field];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

function getNaniteLifecycleOutcome(
  toolName: NaniteLifecycleToolName,
  part: {
    readonly input?: unknown;
    readonly output?: unknown;
    readonly state: string;
  },
): NaniteLifecycleOutcome {
  const base = {
    complete: {
      title: "Work complete",
      statusLabel: "Complete",
      tone: "success",
    },
    no_change: {
      title: "No change needed",
      statusLabel: "No change",
      tone: "neutral",
    },
    fail: {
      title: "Run failed",
      statusLabel: "Failed",
      tone: "danger",
    },
    ask_manager: {
      title: "Manager input needed",
      statusLabel: "Needs manager",
      tone: "warning",
    },
  } as const satisfies Record<
    NaniteLifecycleToolName,
    {
      readonly title: string;
      readonly statusLabel: string;
      readonly tone: Exclude<NaniteLifecycleToolTone, "active">;
    }
  >;
  const outcome = base[toolName];
  const isActive = part.state === "input-streaming" || part.state === "input-available";

  return {
    ...outcome,
    tone: isActive ? "active" : outcome.tone,
    statusLabel: isActive ? "Reporting" : outcome.statusLabel,
    summary: getLifecycleSummary(part),
    outputUrl: getStringField(part.output, "outputUrl") ?? getStringField(part.input, "outputUrl"),
  };
}

function getLifecycleSummary(part: {
  readonly input?: unknown;
  readonly output?: unknown;
  readonly state: string;
}): string | null {
  const summary = getStringField(part.output, "summary") ?? getStringField(part.input, "summary");
  if (summary) {
    return summary;
  }

  const request = getStringField(part.output, "request") ?? getStringField(part.input, "request");
  if (request) {
    return request;
  }

  return part.state === "output-available" ? "The Nanite reported this outcome." : null;
}

function NaniteLifecycleToolCard({ outcome }: { readonly outcome: NaniteLifecycleOutcome }) {
  const icon =
    outcome.tone === "success" ? (
      <CheckCircleIcon size={18} weight="fill" aria-hidden="true" />
    ) : outcome.tone === "danger" ? (
      <XCircleIcon size={18} weight="fill" aria-hidden="true" />
    ) : outcome.tone === "warning" ? (
      <HandPalmIcon size={18} weight="fill" aria-hidden="true" />
    ) : outcome.tone === "active" ? (
      <CircleNotchIcon size={18} aria-hidden="true" />
    ) : (
      <WarningCircleIcon size={18} weight="fill" aria-hidden="true" />
    );

  return (
    <section
      className="nanite-lifecycle-tool"
      data-tone={outcome.tone}
      data-testid="nanite-lifecycle-tool"
      aria-label={outcome.title}
    >
      <div className="nanite-lifecycle-tool__icon">{icon}</div>
      <div className="nanite-lifecycle-tool__body">
        <div className="nanite-lifecycle-tool__header">
          <strong>{outcome.title}</strong>
          <span>{outcome.statusLabel}</span>
        </div>
        <p className="nanite-lifecycle-tool__summary">
          {outcome.summary ?? "The Nanite is reporting its outcome."}
        </p>
        {outcome.outputUrl ? (
          <a
            className="nanite-lifecycle-tool__link"
            href={outcome.outputUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open change proposal
          </a>
        ) : null}
      </div>
    </section>
  );
}

function getConversationResetKey(messages: readonly UIMessage[], isStreaming: boolean): string {
  const lastMessage = messages[messages.length - 1];
  const lastPart = lastMessage ? lastMessage.parts[lastMessage.parts.length - 1] : undefined;

  return [
    messages.length,
    lastMessage?.id ?? "",
    lastMessage?.parts.length ?? 0,
    readPartTextLength(lastPart),
    readPartState(lastPart),
    isStreaming ? "streaming" : "idle",
  ].join(":");
}

function readPartTextLength(part: unknown): number {
  if (!isRecord(part)) {
    return 0;
  }
  return typeof part.text === "string" ? part.text.length : 0;
}

function readPartState(part: unknown): string {
  if (!isRecord(part)) {
    return "";
  }
  return typeof part.state === "string" ? part.state : "";
}

class ChatRenderBoundary extends Component<
  { readonly children: ReactNode; readonly resetKey: string },
  { readonly hasError: boolean; readonly resetKey: string }
> {
  state = {
    hasError: false,
    resetKey: this.props.resetKey,
  };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  static getDerivedStateFromProps(
    props: { readonly resetKey: string },
    state: { readonly hasError: boolean; readonly resetKey: string },
  ) {
    if (props.resetKey === state.resetKey) {
      return null;
    }

    return {
      hasError: false,
      resetKey: props.resetKey,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Nanite conversation render failed.", {
      errorName: error.name,
      errorMessage: error.message,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app__error app__error--conversation" role="alert">
          Conversation rendering failed. New updates will retry automatically.
        </div>
      );
    }

    return this.props.children;
  }
}

function ProseMarkdown({ children, streaming = false }: { children: string; streaming?: boolean }) {
  if (!children || children.trim().length === 0) return null;
  return (
    <div className="app__prose">
      <Streamdown
        parseIncompleteMarkdown={streaming}
        mode={streaming ? "streaming" : "static"}
        controls={false}
        animated={false}
        linkSafety={STREAMDOWN_LINK_SAFETY}
      >
        {children}
      </Streamdown>
    </div>
  );
}

function RuntimeConversation({
  agentMessages,
  isRecovering = false,
  isStreaming,
  error,
  emptyDescription = "The Nanite agent transcript appears here.",
  emptyTitle = "Waiting for the runtime",
  onSubmit,
  onStop,
  onRegenerate,
  onClearConversation,
  placeholder = "Ask for follow-up changes",
}: RuntimeConversationProps) {
  const [openToolIds, setOpenToolIds] = useState<Set<string>>(new Set());
  const isBusy = isStreaming || isRecovering;
  const promptStatus = error ? "error" : isBusy ? "streaming" : "ready";
  const normalizedMessages = useMemo(() => normalizeMessages(agentMessages), [agentMessages]);
  const conversationResetKey = useMemo(
    () => getConversationResetKey(normalizedMessages, isBusy),
    [isBusy, normalizedMessages],
  );

  return (
    <div className="nanites-workspace__chat-inner nanites-workspace__chat-inner--enter">
      <div className="app__messages-list" data-testid="messages-list">
        <ChatRenderBoundary resetKey={conversationResetKey}>
          <Conversation className="app__conversation">
            <ConversationContent>
              {normalizedMessages.length === 0 ? (
                <ConversationEmptyState>
                  <div className="app__empty">
                    <div className="app__empty-copy">
                      <div className="app__empty-title">{emptyTitle}</div>
                      <div className="app__empty-description">{emptyDescription}</div>
                    </div>
                  </div>
                </ConversationEmptyState>
              ) : null}

              {normalizedMessages.map((message, index) => {
                if (message.role === "user") {
                  return (
                    <Message key={message.id} from="user">
                      <MessageContent>
                        <ProseMarkdown>
                          {message.parts
                            .flatMap((part) => (part.type === "text" ? [part.text] : []))
                            .join("")}
                        </ProseMarkdown>
                      </MessageContent>
                    </Message>
                  );
                }

                const isLastAssistant =
                  message.role === "assistant" && index === normalizedMessages.length - 1;
                const lastPartIndex = message.parts.length - 1;

                return (
                  <Message key={message.id} from="assistant">
                    <MessageContent>
                      {message.parts.map((part, partIndex) => {
                        const isLastPart = partIndex === lastPartIndex;

                        if (part.type === "reasoning") {
                          if (!shouldShowStreamedTextPart(part)) return null;
                          const isStreamingReasoning = isLastAssistant && isStreaming && isLastPart;
                          return (
                            <Reasoning key={partIndex} isStreaming={isStreamingReasoning}>
                              <ReasoningTrigger />
                              <ReasoningContent>
                                {part.text || (isStreamingReasoning ? "..." : "")}
                              </ReasoningContent>
                            </Reasoning>
                          );
                        }

                        if (part.type === "text") {
                          if (!shouldShowStreamedTextPart(part)) return null;
                          const isLastTextPart = message.parts
                            .slice(partIndex + 1)
                            .every((candidate) => candidate.type !== "text");
                          const isStreamingText = isLastAssistant && isLastTextPart && isStreaming;

                          return (
                            <ProseMarkdown key={partIndex} streaming={isStreamingText}>
                              {part.text}
                            </ProseMarkdown>
                          );
                        }

                        if (!isToolUIPart(part)) return null;

                        const toolName = getToolName(part);
                        if (isNaniteLifecycleToolName(toolName)) {
                          return (
                            <NaniteLifecycleToolCard
                              key={part.toolCallId}
                              outcome={getNaniteLifecycleOutcome(toolName, part)}
                            />
                          );
                        }

                        const toolActive = isLastAssistant && isBusy && isLastPart;
                        const toolOpen = toolActive || openToolIds.has(part.toolCallId);
                        const handleToolOpenChange = (next: boolean) => {
                          if (toolActive) return;
                          setOpenToolIds((previous) => {
                            const updated = new Set(previous);
                            if (next) {
                              updated.add(part.toolCallId);
                            } else {
                              updated.delete(part.toolCallId);
                            }
                            return updated;
                          });
                        };

                        if (part.state === "output-available") {
                          const formattedOutput = formatStructuredCodeDisplay(
                            redactBinaryPayloads(part.output),
                          );
                          return (
                            <Tool
                              key={part.toolCallId}
                              state="output-available"
                              open={toolOpen}
                              onOpenChange={handleToolOpenChange}
                            >
                              <ToolHeader type="function" toolName={toolName} />
                              <ToolContent>
                                <ToolInput input={part.input} />
                                <ToolOutput>
                                  <CodeBlock
                                    code={formattedOutput.code}
                                    language={formattedOutput.language}
                                  >
                                    <CodeBlockContainer>
                                      <CodeBlockContent />
                                    </CodeBlockContainer>
                                  </CodeBlock>
                                </ToolOutput>
                              </ToolContent>
                            </Tool>
                          );
                        }

                        if (part.state === "output-error") {
                          return (
                            <Tool
                              key={part.toolCallId}
                              state="output-error"
                              open={toolOpen}
                              onOpenChange={handleToolOpenChange}
                            >
                              <ToolHeader type="function" toolName={toolName} />
                              <ToolContent>
                                {getToolInputForDisplay(part) !== undefined ? (
                                  <ToolInput input={getToolInputForDisplay(part)} />
                                ) : null}
                                <ToolOutput errorText={part.errorText} />
                              </ToolContent>
                            </Tool>
                          );
                        }

                        if (part.state === "output-denied") {
                          return (
                            <Tool
                              key={part.toolCallId}
                              state="output-denied"
                              open={toolOpen}
                              onOpenChange={handleToolOpenChange}
                            >
                              <ToolHeader type="function" toolName={toolName} />
                              <ToolContent>
                                <ToolInput input={part.input} />
                              </ToolContent>
                            </Tool>
                          );
                        }

                        if (part.state === "input-available" || part.state === "input-streaming") {
                          return (
                            <Tool
                              key={part.toolCallId}
                              state={part.state}
                              open={toolOpen}
                              onOpenChange={handleToolOpenChange}
                            >
                              <ToolHeader type="function" toolName={toolName} />
                              <ToolContent>
                                <ToolInput input={part.input} />
                              </ToolContent>
                            </Tool>
                          );
                        }

                        return null;
                      })}
                    </MessageContent>

                    {!isBusy && isLastAssistant && onRegenerate ? (
                      <MessageActions>
                        <MessageAction
                          label="Regenerate response"
                          tooltip="Regenerate"
                          onClick={onRegenerate}
                        >
                          <ArrowsClockwiseIcon size={14} />
                        </MessageAction>
                      </MessageActions>
                    ) : null}
                  </Message>
                );
              })}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </ChatRenderBoundary>
      </div>

      <div className="app__composer">
        {error ? (
          <div className="app__error" role="alert">
            {getErrorText(error)}
          </div>
        ) : null}
        <PromptInput
          onSubmit={({ text }) => {
            if (!onSubmit || isBusy) return;
            onSubmit(text);
          }}
        >
          <div className="app__composer-row">
            <PromptInputTools
              className="app__composer-tools"
              data-empty={onClearConversation ? undefined : "true"}
            >
              {onClearConversation ? (
                <PromptInputButton
                  className="nanites-workspace__chat-tool-button"
                  tooltip={{ content: "Reset chat", side: "top" }}
                  disabled={isBusy}
                  onClick={onClearConversation}
                >
                  <TrashIcon size={14} aria-hidden="true" />
                </PromptInputButton>
              ) : null}
            </PromptInputTools>
            <span id="nanite-chat-prompt-label" className="visually-hidden">
              Message Nanites
            </span>
            <PromptInputBody>
              <PromptInputTextarea
                className="app__composer-textarea"
                aria-labelledby="nanite-chat-prompt-label"
                placeholder={placeholder}
                disabled={!onSubmit}
                minHeight={22}
                maxHeight={96}
              />
            </PromptInputBody>
            <PromptInputSubmit
              status={promptStatus}
              onStop={onStop}
              disabled={!onSubmit && !isBusy}
            />
          </div>
        </PromptInput>
      </div>
    </div>
  );
}

// Suspense fallback shown while a Nanite agent connection resolves. Delegates to the
// shared centered loading screen so the chat matches the rest of the app.
export function NaniteRuntimeChatLoading({
  description = "The conversation is getting ready. You can stay here while the runtime connects.",
  title = "Preparing the runtime",
}: {
  readonly description?: string;
  readonly title?: string;
}) {
  return <RoutePendingPage title={title} description={description} />;
}

export type NaniteAgentInstance = ReturnType<typeof useAgent<SigveloNaniteAgent, NaniteAgentState>>;

type ManagerRuntimeChatConnectorProps = {
  readonly accountLogin: string;
  readonly actor: {
    readonly id: number;
    readonly login: string;
  };
  readonly managerName: string;
  readonly emptyDescription?: string;
  readonly emptyTitle?: string;
  readonly errorDescription?: string;
  readonly loadingDescription?: string;
  readonly loadingTitle?: string;
  readonly placeholder?: string;
};

function isConnectedManagerConversationState(
  state: ManagerConversationState | undefined,
  input: {
    readonly accountLogin: string;
    readonly actorId: number;
    readonly managerName: string;
  },
): boolean {
  return (
    state?.status === "connected" &&
    state.managerName === input.managerName &&
    state.githubAccountLogin === input.accountLogin &&
    state.sigveloToolAuthProps.githubUserId === input.actorId
  );
}

export function NaniteRuntimeChatConnector({ agent }: { readonly agent: NaniteAgentInstance }) {
  if (!agent.identified) {
    return <NaniteRuntimeChatLoading />;
  }

  return <NaniteRuntimeChatSession agent={agent} />;
}

export function ManagerRuntimeChatConnector({
  accountLogin,
  actor,
  emptyDescription = "Ask the installation manager to inspect, create, update, pause, or run Nanites.",
  emptyTitle = "Manager ready",
  errorDescription = "The installation manager conversation could not connect.",
  loadingDescription = "The conversation is getting ready. You’ll be able to continue here in a moment.",
  loadingTitle = "Preparing the runtime",
  managerName,
  placeholder = "Ask the manager to work on Nanites",
}: ManagerRuntimeChatConnectorProps) {
  const connectionKey = [managerName, accountLogin, actor.id, actor.login].join(":");
  const [connectionError, setConnectionError] = useState<{
    readonly error: unknown;
    readonly key: string;
  } | null>(null);
  const conversationAgent = useAgent<SigveloManagerConversationAgent, ManagerConversationState>({
    agent: MANAGER_CONVERSATION_AGENT_NAME,
    name: `${managerName}:manager:${actor.id}`,
    onOpen: () => {
      setConnectionError(null);
      void conversationAgent.stub.connectBrowserInstallation().catch((error: unknown) => {
        setConnectionError({ error, key: connectionKey });
      });
    },
  });
  const isConnected = isConnectedManagerConversationState(conversationAgent.state, {
    accountLogin,
    actorId: actor.id,
    managerName,
  });
  const activeConnectionError =
    connectionError?.key === connectionKey ? connectionError.error : null;

  if (!isConnected && activeConnectionError) {
    return (
      <RuntimeConversation
        agentMessages={[]}
        isStreaming={false}
        error={activeConnectionError}
        emptyDescription={errorDescription}
      />
    );
  }

  if (!isConnected) {
    return <NaniteRuntimeChatLoading description={loadingDescription} title={loadingTitle} />;
  }

  return (
    <ManagerRuntimeChatSession
      agent={conversationAgent}
      emptyDescription={emptyDescription}
      emptyTitle={emptyTitle}
      placeholder={placeholder}
    />
  );
}

function ManagerRuntimeChatSession({
  agent,
  emptyDescription,
  emptyTitle,
  placeholder,
}: {
  readonly agent: ReturnType<
    typeof useAgent<SigveloManagerConversationAgent, ManagerConversationState>
  >;
  readonly emptyDescription: string;
  readonly emptyTitle: string;
  readonly placeholder: string;
}) {
  const {
    messages: runMessages,
    isStreaming,
    isRecovering,
    sendMessage,
    regenerate,
    stop,
    error,
    clearError,
  } = useAgentChat({
    agent,
    experimental_throttle: 50,
  });
  const isBusy = isStreaming || isRecovering;

  const handleSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    clearError();
    void sendMessage({
      role: "user",
      parts: [{ type: "text", text: trimmed }],
    });
  };

  const handleRegenerate = () => {
    if (isBusy) return;
    clearError();
    void regenerate();
  };

  const handleClearConversation = () => {
    if (isBusy) return;
    clearError();
    void agent.stub.clearConversation();
  };

  return (
    <RuntimeConversation
      agentMessages={runMessages}
      isRecovering={isRecovering}
      isStreaming={isStreaming}
      error={error}
      emptyDescription={emptyDescription}
      emptyTitle={emptyTitle}
      onSubmit={handleSubmit}
      onStop={() => void stop()}
      onRegenerate={handleRegenerate}
      onClearConversation={handleClearConversation}
      placeholder={placeholder}
    />
  );
}

function NaniteRuntimeChatSession({
  agent,
}: {
  readonly agent: ReturnType<typeof useAgent<SigveloNaniteAgent, NaniteAgentState>>;
}) {
  const {
    messages: runMessages,
    isStreaming,
    isRecovering,
    sendMessage,
    regenerate,
    stop,
    error,
    clearError,
  } = useAgentChat({
    agent,
    experimental_throttle: 50,
  });
  const isBusy = isStreaming || isRecovering;

  const handleSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    clearError();
    void sendMessage({
      role: "user",
      parts: [{ type: "text", text: trimmed }],
    });
  };

  const handleRegenerate = () => {
    if (isBusy) return;
    clearError();
    void regenerate();
  };

  return (
    <RuntimeConversation
      agentMessages={runMessages}
      isRecovering={isRecovering}
      isStreaming={isStreaming}
      error={error}
      onSubmit={handleSubmit}
      onStop={() => void stop()}
      onRegenerate={handleRegenerate}
    />
  );
}
