import * as React from "react";
import { Toast as BaseToast } from "@base-ui/react/toast";

/**
 * Props for the Toast.Provider component.
 */
export interface ToastProviderProps extends React.ComponentPropsWithoutRef<
  typeof BaseToast.Provider
> {}

/**
 * Props for the Toast.Viewport component.
 */
export interface ToastViewportProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseToast.Viewport>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Toast.Root component.
 */
export interface ToastRootProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseToast.Root>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Toast.Content component.
 */
export interface ToastContentProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseToast.Content>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Toast.Title component.
 */
export interface ToastTitleProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseToast.Title>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Toast.Description component.
 */
export interface ToastDescriptionProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseToast.Description>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Toast.Action component.
 */
export interface ToastActionProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseToast.Action>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Props for the Toast.Close component.
 */
export interface ToastCloseProps extends Omit<
  React.ComponentPropsWithoutRef<typeof BaseToast.Close>,
  "className"
> {
  /** Additional CSS class names */
  className?: string;
}

/**
 * Wraps your application to manage toast state.
 *
 * @example
 * ```tsx
 * <Toast.Provider>
 *   <App />
 *   <Toast.Viewport />
 * </Toast.Provider>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/toast | Base UI Toast}
 */
const ToastProvider = (props: ToastProviderProps) => {
  return <BaseToast.Provider {...props} />;
};

/**
 * Container for displaying toasts.
 */
function ToastViewport({
  className = "",
  ref,
  ...props
}: ToastViewportProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["toast__viewport", className].filter(Boolean).join(" ");
  return <BaseToast.Viewport ref={ref} className={classes} {...props} />;
}

/**
 * Individual toast wrapper.
 */
function ToastRoot({
  className = "",
  ref,
  ...props
}: ToastRootProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["toast", className].filter(Boolean).join(" ");
  return <BaseToast.Root ref={ref} className={classes} {...props} />;
}

/**
 * Container for the contents of a toast.
 */
function ToastContent({
  className = "",
  ref,
  ...props
}: ToastContentProps & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["toast__content", className].filter(Boolean).join(" ");
  return <BaseToast.Content ref={ref} className={classes} {...props} />;
}

/**
 * Title that labels the toast. Renders an `<h2>` element.
 */
function ToastTitle({
  className = "",
  ref,
  ...props
}: ToastTitleProps & { ref?: React.Ref<HTMLHeadingElement> }) {
  const classes = ["toast__title", className].filter(Boolean).join(" ");
  return <BaseToast.Title ref={ref} className={classes} {...props} />;
}

/**
 * Description text for the toast. Renders a `<p>` element.
 */
function ToastDescription({
  className = "",
  ref,
  ...props
}: ToastDescriptionProps & { ref?: React.Ref<HTMLParagraphElement> }) {
  const classes = ["toast__description", className].filter(Boolean).join(" ");
  return <BaseToast.Description ref={ref} className={classes} {...props} />;
}

/**
 * Action button within the toast.
 */
function ToastAction({
  className = "",
  ref,
  ...props
}: ToastActionProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["toast__action", className].filter(Boolean).join(" ");
  return <BaseToast.Action ref={ref} className={classes} {...props} />;
}

/**
 * Close button that dismisses the toast.
 */
function ToastClose({
  className = "",
  ref,
  ...props
}: ToastCloseProps & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["toast__close", className].filter(Boolean).join(" ");
  return <BaseToast.Close ref={ref} className={classes} {...props} />;
}

/**
 * A toast notification system for displaying temporary messages.
 * Supports multiple toasts, swipe-to-dismiss, and customizable positioning.
 *
 * @example
 * ```tsx
 * // Setup in your app root
 * function App() {
 *   return (
 *     <Toast.Provider timeout={5000} limit={3}>
 *       <YourApp />
 *       <ToastViewport />
 *     </Toast.Provider>
 *   );
 * }
 *
 * // Custom viewport that renders toasts
 * function ToastViewport() {
 *   const { toasts } = Toast.useToastManager();
 *
 *   return (
 *     <Toast.Viewport>
 *       {toasts.map((toast) => (
 *         <Toast.Root key={toast.id} toast={toast}>
 *           <Toast.Content>
 *             <Toast.Title>{toast.title}</Toast.Title>
 *             <Toast.Description>{toast.description}</Toast.Description>
 *           </Toast.Content>
 *           <Toast.Close>Dismiss</Toast.Close>
 *         </Toast.Root>
 *       ))}
 *     </Toast.Viewport>
 *   );
 * }
 *
 * // Trigger toasts from anywhere
 * function SomeComponent() {
 *   const toastManager = Toast.useToastManager();
 *
 *   return (
 *     <button onClick={() => toastManager.add({
 *       title: 'Success',
 *       description: 'Your changes have been saved.'
 *     })}>
 *       Show Toast
 *     </button>
 *   );
 * }
 * ```
 *
 * @see {@link https://base-ui.com/react/components/toast | Base UI Toast}
 */
export const Toast = {
  Provider: ToastProvider,
  Viewport: ToastViewport,
  Root: ToastRoot,
  Content: ToastContent,
  Title: ToastTitle,
  Description: ToastDescription,
  Action: ToastAction,
  Close: ToastClose,
  /** Hook to access the toast manager for adding/removing toasts */
  useToastManager: BaseToast.useToastManager,
};
