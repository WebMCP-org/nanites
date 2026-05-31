import * as React from "react";
import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { cx } from "./_internal/class-names.js";
import { ChevronRightIcon, FileIcon } from "./_internal/icons.js";

export interface TaskProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Root>,
  "className"
> {
  className?: string;
}

/**
 * A collapsible task/workflow list. Compose with TaskTrigger, TaskContent,
 * TaskItem, and TaskItemFile to show structured progress for a multi-step
 * workflow like file edits.
 *
 * @example
 * ```tsx
 * <Task defaultOpen>
 *   <TaskTrigger title="Refactoring authentication module" />
 *   <TaskContent>
 *     <TaskItem>
 *       Updated <TaskItemFile name="auth.ts" /> to export the new interface
 *     </TaskItem>
 *     <TaskItem>
 *       Added tests in <TaskItemFile name="auth.test.ts" />
 *     </TaskItem>
 *   </TaskContent>
 * </Task>
 * ```
 */
export function Task({
  className,
  ref,
  ...props
}: TaskProps & { ref?: React.Ref<HTMLDivElement> }) {
  return <BaseCollapsible.Root ref={ref} className={cx("task", className)} {...props} />;
}

export interface TaskTriggerProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Trigger>,
  "className"
> {
  className?: string;
  /** Heading text shown in the trigger row. */
  title: string;
}

/**
 * Clickable header that toggles the task content.
 */
export function TaskTrigger({
  className,
  title,
  children,
  ref,
  ...props
}: TaskTriggerProps & { ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <BaseCollapsible.Trigger ref={ref} className={cx("task__trigger", className)} {...props}>
      <span className="task__trigger-icon" aria-hidden="true">
        <ChevronRightIcon />
      </span>
      <span className="task__trigger-title">{title}</span>
      {children ? <span className="task__trigger-extras">{children}</span> : null}
    </BaseCollapsible.Trigger>
  );
}

export interface TaskContentProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseCollapsible.Panel>,
  "className"
> {
  className?: string;
}

/**
 * The collapsible panel containing TaskItem children.
 */
export function TaskContent({
  className,
  children,
  ref,
  ...props
}: TaskContentProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <BaseCollapsible.Panel ref={ref} className={cx("task__content", className)} {...props}>
      <ul className="task__list">{children}</ul>
    </BaseCollapsible.Panel>
  );
}

export interface TaskItemProps extends React.HTMLAttributes<HTMLLIElement> {}

/**
 * A single task row. Free-form content; compose with TaskItemFile to
 * reference a file inline.
 */
export function TaskItem({
  className,
  children,
  ref,
  ...props
}: TaskItemProps & { ref?: React.Ref<HTMLLIElement> }) {
  return (
    <li ref={ref} className={cx("task__item", className)} {...props}>
      {children}
    </li>
  );
}

export interface TaskItemFileProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The file name or path to display. Used to derive the language badge. */
  name: string;
}

/**
 * Inline file reference badge used inside TaskItem content.
 */
export function TaskItemFile({
  className,
  name,
  children,
  ref,
  ...props
}: TaskItemFileProps & { ref?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cx("task__file", className)} {...props}>
      <span className="task__file-icon" aria-hidden="true">
        <FileIcon />
      </span>
      <span className="task__file-name">{children ?? name}</span>
    </span>
  );
}
