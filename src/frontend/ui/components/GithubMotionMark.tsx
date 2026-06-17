import { GithubLogoIcon } from "@phosphor-icons/react";
import { cx } from "./_internal/class-names.js";

export function GithubMotionMark({
  className,
  size = 18,
}: {
  readonly className?: string;
  readonly size?: number;
}) {
  const classes = cx("github-motion-mark", className);

  return (
    <span className={classes} aria-hidden="true">
      <GithubLogoIcon size={size} weight="fill" />
    </span>
  );
}
