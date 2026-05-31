import { type CodeBlockLanguage, formatStructuredCodeDisplay } from "@nanites/ui";
import { type DynamicToolUIPart, type ToolUIPart, type UITools } from "ai";

export type ToolPayloadSection = {
  readonly label: "Arguments" | "Result" | "Error";
  readonly value: string;
  readonly language: CodeBlockLanguage;
};

function getDynamicToolInputValue(part: DynamicToolUIPart): unknown {
  if (part.state === "output-error" && part.input === undefined && "rawInput" in part) {
    return part.rawInput;
  }

  return part.input;
}

function formatToolPayloadSection(
  label: ToolPayloadSection["label"],
  value: unknown,
  fallback: string,
): ToolPayloadSection {
  if (value === undefined) {
    return {
      label,
      value: fallback,
      language: "md",
    };
  }

  const formatted = formatStructuredCodeDisplay(value);
  return {
    label,
    value: formatted.code,
    language: formatted.language,
  };
}

export function getStaticToolPayloadSections<TOOLS extends UITools>(
  part: ToolUIPart<TOOLS>,
): readonly ToolPayloadSection[] {
  switch (part.state) {
    case "input-streaming":
      return [formatToolPayloadSection("Arguments", part.input, "Waiting for tool arguments...")];
    case "input-available":
    case "approval-requested":
    case "approval-responded":
      return [formatToolPayloadSection("Arguments", part.input, "No tool payload available.")];
    case "output-available":
      return [
        formatToolPayloadSection("Arguments", part.input, "No tool payload available."),
        formatToolPayloadSection("Result", part.output, "No tool payload available."),
      ];
    case "output-error":
      return [
        formatToolPayloadSection("Arguments", part.input, "No tool payload available."),
        formatToolPayloadSection("Error", part.errorText, "No tool payload available."),
      ];
    default:
      return [];
  }
}

export function getDynamicToolPayloadSections(
  part: DynamicToolUIPart,
): readonly ToolPayloadSection[] {
  switch (part.state) {
    case "input-streaming":
      return [
        formatToolPayloadSection(
          "Arguments",
          getDynamicToolInputValue(part),
          "Waiting for tool arguments...",
        ),
      ];
    case "input-available":
    case "approval-requested":
    case "approval-responded":
      return [
        formatToolPayloadSection(
          "Arguments",
          getDynamicToolInputValue(part),
          "No tool payload available.",
        ),
      ];
    case "output-available":
      return [
        formatToolPayloadSection(
          "Arguments",
          getDynamicToolInputValue(part),
          "No tool payload available.",
        ),
        formatToolPayloadSection("Result", part.output, "No tool payload available."),
      ];
    case "output-error":
      return [
        formatToolPayloadSection(
          "Arguments",
          getDynamicToolInputValue(part),
          "No tool payload available.",
        ),
        formatToolPayloadSection("Error", part.errorText, "No tool payload available."),
      ];
    default:
      return [];
  }
}

export function getToolPayloadSections<TOOLS extends UITools>(
  part: ToolUIPart<TOOLS> | DynamicToolUIPart,
): readonly ToolPayloadSection[] {
  if (part.type === "dynamic-tool") {
    return getDynamicToolPayloadSections(part as DynamicToolUIPart);
  }

  return getStaticToolPayloadSections(part as ToolUIPart<TOOLS>);
}
