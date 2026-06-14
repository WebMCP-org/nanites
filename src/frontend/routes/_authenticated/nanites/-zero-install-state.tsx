import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useLocation } from "@tanstack/react-router";
import { buildReturnToPath } from "#/frontend/lib/auth.ts";
import { Card } from "#/frontend/ui/components/Card.tsx";
import { GithubMotionMark } from "#/frontend/ui/components/GithubMotionMark.tsx";
import { NaniteScene } from "#/frontend/ui/components/NaniteScene.tsx";
import { buildGitHubAppInstallHref } from "#/github.ts";

export function NanitesZeroInstallState({
  githubApp,
}: {
  readonly githubApp: { readonly slug: string } | null;
}) {
  const location = useLocation();
  const installHref = buildGitHubAppInstallHref({
    appSlug: githubApp?.slug,
    state: buildReturnToPath(location),
  });

  return (
    <div className="dashboard">
      <Card>
        <div className="dashboard__zero-install">
          <NaniteScene
            className="dashboard__setup-nanite"
            mode="solo"
            title="Nanite preparing GitHub setup"
            variant="working"
          />
          <h1 className="dashboard__heading">Install the Nanites GitHub App</h1>
          <p className="dashboard__subtext">
            You are signed in, but GitHub is not reporting a visible installation for{" "}
            {githubApp?.slug ?? "this deployment app"}. Install the app on the user or organization
            that owns the repositories Nanites should work on.
          </p>
          <div className="dashboard__zero-install-actions">
            <a
              className="button button--primary button--md"
              href={installHref}
              target="_blank"
              rel="noreferrer"
            >
              <GithubMotionMark size={16} />
              <span>Install GitHub App</span>
              <ArrowSquareOutIcon size={14} aria-hidden="true" />
            </a>
          </div>
        </div>
      </Card>
    </div>
  );
}
