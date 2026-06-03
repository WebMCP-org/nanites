import { createHighlighter, type Highlighter, type BundledLanguage } from "shiki";

/**
 * Supported languages for CodeBlock.
 *
 * Keeping this list narrow keeps the bundle small — each language adds a few
 * hundred KB of grammar JSON. If you need another language, add it here and to
 * the initial `langs` array in `getHighlighterInstance`.
 */
export type CodeBlockLanguage =
  | "ts"
  | "tsx"
  | "js"
  | "jsx"
  | "css"
  | "html"
  | "json"
  | "bash"
  | "md";

export const CODE_BLOCK_LANGUAGES: ReadonlyArray<CodeBlockLanguage> = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "css",
  "html",
  "json",
  "bash",
  "md",
];

const SHIKI_LANGS: Array<BundledLanguage> = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "css",
  "html",
  "json",
  "bash",
  "markdown",
];

const LANG_ALIAS: Record<CodeBlockLanguage, BundledLanguage> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  css: "css",
  html: "html",
  json: "json",
  bash: "bash",
  md: "markdown",
};

let highlighterPromise: Promise<Highlighter> | null = null;

/**
 * Returns a cached Shiki highlighter instance loaded with both light and dark
 * themes and all supported languages. Subsequent calls return the same promise.
 */
export function getHighlighterInstance(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: ["github-light", "github-dark"],
    langs: SHIKI_LANGS,
  });
  return highlighterPromise;
}

/**
 * Resolves a CodeBlockLanguage to the Shiki bundled language name.
 */
export function toShikiLang(lang: CodeBlockLanguage): BundledLanguage {
  return LANG_ALIAS[lang];
}
