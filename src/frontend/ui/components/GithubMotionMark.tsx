import { GithubLogoIcon } from "@phosphor-icons/react";

export function GithubMotionMark({
  className,
  size = 18,
}: {
  readonly className?: string;
  readonly size?: number;
}) {
  const classes = ["github-motion-mark", className].filter(Boolean).join(" ");

  return (
    <span className={classes} aria-hidden="true">
      <GithubLogoIcon size={size} weight="fill" />
    </span>
  );
}
