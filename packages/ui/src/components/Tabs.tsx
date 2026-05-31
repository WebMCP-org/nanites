import * as React from "react";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";

export interface TabsProps extends Omit<BaseTabs.Root.Props, "className"> {
  className?: string;
  /**
   * The visual style variant.
   * @default 'default'
   */
  variant?: "default" | "bordered";
}

export interface TabsListProps extends Omit<BaseTabs.List.Props, "className"> {
  className?: string;
}

export interface TabProps extends Omit<BaseTabs.Tab.Props, "className"> {
  className?: string;
}

export interface TabPanelProps extends Omit<BaseTabs.Panel.Props, "className"> {
  className?: string;
}

/**
 * A tabs component for organizing content into separate views.
 *
 * @example
 * ```tsx
 * <Tabs defaultValue="tab1">
 *   <TabsList>
 *     <Tab value="tab1">Tab 1</Tab>
 *     <Tab value="tab2">Tab 2</Tab>
 *   </TabsList>
 *   <TabPanel value="tab1">Content 1</TabPanel>
 *   <TabPanel value="tab2">Content 2</TabPanel>
 * </Tabs>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/tabs | Base UI Tabs}
 */
export function Tabs({
  variant = "default",
  className = "",
  ref,
  ...props
}: TabsProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["tabs", variant !== "default" && `tabs--${variant}`, className]
    .filter(Boolean)
    .join(" ");
  return <BaseTabs.Root ref={ref} className={classes} {...props} />;
}

export function TabsList({
  className = "",
  ref,
  ...props
}: TabsListProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["tabs__list", className].filter(Boolean).join(" ");
  return <BaseTabs.List ref={ref} className={classes} {...props} />;
}

export function Tab({
  className = "",
  ref,
  ...props
}: TabProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["tabs__tab", className].filter(Boolean).join(" ");
  return <BaseTabs.Tab ref={ref} className={classes} {...props} />;
}

export function TabPanel({
  className = "",
  ref,
  ...props
}: TabPanelProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["tabs__panel", className].filter(Boolean).join(" ");
  return <BaseTabs.Panel ref={ref} className={classes} {...props} />;
}
