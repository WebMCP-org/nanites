import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorDialog,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "../components/ModelSelector";

const meta = {
  title: "Components/ModelSelector",
  component: ModelSelector,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ModelSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

interface Model {
  id: string;
  name: string;
  provider: string;
  description?: string;
}

const MODELS: Record<string, Model[]> = {
  Anthropic: [
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic" },
  ],
  OpenAI: [
    { id: "gpt-5", name: "GPT-5", provider: "openai" },
    { id: "gpt-5-mini", name: "GPT-5 mini", provider: "openai" },
    { id: "o3", name: "o3", provider: "openai" },
  ],
  Google: [
    { id: "gemini-2-5-pro", name: "Gemini 2.5 Pro", provider: "google" },
    { id: "gemini-2-5-flash", name: "Gemini 2.5 Flash", provider: "google" },
  ],
  Meta: [{ id: "llama-4", name: "Llama 4", provider: "meta" }],
  Kimi: [{ id: "kimi-k2-5", name: "Kimi K2.5", provider: "kimi" }],
};

export const Default: Story = {
  render: function Default() {
    const [selected, setSelected] = useState("claude-opus-4-6");
    const selectedModel = Object.values(MODELS)
      .flat()
      .find((m) => m.id === selected);

    return (
      <ModelSelector>
        <ModelSelectorTrigger>
          {selectedModel ? (
            <>
              <ModelSelectorLogo provider={selectedModel.provider} />
              <ModelSelectorName>{selectedModel.name}</ModelSelectorName>
            </>
          ) : (
            <ModelSelectorName>Select model…</ModelSelectorName>
          )}
        </ModelSelectorTrigger>
        <ModelSelectorContent>
          <ModelSelectorDialog>
            <ModelSelectorInput />
            <ModelSelectorList>
              {Object.entries(MODELS).map(([provider, items]) => (
                <ModelSelectorGroup key={provider} label={provider}>
                  {items.map((model) => (
                    <ModelSelectorItem
                      key={model.id}
                      value={model.name}
                      keywords={`${model.provider} ${model.id}`}
                      selected={selected === model.id}
                      onSelect={() => setSelected(model.id)}
                    >
                      <ModelSelectorLogo provider={model.provider} />
                      <ModelSelectorName>{model.name}</ModelSelectorName>
                    </ModelSelectorItem>
                  ))}
                </ModelSelectorGroup>
              ))}
              <ModelSelectorEmpty />
            </ModelSelectorList>
          </ModelSelectorDialog>
        </ModelSelectorContent>
      </ModelSelector>
    );
  },
};
