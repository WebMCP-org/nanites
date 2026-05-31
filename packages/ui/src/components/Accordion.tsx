import * as React from "react";
import { Accordion as BaseAccordion } from "@base-ui/react/accordion";

export interface AccordionProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseAccordion.Root>,
  "className"
> {
  className?: string;
}

export interface AccordionItemProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseAccordion.Item>,
  "className"
> {
  className?: string;
}

export interface AccordionTriggerProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseAccordion.Trigger>,
  "className"
> {
  className?: string;
}

export interface AccordionPanelProps extends Omit<
  React.ComponentPropsWithRef<typeof BaseAccordion.Panel>,
  "className"
> {
  className?: string;
}

/**
 * An accordion component for showing collapsible content sections.
 *
 * @example
 * ```tsx
 * <Accordion>
 *   <AccordionItem value="item-1">
 *     <AccordionTrigger>Section 1</AccordionTrigger>
 *     <AccordionPanel>Content for section 1</AccordionPanel>
 *   </AccordionItem>
 *   <AccordionItem value="item-2">
 *     <AccordionTrigger>Section 2</AccordionTrigger>
 *     <AccordionPanel>Content for section 2</AccordionPanel>
 *   </AccordionItem>
 * </Accordion>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/accordion | Base UI Accordion}
 */
export function Accordion({
  className = "",
  ref,
  ...props
}: AccordionProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["accordion", className].filter(Boolean).join(" ");
  return <BaseAccordion.Root ref={ref} className={classes} {...props} />;
}

/**
 * A single item within an Accordion.
 */
export function AccordionItem({
  className = "",
  ref,
  ...props
}: AccordionItemProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["accordion__item", className].filter(Boolean).join(" ");
  return <BaseAccordion.Item ref={ref} className={classes} {...props} />;
}

/**
 * The header/trigger that toggles an AccordionItem.
 */
export const AccordionHeader = BaseAccordion.Header;

/**
 * The clickable trigger button within an AccordionItem.
 */
export function AccordionTrigger({
  className = "",
  children,
  ref,
  ...props
}: AccordionTriggerProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["accordion__trigger", className].filter(Boolean).join(" ");
  return (
    <BaseAccordion.Header className="accordion__header">
      <BaseAccordion.Trigger ref={ref} className={classes} {...props}>
        <span className="accordion__trigger-text">{children}</span>
        <span className="accordion__icon" aria-hidden="true">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2.5 4.5L6 8L9.5 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </BaseAccordion.Trigger>
    </BaseAccordion.Header>
  );
}

/**
 * The collapsible content panel of an AccordionItem.
 */
export function AccordionPanel({
  className = "",
  ref,
  ...props
}: AccordionPanelProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["accordion__panel", className].filter(Boolean).join(" ");
  return <BaseAccordion.Panel ref={ref} className={classes} {...props} />;
}
