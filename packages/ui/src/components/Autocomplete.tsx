import * as React from "react";
import { Autocomplete as BaseAutocomplete } from "@base-ui/react/autocomplete";

// Styled wrapper components

function Input({
  className = "",
  ref,
  ...props
}: Omit<React.ComponentPropsWithRef<typeof BaseAutocomplete.Input>, "className"> & {
  className?: string;
} & { ref?: React.Ref<HTMLInputElement> }) {
  const classes = ["autocomplete__input", className].filter(Boolean).join(" ");
  return <BaseAutocomplete.Input ref={ref} className={classes} {...props} />;
}

function Trigger({
  className = "",
  ref,
  ...props
}: Omit<React.ComponentPropsWithRef<typeof BaseAutocomplete.Trigger>, "className"> & {
  className?: string;
} & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["autocomplete__trigger", className].filter(Boolean).join(" ");
  return <BaseAutocomplete.Trigger ref={ref} className={classes} {...props} />;
}

function Clear({
  className = "",
  ref,
  ...props
}: Omit<React.ComponentPropsWithRef<typeof BaseAutocomplete.Clear>, "className"> & {
  className?: string;
} & { ref?: React.Ref<HTMLButtonElement> }) {
  const classes = ["autocomplete__clear", className].filter(Boolean).join(" ");
  return <BaseAutocomplete.Clear ref={ref} className={classes} {...props} />;
}

function Positioner({
  className = "",
  ref,
  ...props
}: Omit<React.ComponentPropsWithRef<typeof BaseAutocomplete.Positioner>, "className"> & {
  className?: string;
} & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["autocomplete__positioner", className].filter(Boolean).join(" ");
  return <BaseAutocomplete.Positioner ref={ref} className={classes} {...props} />;
}

function Popup({
  className = "",
  ref,
  ...props
}: Omit<React.ComponentPropsWithRef<typeof BaseAutocomplete.Popup>, "className"> & {
  className?: string;
} & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["autocomplete__popup", className].filter(Boolean).join(" ");
  return <BaseAutocomplete.Popup ref={ref} className={classes} {...props} />;
}

const List = BaseAutocomplete.List;

function Item({
  className = "",
  ref,
  ...props
}: Omit<React.ComponentPropsWithRef<typeof BaseAutocomplete.Item>, "className"> & {
  className?: string;
} & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["autocomplete__item", className].filter(Boolean).join(" ");
  return <BaseAutocomplete.Item ref={ref} className={classes} {...props} />;
}

function Empty({
  className = "",
  ref,
  ...props
}: Omit<React.ComponentPropsWithRef<typeof BaseAutocomplete.Empty>, "className"> & {
  className?: string;
} & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["autocomplete__empty", className].filter(Boolean).join(" ");
  return <BaseAutocomplete.Empty ref={ref} className={classes} {...props} />;
}

function Status({
  className = "",
  ref,
  ...props
}: Omit<React.ComponentPropsWithRef<typeof BaseAutocomplete.Status>, "className"> & {
  className?: string;
} & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["autocomplete__status", className].filter(Boolean).join(" ");
  return <BaseAutocomplete.Status ref={ref} className={classes} {...props} />;
}

function Group({
  className = "",
  ref,
  ...props
}: Omit<React.ComponentPropsWithRef<typeof BaseAutocomplete.Group>, "className"> & {
  className?: string;
} & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["autocomplete__group", className].filter(Boolean).join(" ");
  return <BaseAutocomplete.Group ref={ref} className={classes} {...props} />;
}

function GroupLabel({
  className = "",
  ref,
  ...props
}: Omit<React.ComponentPropsWithRef<typeof BaseAutocomplete.GroupLabel>, "className"> & {
  className?: string;
} & { ref?: React.Ref<HTMLDivElement> }) {
  const classes = ["autocomplete__group-label", className].filter(Boolean).join(" ");
  return <BaseAutocomplete.GroupLabel ref={ref} className={classes} {...props} />;
}

/**
 * An input with a list of filtered options for auto-completion.
 * Supports async search, grouping, and various autocomplete modes.
 *
 * @example
 * ```tsx
 * // Basic autocomplete
 * const tags = ['React', 'Vue', 'Angular', 'Svelte'];
 *
 * <Autocomplete.Root items={tags}>
 *   <Autocomplete.Input placeholder="Search tags..." />
 *   <Autocomplete.Portal>
 *     <Autocomplete.Positioner>
 *       <Autocomplete.Popup>
 *         <Autocomplete.List>
 *           {(item) => (
 *             <Autocomplete.Item value={item}>
 *               {item}
 *             </Autocomplete.Item>
 *           )}
 *         </Autocomplete.List>
 *         <Autocomplete.Empty>No tags found</Autocomplete.Empty>
 *       </Autocomplete.Popup>
 *     </Autocomplete.Positioner>
 *   </Autocomplete.Portal>
 * </Autocomplete.Root>
 * ```
 *
 * @example
 * ```tsx
 * // With async search
 * const [items, setItems] = useState([]);
 * const [loading, setLoading] = useState(false);
 *
 * <Autocomplete.Root
 *   items={items}
 *   filter={null}
 *   onInputValueChange={async (value) => {
 *     setLoading(true);
 *     const results = await fetchResults(value);
 *     setItems(results);
 *     setLoading(false);
 *   }}
 * >
 *   <Autocomplete.Input placeholder="Search..." />
 *   <Autocomplete.Portal>
 *     <Autocomplete.Positioner>
 *       <Autocomplete.Popup>
 *         <Autocomplete.Status>
 *           {loading ? 'Searching...' : null}
 *         </Autocomplete.Status>
 *         <Autocomplete.List>
 *           {(item) => (
 *             <Autocomplete.Item value={item}>
 *               {item.label}
 *             </Autocomplete.Item>
 *           )}
 *         </Autocomplete.List>
 *       </Autocomplete.Popup>
 *     </Autocomplete.Positioner>
 *   </Autocomplete.Portal>
 * </Autocomplete.Root>
 * ```
 *
 * @see {@link https://base-ui.com/react/components/autocomplete | Base UI Autocomplete}
 */
export const Autocomplete = {
  Root: BaseAutocomplete.Root,
  Input,
  Trigger,
  Clear,
  Portal: BaseAutocomplete.Portal,
  Positioner,
  Popup,
  List,
  Item,
  Empty,
  Status,
  Group,
  GroupLabel,
};
