import { MCP_AUTHORIZE_CONTEXT_ROUTE } from "#/shared/constants.ts";
import { Badge } from "#/frontend/ui/components/Badge.tsx";
import { Button } from "#/frontend/ui/components/Button.tsx";
import { GithubMotionMark } from "#/frontend/ui/components/GithubMotionMark.tsx";
import { NaniteScene } from "#/frontend/ui/components/NaniteScene.tsx";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { McpAuthorizeContext } from "#/backend/api/routes/mcp.ts";
import { ArrowSquareOutIcon, ArrowRightIcon, ShieldCheckIcon } from "@phosphor-icons/react";

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
        title="Log in with GitHub"
        summary={`${context.clientName} wants to connect to Nanites through MCP.`}
      >
        <a
          className="button button--normal button--primary button--lg mcp-authorize__link-button"
          href={context.loginHref}
        >
          <GithubMotionMark size={18} />
          <span>Log in with GitHub</span>
          <ArrowRightIcon size={16} aria-hidden="true" />
        </a>
      </McpAuthorizeShell>
    );
  }

  if (context.status === "no_installations") {
    return (
      <McpAuthorizeShell
        title="Install the Nanites GitHub App"
        summary={`${context.clientName} can connect after Nanites has access to a GitHub account and repositories.`}
      >
        <div className="mcp-authorize__actions">
          <a
            className="button button--normal button--primary button--lg mcp-authorize__link-button"
            href={context.installHref}
            target="_blank"
            rel="noreferrer"
          >
            <GithubMotionMark size={18} />
            <span>Install Nanites on GitHub</span>
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
        title="Choose repositories for Nanites"
        summary={`${context.clientName} can connect after at least one repository is shared with Nanites.`}
      >
        <div className="mcp-authorize__actions">
          <a
            className="button button--outline button--primary button--lg mcp-authorize__link-button"
            href={context.installHref}
            target="_blank"
            rel="noreferrer"
          >
            <GithubMotionMark size={18} />
            <span>Choose repositories</span>
            <ArrowSquareOutIcon size={14} aria-hidden="true" />
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
      <McpAuthorizeShell title="Authorization request failed" summary={context.message}>
        <Button
          color="neutral"
          variant="outline"
          size="lg"
          onClick={() => {
            window.location.href = "/";
          }}
        >
          Return to Nanites
        </Button>
      </McpAuthorizeShell>
    );
  }

  const repositoryCount = context.installation.repositories.length;

  return (
    <McpAuthorizeShell
      title={`Authorize ${context.clientName}`}
      summary={`This MCP client will use this deployment's ${context.installation.account.login} GitHub installation.`}
    >
      <form className="mcp-authorize__form" method="post" action={context.authorizeAction}>
        <input type="hidden" name="csrf_token" value={context.csrfToken} />

        <div className="mcp-authorize__field">
          <span>GitHub installation</span>
          <strong>{context.installation.account.login}</strong>
          <span>
            {repositoryCount} {repositoryCount === 1 ? "repository" : "repositories"}
          </span>
        </div>

        <ul className="mcp-authorize__scopes" aria-label="Requested MCP scopes">
          {context.requestedScopes.map((scope) => (
            <li key={scope}>
              <Badge color="neutral" variant="outline">
                {scope}
              </Badge>
            </li>
          ))}
        </ul>

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
  title,
  summary,
  children,
}: {
  readonly title: string;
  readonly summary: string;
  readonly children: ReactNode;
}) {
  return (
    <main className="mcp-authorize">
      <div className="mcp-authorize__panel">
        <NaniteScene className="mcp-authorize__nanite" mode="solo" variant="working" />

        <div className="mcp-authorize__body">
          <h1 id="mcp-authorize-title">{title}</h1>
          <p className="mcp-authorize__summary">{summary}</p>
        </div>

        <div className="mcp-authorize__content">{children}</div>
      </div>
    </main>
  );
}
