import * as React from "react";
import { cx } from "./_internal/class-names.js";
import { ChevronRightIcon, FileIcon, FolderIcon, FolderOpenIcon } from "./_internal/icons.js";
import {
  FileTreeContext,
  useFileTreeContext,
  useFileTreeNav,
} from "./_internal/use-file-tree-nav.js";

export interface FileTreeProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  /** Set of folder paths that should be expanded. Controlled mode. */
  expanded?: Set<string>;
  /** Initial set of expanded folder paths. Uncontrolled mode. */
  defaultExpanded?: Set<string>;
  /** Currently selected file path. Controlled mode. */
  selectedPath?: string | null;
  /** Called when a file is selected. */
  onSelect?: (path: string) => void;
  /** Called when the expanded set changes. */
  onExpandedChange?: (next: Set<string>) => void;
}

/**
 * A keyboard-accessible hierarchical file browser. Compose with
 * FileTreeFolder and FileTreeFile children.
 *
 * Keyboard: ↑/↓ move focus, →/← expand/collapse folders, Enter/Space
 * selects a file or toggles a folder, Home/End jump to first/last node.
 *
 * @example
 * ```tsx
 * <FileTree defaultExpanded={new Set(["src"])}>
 *   <FileTreeFolder path="src" name="src">
 *     <FileTreeFile path="src/index.ts" name="index.ts" />
 *     <FileTreeFolder path="src/domain" name="domain">
 *       <FileTreeFile path="src/domain/model.ts" name="model.ts" />
 *     </FileTreeFolder>
 *   </FileTreeFolder>
 * </FileTree>
 * ```
 */
export function FileTree({
  className,
  expanded,
  defaultExpanded,
  selectedPath = null,
  onSelect,
  onExpandedChange,
  children,
  ref,
  ...props
}: FileTreeProps & { ref?: React.Ref<HTMLDivElement> }) {
  const [internalExpanded, setInternalExpanded] = React.useState<Set<string>>(
    () => defaultExpanded ?? new Set(),
  );
  const isControlled = expanded !== undefined;
  const currentExpanded = isControlled ? expanded : internalExpanded;

  const handleExpandedChange = React.useCallback(
    (next: Set<string>) => {
      if (!isControlled) setInternalExpanded(next);
      onExpandedChange?.(next);
    },
    [isControlled, onExpandedChange],
  );

  const handleSelect = React.useCallback(
    (path: string) => {
      onSelect?.(path);
    },
    [onSelect],
  );

  const ctx = useFileTreeNav({
    expanded: currentExpanded,
    selectedPath,
    onSelect: handleSelect,
    onExpandedChange: handleExpandedChange,
  });

  return (
    <FileTreeContext.Provider value={ctx}>
      <div
        ref={ref}
        role="tree"
        aria-label="File tree"
        className={cx("file-tree", className)}
        {...props}
      >
        <ul className="file-tree__list">{children}</ul>
      </div>
    </FileTreeContext.Provider>
  );
}

export interface FileTreeFolderProps extends React.HTMLAttributes<HTMLLIElement> {
  /** Unique path identifier for this folder. */
  path: string;
  /** Display name. */
  name: string;
  /** Depth level (0 for top-level). Auto-incremented by nested folders. */
  level?: number;
}

export function FileTreeFolder({
  className,
  path,
  name,
  level = 0,
  children,
  ref,
  ...props
}: FileTreeFolderProps & { ref?: React.Ref<HTMLLIElement> }) {
  const { expanded, focusedPath, onFocus, register, handleKeyDown, onExpandedChange } =
    useFileTreeContext();
  const isExpanded = expanded.has(path);
  const isFocused = focusedPath === path;

  // Register this node on every render. Pass parent's "visible" status so
  // nav can skip collapsed branches.
  register(path, "folder", true);

  const toggle = React.useCallback(() => {
    onExpandedChange(path, !isExpanded);
  }, [isExpanded, onExpandedChange, path]);

  return (
    <li
      ref={ref}
      role="treeitem"
      aria-expanded={isExpanded}
      className={cx("file-tree__folder", className)}
      {...props}
    >
      <button
        type="button"
        className="file-tree__node file-tree__node--folder"
        data-focused={isFocused ? "" : undefined}
        tabIndex={isFocused || (!focusedPath && level === 0) ? 0 : -1}
        onClick={toggle}
        onFocus={() => onFocus(path)}
        onKeyDown={(e) => handleKeyDown(e, path, "folder")}
        style={{ "--file-tree-level": level } as React.CSSProperties}
      >
        <span
          className={cx("file-tree__chevron", isExpanded && "file-tree__chevron--expanded")}
          aria-hidden="true"
        >
          <ChevronRightIcon />
        </span>
        <span className="file-tree__icon" aria-hidden="true">
          {isExpanded ? <FolderOpenIcon /> : <FolderIcon />}
        </span>
        <span className="file-tree__name">{name}</span>
      </button>
      {isExpanded ? (
        <ul className="file-tree__list">
          {React.Children.map(children, (child) => {
            if (
              React.isValidElement<{ level?: number }>(child) &&
              (child.type === FileTreeFolder || child.type === FileTreeFile)
            ) {
              return React.cloneElement(child, { level: level + 1 });
            }
            return child;
          })}
        </ul>
      ) : null}
    </li>
  );
}

export interface FileTreeFileProps extends React.HTMLAttributes<HTMLLIElement> {
  path: string;
  name: string;
  /** Optional custom icon; defaults to a generic file icon. */
  icon?: React.ReactNode;
  /** Depth level, auto-set by parent folder. */
  level?: number;
}

export function FileTreeFile({
  className,
  path,
  name,
  icon,
  level = 0,
  ref,
  ...props
}: FileTreeFileProps & { ref?: React.Ref<HTMLLIElement> }) {
  const { selectedPath, focusedPath, onFocus, onSelect, register, handleKeyDown } =
    useFileTreeContext();
  const isSelected = selectedPath === path;
  const isFocused = focusedPath === path;

  register(path, "file", true);

  return (
    <li
      ref={ref}
      role="treeitem"
      aria-selected={isSelected}
      className={cx("file-tree__file", className)}
      {...props}
    >
      <button
        type="button"
        className="file-tree__node file-tree__node--file"
        data-selected={isSelected ? "" : undefined}
        data-focused={isFocused ? "" : undefined}
        tabIndex={isFocused || (!focusedPath && level === 0) ? 0 : -1}
        onClick={() => onSelect(path)}
        onFocus={() => onFocus(path)}
        onKeyDown={(e) => handleKeyDown(e, path, "file")}
        style={{ "--file-tree-level": level } as React.CSSProperties}
      >
        <span className="file-tree__icon" aria-hidden="true">
          {icon ?? <FileIcon />}
        </span>
        <span className="file-tree__name">{name}</span>
      </button>
    </li>
  );
}

export interface FileTreeIconProps extends React.HTMLAttributes<HTMLSpanElement> {}

export function FileTreeIcon({
  className,
  children,
  ref,
  ...props
}: FileTreeIconProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cx("file-tree__icon", className)} aria-hidden="true" {...props}>
      {children}
    </span>
  );
}

export interface FileTreeNameProps extends React.HTMLAttributes<HTMLSpanElement> {}

export function FileTreeName({
  className,
  children,
  ref,
  ...props
}: FileTreeNameProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cx("file-tree__name", className)} {...props}>
      {children}
    </span>
  );
}

export interface FileTreeActionsProps extends React.HTMLAttributes<HTMLDivElement> {}

export function FileTreeActions({
  className,
  children,
  onClick,
  ref,
  ...props
}: FileTreeActionsProps & { ref?: React.Ref<HTMLDivElement> }) {
  const handleClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      onClick?.(e);
    },
    [onClick],
  );
  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
  }, []);
  return (
    <div
      ref={ref}
      role="presentation"
      className={cx("file-tree__actions", className)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {children}
    </div>
  );
}
