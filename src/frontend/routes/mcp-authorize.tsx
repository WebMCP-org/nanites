import { Badge } from "#/frontend/ui/components/Badge.tsx";
import { Button } from "#/frontend/ui/components/Button.tsx";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { McpAuthorizeContext } from "#/backend/mcp/oauth.ts";
import {
  ArrowSquareOutIcon,
  ArrowRightIcon,
  BuildingsIcon,
  GithubLogoIcon,
  PlugsConnectedIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { MCP_AUTHORIZE_CONTEXT_ROUTE } from "#/shared/constants/mcp.ts";

export const Route = createFileRoute("/mcp-authorize")({
  loader: async ({ location }) => {
    const locationUrl = new URL(location.href, "http://sigvelo.local");
    const response = await fetch(`${MCP_AUTHORIZE_CONTEXT_ROUTE}${locationUrl.search}`, {
      credentials: "include",
      headers: {
        accept: "application/json",
      },
    });
    const payload = (await response.json()) as McpAuthorizeContext;

    if (!response.ok && payload.status !== "invalid") {
      throw new Error("Unable to load MCP authorization context.");
    }

    return payload;
  },
  component: McpAuthorizePage,
});

function McpAuthorizePage() {
  const context = Route.useLoaderData();

  if (context.status === "login") {
    return (
      <McpAuthorizeShell
        icon={<GithubLogoIcon size={22} weight="fill" aria-hidden="true" />}
        title="Log in with GitHub"
        summary={`${context.clientName} wants to connect to Sigvelo through MCP.`}
      >
        <p className="mcp-authorize__copy">
          GitHub confirms your identity and installation access. Sigvelo issues the MCP token, and
          the MCP client does not receive your GitHub token.
        </p>
        <a
          className="button button--normal button--primary button--lg mcp-authorize__link-button"
          href={context.loginHref}
        >
          <GithubLogoIcon size={18} weight="fill" aria-hidden="true" />
          <span>Log in with GitHub</span>
          <ArrowRightIcon size={16} aria-hidden="true" />
        </a>
      </McpAuthorizeShell>
    );
  }

  if (context.status === "no_installations") {
    return (
      <McpAuthorizeShell
        icon={<BuildingsIcon size={22} aria-hidden="true" />}
        title="Install the Sigvelo GitHub App"
        summary={`${context.clientName} can connect after Sigvelo has access to a GitHub account and repositories.`}
      >
        <p className="mcp-authorize__copy">
          You are signed in with GitHub, but GitHub is not reporting a Sigvelo installation for any
          account you can access.
        </p>
        <ol className="mcp-authorize__setup-list" aria-label="GitHub App setup steps">
          <li>Install Sigvelo on the user or organization that owns the repository.</li>
          <li>Choose all repositories or select the repositories Nanites may maintain.</li>
          <li>Return here and refresh to continue authorizing the MCP client.</li>
        </ol>
        <div className="mcp-authorize__actions">
          <a
            className="button button--normal button--primary button--lg mcp-authorize__link-button"
            href={context.installHref}
            target="_blank"
            rel="noreferrer"
          >
            <GithubLogoIcon size={18} weight="fill" aria-hidden="true" />
            <span>Install Sigvelo on GitHub</span>
          </a>
          <Button
            color="neutral"
            variant="outline"
            size="lg"
            onClick={() => {
              window.location.reload();
            }}
          >
            Refresh
          </Button>
        </div>
      </McpAuthorizeShell>
    );
  }

  if (context.status === "no_repositories") {
    return (
      <McpAuthorizeShell
        icon={<BuildingsIcon size={22} aria-hidden="true" />}
        title="Choose repositories for Sigvelo"
        summary={`${context.clientName} can connect after at least one repository is shared with Sigvelo.`}
      >
        <p className="mcp-authorize__copy">
          GitHub says Sigvelo is installed, but none of the installations visible to you currently
          expose repositories Nanites can work on.
        </p>
        <ol className="mcp-authorize__setup-list" aria-label="Repository access setup steps">
          <li>Open repository access for the GitHub account you want this MCP client to use.</li>
          <li>Choose all repositories or select the repositories Nanites may maintain.</li>
          <li>Return here and refresh to continue authorizing the MCP client.</li>
        </ol>
        <ul className="mcp-authorize__installation-list" aria-label="GitHub installations">
          {context.installations.map((option) => (
            <li key={option.installation.id}>
              <a
                className="mcp-authorize__installation-link"
                href={option.manageAccessHref}
                target="_blank"
                rel="noreferrer"
              >
                <span className="mcp-authorize__installation-copy">
                  <span className="mcp-authorize__installation-login">
                    {option.installation.account.login}
                  </span>
                  <span className="mcp-authorize__installation-meta">
                    {option.installation.account.type} - no repositories shared
                  </span>
                </span>
                <span className="mcp-authorize__installation-action">
                  Choose repositories
                  <ArrowSquareOutIcon size={14} aria-hidden="true" />
                </span>
              </a>
            </li>
          ))}
        </ul>
        <div className="mcp-authorize__actions">
          <a
            className="button button--outline button--primary button--lg mcp-authorize__link-button"
            href={context.installHref}
            target="_blank"
            rel="noreferrer"
          >
            <GithubLogoIcon size={18} weight="fill" aria-hidden="true" />
            <span>Install on another account</span>
          </a>
          <Button
            color="neutral"
            variant="outline"
            size="lg"
            onClick={() => {
              window.location.reload();
            }}
          >
            Refresh
          </Button>
        </div>
      </McpAuthorizeShell>
    );
  }

  if (context.status === "invalid") {
    return (
      <McpAuthorizeShell
        icon={<WarningCircleIcon size={22} aria-hidden="true" />}
        title="Authorization request failed"
        summary={context.message}
      >
        <Button
          color="neutral"
          variant="outline"
          size="lg"
          onClick={() => {
            window.location.href = "/";
          }}
        >
          Return to Sigvelo
        </Button>
      </McpAuthorizeShell>
    );
  }

  const selectedInstallationId = context.installations.some(
    (option) => option.installation.id === context.activeGithubInstallationId,
  )
    ? context.activeGithubInstallationId
    : (context.installations[0]?.installation.id ?? "");

  return (
    <McpAuthorizeShell
      icon={<PlugsConnectedIcon size={22} aria-hidden="true" />}
      title={`Authorize ${context.clientName}`}
      summary="Choose the GitHub installation this MCP client may use with Sigvelo."
    >
      <form className="mcp-authorize__form" method="post" action={context.authorizeAction}>
        <input type="hidden" name="csrf_token" value={context.csrfToken} />

        <label className="mcp-authorize__field">
          <span>GitHub installation</span>
          <select
            className="mcp-authorize__select"
            name="github_installation_id"
            defaultValue={String(selectedInstallationId)}
            required
          >
            {context.installations.map((option) => (
              <option key={option.installation.id} value={option.installation.id}>
                {option.installation.account.login} ({option.repositoryCount}{" "}
                {option.repositoryCount === 1 ? "repository" : "repositories"})
              </option>
            ))}
          </select>
        </label>

        <ul className="mcp-authorize__scopes" aria-label="Requested MCP scopes">
          {context.requestedScopes.map((scope) => (
            <li key={scope}>
              <Badge color="neutral" variant="outline">
                {scope}
              </Badge>
            </li>
          ))}
        </ul>

        <p className="mcp-authorize__copy">
          The MCP token is bound to the selected installation. GitHub tokens stay in Sigvelo.
        </p>

        <div className="mcp-authorize__actions">
          <Button type="submit" color="primary" size="lg" name="intent" value="authorize">
            <ShieldCheckIcon size={18} aria-hidden="true" />
            <span>Authorize MCP client</span>
          </Button>
          <Button
            type="submit"
            color="neutral"
            variant="outline"
            size="lg"
            name="intent"
            value="deny"
          >
            Cancel
          </Button>
        </div>
      </form>
    </McpAuthorizeShell>
  );
}

function McpAuthorizeShell({
  icon,
  title,
  summary,
  children,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly summary: string;
  readonly children: ReactNode;
}) {
  return (
    <main className="mcp-authorize">
      <section className="mcp-authorize__panel" aria-labelledby="mcp-authorize-title">
        <div className="mcp-authorize__brand">
          <span className="mcp-authorize__mark" aria-hidden="true">
            {icon}
          </span>
          <span className="mcp-authorize__wordmark">Sigvelo MCP</span>
        </div>

        <div className="mcp-authorize__body">
          <h1 id="mcp-authorize-title">{title}</h1>
          <p className="mcp-authorize__summary">{summary}</p>
        </div>

        <div className="mcp-authorize__content">{children}</div>
      </section>
    </main>
  );
}
