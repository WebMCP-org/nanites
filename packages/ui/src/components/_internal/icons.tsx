import * as React from "react";

/**
 * Small inline-SVG icon set used across AI chat and code components.
 *
 * All icons are 16x16 by default, use `currentColor` for strokes/fills, and
 * accept standard SVG props so consumers can override size and aria-hidden.
 */
export type IconProps = Omit<React.SVGAttributes<SVGSVGElement>, "width" | "height"> & {
  size?: number | string;
};

function Icon({ children, size = 16, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const ChevronRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 3.5L10.5 8L6 12.5" />
  </Icon>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 6L8 10.5L12.5 6" />
  </Icon>
);

export const ChevronLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 3.5L5.5 8L10 12.5" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 8.5L6.5 12L13 4.5" />
  </Icon>
);

export const XIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 4L12 12M12 4L4 12" />
  </Icon>
);

export const CopyIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5" y="5" width="8" height="8" rx="1.5" />
    <path d="M11 5V4a1.5 1.5 0 0 0-1.5-1.5h-5A1.5 1.5 0 0 0 3 4v5A1.5 1.5 0 0 0 4.5 10.5H5" />
  </Icon>
);

export const EyeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M1.5 8S4 3 8 3s6.5 5 6.5 5-2.5 5-6.5 5S1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="2" />
  </Icon>
);

export const EyeOffIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 2l12 12" />
    <path d="M6.5 4A7.5 7.5 0 0 1 8 3.75c4 0 6.5 5 6.5 5a13 13 0 0 1-1.75 2.5" />
    <path d="M9.85 10.08A2 2 0 0 1 6.08 6.15" />
    <path d="M4.5 5.5C2.5 7 1.5 8 1.5 8s2.5 5 6.5 5c.8 0 1.55-.15 2.25-.42" />
  </Icon>
);

export const FolderIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 5.5v6A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5V4Z" />
  </Icon>
);

export const FolderOpenIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M1.5 11.5v-7A1.5 1.5 0 0 1 3 3h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 6v1" />
    <path d="M1.5 11.5 3.5 7H15l-2 4.5H1.5Z" />
  </Icon>
);

export const FileIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8A1.5 1.5 0 0 0 13.5 13V6L9 1.5Z" />
    <path d="M9 1.5V6h4.5" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const MinusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 8h10" />
  </Icon>
);

export const PlayIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 3l9 5-9 5V3Z" fill="currentColor" />
  </Icon>
);

export const SquareIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
  </Icon>
);

export const ArrowLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13 8H3M7 4L3 8l4 4" />
  </Icon>
);

export const ArrowRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Icon>
);

export const ArrowDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Icon>
);

export const ArrowUpIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Icon>
);

export const DownloadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 2v8M4 7l4 4 4-4" />
    <path d="M2.5 13.5h11" />
  </Icon>
);

export const RefreshIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13.5 3v3h-3" />
    <path d="M2.5 13v-3h3" />
    <path d="M3.5 7a5 5 0 0 1 8.5-2L13.5 6" />
    <path d="M12.5 9a5 5 0 0 1-8.5 2L2.5 10" />
  </Icon>
);

export const DotIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />
  </Icon>
);

export const SpinnerIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 1.5A6.5 6.5 0 1 1 1.5 8" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M13.5 13.5 10.5 10.5" />
  </Icon>
);

export const TerminalIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M4 6l2 2-2 2" />
    <path d="M8.5 10h3" />
  </Icon>
);

export const LinkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5L8 4.5" />
    <path d="M9 7a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5L8 11.5" />
  </Icon>
);

export const WarningIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7.13 2.4 1.3 12a1 1 0 0 0 .87 1.5h11.66a1 1 0 0 0 .87-1.5L8.87 2.4a1 1 0 0 0-1.74 0Z" />
    <path d="M8 6v3.5" />
    <path d="M8 11.5v.01" />
  </Icon>
);

export const InfoIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7v4" />
    <path d="M8 5v.01" />
  </Icon>
);
