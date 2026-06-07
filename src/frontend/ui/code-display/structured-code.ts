import type { CodeBlockLanguage } from "../components/CodeBlock.js";

const INDENT = "  ";

export interface StructuredCodeDisplay {
  code: string;
  language: CodeBlockLanguage;
}

export function formatStructuredCodeDisplay(value: unknown): StructuredCodeDisplay {
  if (containsMultilineString(value)) {
    return {
      code: formatJavaScriptDisplayValue(value, 0, new WeakSet<object>()),
      language: "js",
    };
  }

  try {
    return {
      code: JSON.stringify(value, null, 2) ?? "null",
      language: "json",
    };
  } catch {
    return {
      code: formatJavaScriptDisplayValue(value, 0, new WeakSet<object>()),
      language: "js",
    };
  }
}

function containsMultilineString(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === "string") {
    return value.includes("\n") || value.includes("\r");
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => containsMultilineString(item, seen));
  }

  return Object.values(value).some((item) => containsMultilineString(item, seen));
}

function formatJavaScriptDisplayValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
      return formatDisplayString(value);
    case "number":
    case "boolean":
      return JSON.stringify(value);
    case "bigint":
      return `${value}n`;
    case "undefined":
      return "undefined";
    case "function":
      return JSON.stringify(`[Function${value.name ? `: ${value.name}` : ""}]`);
    case "symbol":
      return JSON.stringify(String(value));
    case "object":
      break;
    default:
      return JSON.stringify(typeof value);
  }

  if (value instanceof Date) {
    return `new Date(${JSON.stringify(value.toISOString())})`;
  }

  if (value instanceof RegExp) {
    return String(value);
  }

  if (seen.has(value)) {
    return JSON.stringify("[Circular]");
  }

  seen.add(value);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      seen.delete(value);
      return "[]";
    }

    const itemIndent = INDENT.repeat(depth + 1);
    const closingIndent = INDENT.repeat(depth);
    const items = value.map(
      (item) => `${itemIndent}${formatJavaScriptDisplayValue(item, depth + 1, seen)}`,
    );
    seen.delete(value);
    return `[\n${items.join(",\n")}\n${closingIndent}]`;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    seen.delete(value);
    return "{}";
  }

  const propertyIndent = INDENT.repeat(depth + 1);
  const closingIndent = INDENT.repeat(depth);
  const properties = entries.map(
    ([key, entryValue]) =>
      `${propertyIndent}${JSON.stringify(key)}: ${formatJavaScriptDisplayValue(entryValue, depth + 1, seen)}`,
  );
  seen.delete(value);
  return `{\n${properties.join(",\n")}\n${closingIndent}}`;
}

function formatDisplayString(value: string): string {
  if (!value.includes("\n") && !value.includes("\r")) {
    return JSON.stringify(value);
  }

  return `\`${value.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${")}\``;
}
