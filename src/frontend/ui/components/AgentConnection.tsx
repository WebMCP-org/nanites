import "./agent-connection.css";
import { useMemo, useState } from "react";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContainer,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "#/frontend/ui/components/CodeBlock.tsx";
import { Button } from "#/frontend/ui/components/Button.tsx";
import { cx } from "#/frontend/ui/components/_internal/class-names.js";
import { Popover } from "#/frontend/ui/components/Popover.tsx";
import { buildAgentConnectionCommands } from "#/frontend/lib/agent-connection-commands.ts";
import type { AgentConnectionTarget } from "#/frontend/lib/agent-connection-commands.ts";
import { PlugsConnectedIcon } from "@phosphor-icons/react";

const DEFAULT_LOCAL_ORIGIN = "http://localhost:5173";

function getBrowserOrigin(): string {
  if (typeof window === "undefined") {
    return DEFAULT_LOCAL_ORIGIN;
  }

  return window.location.origin;
}

export function AgentConnectionPanel({
  className,
  defaultTarget = "codex",
  headingLevel = 2,
  origin,
  section = true,
}: {
  readonly className?: string;
  readonly defaultTarget?: AgentConnectionTarget;
  readonly headingLevel?: 2 | 3;
  readonly origin?: string;
  readonly section?: boolean;
}) {
  const [target, setTarget] = useState<AgentConnectionTarget>(defaultTarget);
  const commands = useMemo(
    () => buildAgentConnectionCommands(origin ?? getBrowserOrigin()),
    [origin],
  );
  const selected = commands.find((command) => command.target === target) ?? commands[0];
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const Wrapper = section ? "section" : "div";

  return (
    <Wrapper className={cx("agent-connect", className)}>
      <div className="agent-connect__header">
        <div className="agent-connect__icon" aria-hidden="true">
          <PlugsConnectedIcon size={18} weight="bold" />
        </div>
        <div className="agent-connect__title-group">
          <Heading>Connect Agent</Heading>
          <p>{selected.description}</p>
        </div>
      </div>
      <fieldset className="agent-connect__targets">
        <legend className="agent-connect__legend">Agent connection target</legend>
        {commands.map((command) => (
          <button
            key={command.target}
            type="button"
            aria-pressed={command.target === selected.target}
            data-selected={command.target === selected.target}
            className="agent-connect__target"
            onClick={() => {
              setTarget(command.target);
            }}
          >
            {command.label}
          </button>
        ))}
      </fieldset>
      <CodeBlock code={selected.code} language={selected.language}>
        <CodeBlockHeader>
          <CodeBlockTitle>{selected.label}</CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockContainer>
          <CodeBlockContent />
        </CodeBlockContainer>
      </CodeBlock>
    </Wrapper>
  );
}

export function AgentConnectionPopover() {
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            type="button"
            color="neutral"
            variant="outline"
            size="sm"
            className="agent-connect-trigger"
          >
            <PlugsConnectedIcon size={16} weight="bold" />
            <span>Connect agent</span>
          </Button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={10}>
          <Popover.Popup className="agent-connect-popover">
            <AgentConnectionPanel />
            <Popover.Arrow />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
