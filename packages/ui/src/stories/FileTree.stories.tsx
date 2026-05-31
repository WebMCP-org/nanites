import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { FileTree, FileTreeFile, FileTreeFolder } from "../components/FileTree";

const meta = {
  title: "Components/FileTree",
  component: FileTree,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof FileTree>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div style={{ width: "20rem", height: "24rem" }}>
      <FileTree defaultExpanded={new Set(["src", "src/components"])}>
        <FileTreeFolder path="src" name="src">
          <FileTreeFolder path="src/components" name="components">
            <FileTreeFile path="src/components/Button.tsx" name="Button.tsx" />
            <FileTreeFile path="src/components/Input.tsx" name="Input.tsx" />
            <FileTreeFile path="src/components/Dialog.tsx" name="Dialog.tsx" />
          </FileTreeFolder>
          <FileTreeFolder path="src/styles" name="styles">
            <FileTreeFile path="src/styles/button.css" name="button.css" />
            <FileTreeFile path="src/styles/input.css" name="input.css" />
          </FileTreeFolder>
          <FileTreeFile path="src/index.ts" name="index.ts" />
        </FileTreeFolder>
        <FileTreeFile path="README.md" name="README.md" />
        <FileTreeFile path="package.json" name="package.json" />
      </FileTree>
    </div>
  ),
};

export const Controlled: Story = {
  render: function Controlled() {
    const [expanded, setExpanded] = useState<Set<string>>(new Set(["src"]));
    const [selected, setSelected] = useState<string | null>(null);

    return (
      <div style={{ display: "flex", gap: "1rem", width: "32rem" }}>
        <div style={{ width: "16rem", height: "20rem" }}>
          <FileTree
            expanded={expanded}
            onExpandedChange={setExpanded}
            selectedPath={selected}
            onSelect={setSelected}
          >
            <FileTreeFolder path="src" name="src">
              <FileTreeFile path="src/a.ts" name="a.ts" />
              <FileTreeFile path="src/b.ts" name="b.ts" />
              <FileTreeFolder path="src/nested" name="nested">
                <FileTreeFile path="src/nested/x.ts" name="x.ts" />
                <FileTreeFile path="src/nested/y.ts" name="y.ts" />
              </FileTreeFolder>
            </FileTreeFolder>
          </FileTree>
        </div>
        <div
          style={{
            flex: 1,
            padding: "0.5rem",
            fontFamily: "var(--sigvelo-font-family-code)",
            fontSize: "0.75rem",
            color: "var(--sigvelo-text-muted)",
          }}
        >
          <div>Expanded: {Array.from(expanded).join(", ") || "none"}</div>
          <div>Selected: {selected ?? "none"}</div>
        </div>
      </div>
    );
  },
};
