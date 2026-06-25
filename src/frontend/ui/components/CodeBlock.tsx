import * as React from "react";
import { Button, type ButtonProps } from "./Button.js";
import {
  Select,
  SelectList,
  SelectOption,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "./Select.js";
import {
  Tooltip,
  TooltipPopup,
  TooltipPortal,
  TooltipPositioner,
  TooltipTrigger,
} from "./Tooltip.js";
import { cx } from "./_internal/class-names.js";
import { CheckIcon, CopyIcon } from "./_internal/icons.js";
import {
  CODE_BLOCK_LANGUAGES,
  type CodeBlockLanguage,
  getHighlighterInstance,
  toShikiLang,
} from "./_internal/shiki.js";

export { CODE_BLOCK_LANGUAGES, type CodeBlockLanguage };

interface CodeBlockContextValue {
  code: string;
  language: CodeBlockLanguage;
  setLanguage: (next: CodeBlockLanguage) => void;
  showLineNumbers: boolean;
  isStreaming: boolean;
}

const CodeBlockContext = React.createContext<CodeBlockContextValue | null>(null);

function useCodeBlockContext(): CodeBlockContextValue {
  const ctx = React.use(CodeBlockContext);
  if (!ctx) {
    throw new Error("CodeBlock subcomponents must be used inside <CodeBlock>.");
  }
  return ctx;
}

export interface CodeBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The source code to display. */
  code: string;
  /** The language to highlight as. */
  language: CodeBlockLanguage;
  /** Whether to render line numbers in the left gutter. */
  showLineNumbers?: boolean;
  /**
   * Skip syntax highlighting while code is actively streaming in. Renders the
   * plain monospace fallback instead. Highlighting runs once when this flips
   * back to false.
   */
  isStreaming?: boolean;
  /** Fired when the language is changed via the inline selector. */
  onLanguageChange?: (next: CodeBlockLanguage) => void;
}

/**
 * A syntax-highlighted code block powered by Shiki. Supports line numbers,
 * inline language switching, and a copy-to-clipboard action.
 *
 * Supported languages: `ts`, `tsx`, `js`, `jsx`, `css`, `html`, `json`,
 * `bash`, `md`. The highlighter is loaded lazily on first render and cached
 * at module scope.
 *
 * @example
 * ```tsx
 * <CodeBlock code={"const x = 42;"} language="ts">
 *   <CodeBlockHeader>
 *     <CodeBlockFilename>example.ts</CodeBlockFilename>
 *     <CodeBlockActions>
 *       <CodeBlockCopyButton />
 *     </CodeBlockActions>
 *   </CodeBlockHeader>
 *   <CodeBlockContainer>
 *     <CodeBlockContent />
 *   </CodeBlockContainer>
 * </CodeBlock>
 * ```
 */
export function CodeBlock({
  className,
  code,
  language,
  showLineNumbers = false,
  isStreaming = false,
  onLanguageChange,
  children,
  ref,
  ...props
}: CodeBlockProps & { ref?: React.Ref<HTMLDivElement> }) {
  const [internalLanguage, setInternalLanguage] = React.useState(language);

  // Sync when parent changes the prop.
  React.useEffect(() => {
    setInternalLanguage(language);
  }, [language]);

  const setLanguage = React.useCallback(
    (next: CodeBlockLanguage) => {
      setInternalLanguage(next);
      onLanguageChange?.(next);
    },
    [onLanguageChange],
  );

  const ctxValue = React.useMemo<CodeBlockContextValue>(
    () => ({ code, language: internalLanguage, setLanguage, showLineNumbers, isStreaming }),
    [code, internalLanguage, setLanguage, showLineNumbers, isStreaming],
  );

  return (
    <CodeBlockContext.Provider value={ctxValue}>
      <div ref={ref} className={cx("code-block", className)} {...props}>
        {children}
      </div>
    </CodeBlockContext.Provider>
  );
}

export interface CodeBlockHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CodeBlockHeader({
  className,
  children,
  ref,
  ...props
}: CodeBlockHeaderProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("code-block__header", className)} {...props}>
      {children}
    </div>
  );
}

export interface CodeBlockTitleProps extends React.HTMLAttributes<HTMLSpanElement> {}

export function CodeBlockTitle({
  className,
  children,
  ref,
  ...props
}: CodeBlockTitleProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cx("code-block__title", className)} {...props}>
      {children}
    </span>
  );
}

export interface CodeBlockFilenameProps extends React.HTMLAttributes<HTMLSpanElement> {}

export function CodeBlockFilename({
  className,
  children,
  ref,
  ...props
}: CodeBlockFilenameProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cx("code-block__filename", className)} {...props}>
      {children}
    </span>
  );
}

export interface CodeBlockActionsProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CodeBlockActions({
  className,
  children,
  ref,
  ...props
}: CodeBlockActionsProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cx("code-block__actions", className)} {...props}>
      {children}
    </div>
  );
}

export interface CodeBlockCopyButtonProps extends Omit<
  ButtonProps,
  "children" | "variant" | "size" | "color" | "className" | "onClick"
> {
  className?: string;
  label?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

export function CodeBlockCopyButton({
  className,
  label = "Copy code",
  onClick,
  ...props
}: CodeBlockCopyButtonProps) {
  const { code } = useCodeBlockContext();
  const [copied, setCopied] = React.useState(false);

  const handleClick = React.useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      try {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } catch {
        /* ignore */
      }
      onClick?.(e);
    },
    [code, onClick],
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            className={cx("code-block__copy", className)}
            {...props}
            onClick={handleClick}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        }
      />
      <TooltipPortal>
        <TooltipPositioner>
          <TooltipPopup>{copied ? "Copied" : label}</TooltipPopup>
        </TooltipPositioner>
      </TooltipPortal>
    </Tooltip>
  );
}

export interface CodeBlockLanguageSelectorProps extends React.HTMLAttributes<HTMLDivElement> {
  languages?: ReadonlyArray<CodeBlockLanguage>;
}

export function CodeBlockLanguageSelector({
  className,
  languages = CODE_BLOCK_LANGUAGES,
  ref,
  ...props
}: CodeBlockLanguageSelectorProps & { ref?: React.Ref<HTMLDivElement> }) {
  const { language, setLanguage } = useCodeBlockContext();
  return (
    <div ref={ref} className={cx("code-block__language-selector", className)} {...props}>
      <Select
        value={language}
        onValueChange={(value: unknown) => setLanguage(value as CodeBlockLanguage)}
      >
        <SelectTrigger size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectPortal>
          <SelectPositioner>
            <SelectPopup>
              <SelectList>
                {languages.map((lang) => (
                  <SelectOption key={lang} value={lang}>
                    {lang}
                  </SelectOption>
                ))}
              </SelectList>
            </SelectPopup>
          </SelectPositioner>
        </SelectPortal>
      </Select>
    </div>
  );
}

export interface CodeBlockContainerProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CodeBlockContainer({
  className,
  children,
  tabIndex = 0,
  ref,
  ...props
}: CodeBlockContainerProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      className={cx("code-block__container", className)}
      tabIndex={tabIndex}
      {...props}
    >
      {children}
    </div>
  );
}

export interface CodeBlockContentProps extends React.HTMLAttributes<HTMLElement> {}

export function CodeBlockContent({
  className,
  ref,
  ...props
}: CodeBlockContentProps & { ref?: React.Ref<HTMLElement> }) {
  const { code, language, showLineNumbers, isStreaming } = useCodeBlockContext();
  const [html, setHtml] = React.useState<string | null>(null);
  const [theme, setTheme] = React.useState<"github-light" | "github-dark">(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark"
      ? "github-dark"
      : "github-light",
  );

  // Watch for theme changes on <html data-theme>.
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => {
      setTheme(document.documentElement.dataset.theme === "dark" ? "github-dark" : "github-light");
    };
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (isStreaming) return;
    let cancelled = false;
    void (async () => {
      try {
        const highlighter = await getHighlighterInstance();
        const out = highlighter.codeToHtml(code, {
          lang: toShikiLang(language),
          theme,
        });
        if (!cancelled) setHtml(removeInjectedPreTabIndex(out));
      } catch {
        if (!cancelled) setHtml(`<pre>${escapeHtml(code)}</pre>`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, language, theme, isStreaming]);

  if (html === null || isStreaming) {
    return (
      <pre
        ref={ref as React.Ref<HTMLPreElement>}
        className={cx(
          "code-block__content",
          showLineNumbers && "code-block__content--numbered",
          className,
        )}
        {...props}
      >
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className={cx(
        "code-block__content code-block__content--highlighted",
        showLineNumbers && "code-block__content--numbered",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
      {...props}
    />
  );
}

function removeInjectedPreTabIndex(html: string): string {
  return html.replace(/\s+tabindex=(["'])0\1/g, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
