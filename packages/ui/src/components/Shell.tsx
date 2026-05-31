import * as React from "react";

/**
 * Props for the Shell.Root component.
 */
export interface ShellRootProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Additional CSS class names */
  className?: string;
  /** The heading text displayed in the header */
  heading?: string;
}

/**
 * Props for the Shell.ActionBar component.
 */
export interface ShellActionBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Shell.Action component.
 */
export interface ShellActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Additional CSS class names */
  className?: string;
  /** Icon to display */
  icon?: React.ReactNode;
  /** Whether this action is currently active */
  active?: boolean;
  /** Accessible label for the action */
  label?: string;
}

/**
 * Props for the Shell.Panel component.
 */
export interface ShellPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Additional CSS class names */
  className?: string;
  /** The panel heading */
  heading?: string;
  /** Whether the panel is visible */
  open?: boolean;
}

/**
 * Props for the Shell.Content component.
 */
export interface ShellContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Root container for the shell layout.
 * Provides a structured layout with optional header, action bar, panel, and content areas.
 */
function ShellRoot({
  className = "",
  heading,
  children,
  ref,
  ...props
}: ShellRootProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["shell", className].filter(Boolean).join(" ");
  return (
    <div ref={ref} className={classes} {...props}>
      {heading && (
        <header className="shell__header">
          <h3 className="shell__heading">{heading}</h3>
        </header>
      )}
      <div className="shell__body">{children}</div>
    </div>
  );
}

/**
 * Container for action buttons that toggle panels.
 * Typically placed on the left side of the shell.
 */
function ShellActionBar({
  className = "",
  children,
  ref,
  ...props
}: ShellActionBarProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["shell__action-bar", className].filter(Boolean).join(" ");
  return (
    <div ref={ref} className={classes} {...props}>
      {children}
    </div>
  );
}

/**
 * An action button within the action bar.
 */
function ShellAction({
  className = "",
  icon,
  active,
  label,
  ref,
  ...props
}: ShellActionProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["shell__action", active && "shell__action--active", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button ref={ref} className={classes} aria-label={label} aria-pressed={active} {...props}>
      {icon}
    </button>
  );
}

/**
 * A collapsible panel that slides in from the side.
 */
function ShellPanel({
  className = "",
  heading,
  open = false,
  children,
  ref,
  ...props
}: ShellPanelProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["shell__panel", open && "shell__panel--open", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div ref={ref} className={classes} hidden={!open} {...props}>
      {heading && <div className="shell__panel-heading">{heading}</div>}
      <div className="shell__panel-content">{children}</div>
    </div>
  );
}

/**
 * The main content area of the shell.
 */
function ShellContent({
  className = "",
  children,
  ref,
  ...props
}: ShellContentProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["shell__content", className].filter(Boolean).join(" ");
  return (
    <div ref={ref} className={classes} {...props}>
      {children}
    </div>
  );
}

/**
 * A shell layout component with action bar, collapsible panel, and content areas.
 * Useful for map applications and other interactive tools.
 *
 * @example
 * ```tsx
 * const [filterOpen, setFilterOpen] = useState(false);
 *
 * <Shell.Root heading="My Map Application">
 *   <Shell.ActionBar>
 *     <Shell.Action
 *       icon={<FilterIcon />}
 *       active={filterOpen}
 *       onClick={() => setFilterOpen(!filterOpen)}
 *       label="Filter"
 *     />
 *   </Shell.ActionBar>
 *   <Shell.Panel heading="Filter" open={filterOpen}>
 *     <p>Filter controls here</p>
 *   </Shell.Panel>
 *   <Shell.Content>
 *     <div id="map" />
 *   </Shell.Content>
 * </Shell.Root>
 * ```
 */
export const Shell = {
  Root: ShellRoot,
  ActionBar: ShellActionBar,
  Action: ShellAction,
  Panel: ShellPanel,
  Content: ShellContent,
};
