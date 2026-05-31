import type { Meta, StoryObj } from "@storybook/react";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContainer,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockLanguageSelector,
} from "../components/CodeBlock";

const meta = {
  title: "Components/CodeBlock",
  component: CodeBlock,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    code: "",
    language: "ts",
  },
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

const TS_SAMPLE = `import { Collapsible } from "@base-ui/react/collapsible";

interface Props {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function MyDisclosure({ open, onOpenChange }: Props) {
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange}>
      <Collapsible.Trigger>Show more</Collapsible.Trigger>
      <Collapsible.Panel>Hidden content goes here.</Collapsible.Panel>
    </Collapsible.Root>
  );
}`;

const CSS_SAMPLE = `.button {
  display: inline-flex;
  align-items: center;
  padding-inline: 1rem;
  border-radius: var(--sigvelo-border-radius-md);
  background-color: var(--sigvelo-primary-fill-mid);
  color: var(--sigvelo-primary-text-on-mid);
}

.button:hover {
  background-color: var(--sigvelo-primary-fill-loud);
}`;

export const Default: Story = {
  args: {
    code: TS_SAMPLE,
    language: "ts",
    showLineNumbers: true,
  },
  render: (args) => (
    <div style={{ width: "40rem" }}>
      <CodeBlock {...args}>
        <CodeBlockHeader>
          <CodeBlockFilename>MyDisclosure.tsx</CodeBlockFilename>
          <CodeBlockActions>
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockContainer>
          <CodeBlockContent />
        </CodeBlockContainer>
      </CodeBlock>
    </div>
  ),
};

export const WithLanguageSelector: Story = {
  args: {
    code: TS_SAMPLE,
    language: "ts",
  },
  render: (args) => (
    <div style={{ width: "40rem" }}>
      <CodeBlock {...args}>
        <CodeBlockHeader>
          <CodeBlockFilename>example.ts</CodeBlockFilename>
          <CodeBlockActions>
            <CodeBlockLanguageSelector />
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockContainer>
          <CodeBlockContent />
        </CodeBlockContainer>
      </CodeBlock>
    </div>
  ),
};

export const CSS: Story = {
  args: {
    code: CSS_SAMPLE,
    language: "css",
    showLineNumbers: true,
  },
  render: (args) => (
    <div style={{ width: "40rem" }}>
      <CodeBlock {...args}>
        <CodeBlockHeader>
          <CodeBlockFilename>button.css</CodeBlockFilename>
          <CodeBlockActions>
            <CodeBlockCopyButton />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockContainer>
          <CodeBlockContent />
        </CodeBlockContainer>
      </CodeBlock>
    </div>
  ),
};
