import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import { useAgent } from "agents/react";
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
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
import {
  Tooltip,
  TooltipPopup,
  TooltipPortal,
  TooltipPositioner,
  TooltipTrigger,
} from "#/frontend/ui/components/Tooltip.tsx";
import { formatStructuredCodeDisplay } from "#/frontend/ui/code-display/structured-code.ts";
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
  ManagerBrowserSessionInput,
  SigveloManagerConversationAgent,
} from "#/backend/agents/SigveloManagerConversationAgent.ts";
import type { NaniteAgentState, SigveloNaniteAgent } from "#/backend/agents/SigveloNaniteAgent.ts";
import { MANAGER_CONVERSATION_AGENT_NAME } from "#/nanites.ts";

type PartialUIMessage = Partial<UIMessage> & {
  readonly id?: unknown;
  readonly role?: unknown;
  readonly parts?: unknown;
};

type RuntimeConversationProps = {
  readonly agentMessages: readonly UIMessage[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

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

  return value
    .filter(
      (message): message is PartialUIMessage => typeof message === "object" && message !== null,
    )
    .map((message, index) => ({
      ...message,
      id: typeof message.id === "string" ? message.id : `runtime-message-${index}`,
      role:
        message.role === "system" || message.role === "user" || message.role === "assistant"
          ? message.role
          : "assistant",
      parts: Array.isArray(message.parts) ? message.parts : [],
    })) as UIMessage[];
}

function getMessageText(message: UIMessage): string {
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
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

type NaniteLifecycleToolName = "complete" | "no_change" | "fail" | "ask_human";
type NaniteLifecycleToolTone = "success" | "neutral" | "danger" | "warning" | "active";

export type NaniteLifecycleOutcome = {
  readonly title: string;
  readonly statusLabel: string;
  readonly tone: NaniteLifecycleToolTone;
  readonly summary: string | null;
  readonly outputUrl: string | null;
  readonly requestedScopes: readonly string[];
};

const naniteLifecycleToolNames = new Set<string>(["complete", "no_change", "fail", "ask_human"]);

function isNaniteLifecycleToolName(toolName: string): toolName is NaniteLifecycleToolName {
  return naniteLifecycleToolNames.has(toolName);
}

function getStringField(value: unknown, field: string): string | null {
  if (!isRecord(value)) return null;
  const candidate = value[field];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

function getStringArrayField(value: unknown, field: string): readonly string[] {
  if (!isRecord(value) || !Array.isArray(value[field])) return [];
  return value[field].filter((entry): entry is string => typeof entry === "string");
}

function getLifecycleBaseOutcome(toolName: NaniteLifecycleToolName): {
  readonly title: string;
  readonly statusLabel: string;
  readonly tone: Exclude<NaniteLifecycleToolTone, "active">;
} {
  switch (toolName) {
    case "complete":
      return {
        title: "Work complete",
        statusLabel: "Complete",
        tone: "success",
      };
    case "no_change":
      return {
        title: "No change needed",
        statusLabel: "No change",
        tone: "neutral",
      };
    case "fail":
      return {
        title: "Run failed",
        statusLabel: "Failed",
        tone: "danger",
      };
    case "ask_human":
      return {
        title: "Human decision needed",
        statusLabel: "Needs human",
        tone: "warning",
      };
  }
}

function getNaniteLifecycleOutcome(
  toolName: NaniteLifecycleToolName,
  part: {
    readonly input?: unknown;
    readonly output?: unknown;
    readonly state: string;
  },
): NaniteLifecycleOutcome {
  const base = getLifecycleBaseOutcome(toolName);
  const output = isRecord(part.output) ? part.output : null;
  const outputScopes = getStringArrayField(output, "requestedScopes");
  const inputScopes = getStringArrayField(part.input, "requestedScopes");
  const active = part.state === "input-streaming" || part.state === "input-available";

  return {
    ...base,
    tone: active ? "active" : base.tone,
    statusLabel: active ? "Reporting" : base.statusLabel,
    summary:
      getStringField(output, "summary") ??
      getStringField(part.input, "summary") ??
      (part.state === "output-available" ? "The Nanite reported this outcome." : null),
    outputUrl: getStringField(output, "outputUrl") ?? getStringField(part.input, "outputUrl"),
    requestedScopes: outputScopes.length > 0 ? outputScopes : inputScopes,
  };
}

function NaniteLifecycleIcon({ tone }: { readonly tone: NaniteLifecycleToolTone }) {
  if (tone === "success") return <CheckCircleIcon size={18} weight="fill" aria-hidden="true" />;
  if (tone === "danger") return <XCircleIcon size={18} weight="fill" aria-hidden="true" />;
  if (tone === "warning") return <HandPalmIcon size={18} weight="fill" aria-hidden="true" />;
  if (tone === "active") return <CircleNotchIcon size={18} aria-hidden="true" />;
  return <WarningCircleIcon size={18} weight="fill" aria-hidden="true" />;
}

export function NaniteLifecycleToolCard({ outcome }: { readonly outcome: NaniteLifecycleOutcome }) {
  return (
    <section
      className="nanite-lifecycle-tool"
      data-tone={outcome.tone}
      data-testid="nanite-lifecycle-tool"
      aria-label={outcome.title}
    >
      <div className="nanite-lifecycle-tool__icon">
        <NaniteLifecycleIcon tone={outcome.tone} />
      </div>
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
        {outcome.requestedScopes.length > 0 ? (
          <div className="nanite-lifecycle-tool__scopes" aria-label="Requested scopes">
            {outcome.requestedScopes.map((scope) => (
              <span key={scope}>{scope}</span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function getConversationResetKey(messages: readonly UIMessage[], isStreaming: boolean): string {
  const lastMessage = messages[messages.length - 1];
  const lastPart = lastMessage?.parts[lastMessage.parts.length - 1];
  const lastPartTextLength =
    lastPart && "text" in lastPart && typeof lastPart.text === "string" ? lastPart.text.length : 0;
  const lastPartState =
    lastPart && "state" in lastPart && typeof lastPart.state === "string" ? lastPart.state : "";

  return [
    messages.length,
    lastMessage?.id ?? "",
    lastMessage?.parts.length ?? 0,
    lastPartTextLength,
    lastPartState,
    isStreaming ? "streaming" : "idle",
  ].join(":");
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const promptStatus = error ? "error" : isStreaming ? "streaming" : "ready";
  const normalizedMessages = useMemo(() => normalizeMessages(agentMessages), [agentMessages]);
  const conversationResetKey = useMemo(
    () => getConversationResetKey(normalizedMessages, isStreaming),
    [isStreaming, normalizedMessages],
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
                        <ProseMarkdown>{getMessageText(message)}</ProseMarkdown>
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

                        const toolActive = isLastAssistant && isStreaming && isLastPart;
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
                                <ToolOutput
                                  output={
                                    <CodeBlock
                                      code={formattedOutput.code}
                                      language={formattedOutput.language}
                                    >
                                      <CodeBlockContainer>
                                        <CodeBlockContent />
                                      </CodeBlockContainer>
                                    </CodeBlock>
                                  }
                                />
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

                    {!isStreaming && isLastAssistant && onRegenerate ? (
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
            if (!onSubmit || isStreaming) return;
            onSubmit(text);
          }}
        >
          <div className="app__composer-row">
            <PromptInputTools
              className="app__composer-tools"
              data-empty={onClearConversation ? undefined : "true"}
            >
              {onClearConversation ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        className="nanites-workspace__chat-tool-button"
                        aria-label="Reset chat"
                        disabled={isStreaming}
                        onClick={onClearConversation}
                      >
                        <TrashIcon size={14} aria-hidden="true" />
                      </button>
                    }
                  />
                  <TooltipPortal>
                    <TooltipPositioner side="top" sideOffset={6}>
                      <TooltipPopup>Reset chat</TooltipPopup>
                    </TooltipPositioner>
                  </TooltipPortal>
                </Tooltip>
              ) : null}
            </PromptInputTools>
            <PromptInputBody>
              <PromptInputTextarea
                ref={textareaRef}
                className="app__composer-textarea"
                placeholder={placeholder}
                disabled={!onSubmit}
                minHeight={22}
                maxHeight={96}
              />
            </PromptInputBody>
            <PromptInputSubmit
              status={promptStatus}
              onStop={onStop}
              disabled={!onSubmit && !isStreaming}
            />
          </div>
        </PromptInput>
      </div>
    </div>
  );
}

export function NaniteRuntimeChatPlaceholder() {
  return (
    <div className="nanites-workspace__chat-inner">
      <div className="app__messages-list" data-testid="messages-list">
        <Conversation className="app__conversation">
          <ConversationContent>
            <ConversationEmptyState>
              <div className="app__empty">
                <div className="app__empty-copy">
                  <div className="app__empty-title">Waiting for the runtime</div>
                  <div className="app__empty-description">
                    The Nanite agent transcript appears here.
                  </div>
                </div>
              </div>
            </ConversationEmptyState>
          </ConversationContent>
        </Conversation>
      </div>
      <div className="app__composer">
        <PromptInput onSubmit={() => {}}>
          <div className="app__composer-row">
            <PromptInputTools className="app__composer-tools" data-empty="true" />
            <PromptInputBody>
              <PromptInputTextarea
                className="app__composer-textarea"
                placeholder="Ask for follow-up changes"
                disabled
                minHeight={22}
                maxHeight={96}
              />
            </PromptInputBody>
            <PromptInputSubmit status="ready" disabled />
          </div>
        </PromptInput>
      </div>
    </div>
  );
}

// Suspense fallback shown while a sub-agent connection resolves. It mirrors the
// chat shell (empty transcript + disabled composer) at reduced opacity so the
// real conversation can fade up into place without a layout swap or flicker.
export function NaniteRuntimeChatLoading({
  description = "The conversation is getting ready. You can stay here while the runtime connects.",
  placeholder = "Connecting to the Nanite runtime...",
  title = "Preparing the runtime",
}: {
  readonly description?: string;
  readonly placeholder?: string;
  readonly title?: string;
}) {
  return (
    <div
      className="nanites-workspace__chat-inner nanites-workspace__chat-inner--loading"
      aria-busy="true"
    >
      <div className="app__messages-list" data-testid="messages-loading">
        <Conversation className="app__conversation">
          <ConversationContent>
            <ConversationEmptyState>
              <div className="app__empty app__empty--loading">
                <div className="app__empty-status" aria-hidden="true">
                  <CircleNotchIcon size={14} />
                  <span>Preparing</span>
                </div>
                <div className="app__empty-copy">
                  <div className="app__empty-title">{title}</div>
                  <div className="app__empty-description">{description}</div>
                </div>
              </div>
            </ConversationEmptyState>
          </ConversationContent>
        </Conversation>
      </div>
      <div className="app__composer">
        <PromptInput onSubmit={() => {}}>
          <div className="app__composer-row">
            <PromptInputTools className="app__composer-tools" data-empty="true" />
            <PromptInputBody>
              <PromptInputTextarea
                className="app__composer-textarea"
                placeholder={placeholder}
                disabled
                minHeight={22}
                maxHeight={96}
              />
            </PromptInputBody>
            <PromptInputSubmit status="ready" disabled />
          </div>
        </PromptInput>
      </div>
    </div>
  );
}

export type NaniteAgentInstance = ReturnType<typeof useAgent<SigveloNaniteAgent, NaniteAgentState>>;

export function NaniteRuntimeChatConnector({
  agent,
}: {
  readonly agent: NaniteAgentInstance | null;
}) {
  if (!agent) return <NaniteRuntimeChatPlaceholder />;
  return <NaniteRuntimeChatSession agent={agent} />;
}

export function ManagerRuntimeChatConnector({
  accountLogin,
  actor,
  emptyDescription = "Ask the installation manager to inspect, create, update, pause, or run Nanites.",
  emptyTitle = "Manager ready",
  errorDescription = "The installation manager conversation could not connect.",
  githubAppId,
  githubInstallationId,
  loadingDescription = "The conversation is getting ready. You’ll be able to continue here in a moment.",
  loadingPlaceholder = "Connecting to the manager...",
  loadingTitle = "Preparing the runtime",
  managerName,
  placeholder = "Ask the manager to work on Nanites",
}: ManagerBrowserSessionInput & {
  readonly emptyDescription?: string;
  readonly emptyTitle?: string;
  readonly errorDescription?: string;
  readonly loadingDescription?: string;
  readonly loadingPlaceholder?: string;
  readonly loadingTitle?: string;
  readonly placeholder?: string;
}) {
  const conversationAgent = useAgent<SigveloManagerConversationAgent>({
    agent: MANAGER_CONVERSATION_AGENT_NAME,
    name: `${managerName}:manager:${actor.id}`,
  });
  const connectionKey = useMemo(
    () =>
      [managerName, githubAppId, githubInstallationId, accountLogin, actor.id, actor.login].join(
        ":",
      ),
    [accountLogin, actor.id, actor.login, githubAppId, githubInstallationId, managerName],
  );
  const [connectionState, setConnectionState] = useState<
    | {
        readonly key: string;
        readonly status: "connected";
      }
    | {
        readonly error: unknown;
        readonly key: string;
        readonly status: "error";
      }
  >();
  const activeConnectionState =
    connectionState?.key === connectionKey ? connectionState : undefined;

  useEffect(() => {
    let canceled = false;
    void conversationAgent.stub
      .connectBrowserInstallation({
        managerName,
        githubAppId,
        githubInstallationId,
        accountLogin,
        actor,
      })
      .then(() => {
        if (!canceled) {
          setConnectionState({ key: connectionKey, status: "connected" });
        }
      })
      .catch((error: unknown) => {
        if (!canceled) {
          setConnectionState({ error, key: connectionKey, status: "error" });
        }
      });

    return () => {
      canceled = true;
    };
  }, [
    accountLogin,
    actor,
    connectionKey,
    conversationAgent.stub,
    githubAppId,
    githubInstallationId,
    managerName,
  ]);

  if (activeConnectionState?.status === "error") {
    return (
      <RuntimeConversation
        agentMessages={[]}
        isStreaming={false}
        error={activeConnectionState.error}
        emptyDescription={errorDescription}
      />
    );
  }

  if (activeConnectionState?.status !== "connected") {
    return (
      <NaniteRuntimeChatLoading
        description={loadingDescription}
        placeholder={loadingPlaceholder}
        title={loadingTitle}
      />
    );
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
  readonly agent: ReturnType<typeof useAgent<SigveloManagerConversationAgent>>;
  readonly emptyDescription: string;
  readonly emptyTitle: string;
  readonly placeholder: string;
}) {
  const {
    messages: runMessages,
    isStreaming,
    sendMessage,
    regenerate,
    stop,
    error,
    clearError,
  } = useAgentChat({
    agent,
    experimental_throttle: 50,
  });

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;
      clearError();
      void sendMessage({
        role: "user",
        parts: [{ type: "text", text: trimmed }],
      });
    },
    [clearError, isStreaming, sendMessage],
  );

  const handleRegenerate = useCallback(() => {
    if (isStreaming) return;
    clearError();
    void regenerate();
  }, [clearError, isStreaming, regenerate]);

  const handleClearConversation = useCallback(() => {
    if (isStreaming) return;
    clearError();
    void agent.stub.clearConversation();
  }, [agent.stub, clearError, isStreaming]);

  return (
    <RuntimeConversation
      agentMessages={runMessages}
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
    sendMessage,
    regenerate,
    stop,
    error,
    clearError,
  } = useAgentChat({
    agent,
    experimental_throttle: 50,
  });

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;
      clearError();
      void sendMessage({
        role: "user",
        parts: [{ type: "text", text: trimmed }],
      });
    },
    [clearError, isStreaming, sendMessage],
  );

  const handleRegenerate = useCallback(() => {
    if (isStreaming) return;
    clearError();
    void regenerate();
  }, [clearError, isStreaming, regenerate]);

  return (
    <RuntimeConversation
      agentMessages={runMessages}
      isStreaming={isStreaming}
      error={error}
      onSubmit={handleSubmit}
      onStop={() => void stop()}
      onRegenerate={handleRegenerate}
    />
  );
}
