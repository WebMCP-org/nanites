import { Button } from "#/frontend/ui/components/Button.tsx";
import { GithubMotionMark } from "#/frontend/ui/components/GithubMotionMark.tsx";
import { NaniteScene } from "#/frontend/ui/components/NaniteScene.tsx";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { loadSession } from "#/frontend/lib/auth.ts";
import { httpClient } from "#/frontend/lib/http-client.ts";
import { parseResponse } from "hono/client";
import {
  AUTH_RETURN_TO_PARAM,
  GITHUB_OAUTH_LOGIN_PATH,
  normalizeAuthenticatedReturnToPath,
  readRequestedReturnTo,
  resolveAuthReturnTo,
} from "#/auth.ts";

export const Route = createFileRoute("/")({
  loader: async ({ context, location }) => {
    const setupStatus = await parseResponse(httpClient.api.setup.status.$get());
    if (setupStatus.showSetup && !setupStatus.setupComplete && location.pathname !== "/app") {
      throw redirect({ to: "/setup" });
    }

    const session = await loadSession(context, { force: true });
    if (session) {
      throw redirect({ href: resolveAuthReturnTo(location.href) });
    }

    return { setupStatus };
  },
  component: LoginPage,
});

function LoginPage() {
  const { setupStatus } = Route.useLoaderData();
  const returnTo = readRequestedReturnTo(new URLSearchParams(window.location.search));
  const setupHiddenAndUnconfigured = !setupStatus.showSetup && !setupStatus.runtimeConfigReadable;

  return (
    <main className="login-screen">
      <NaniteScene
        className="login-screen__nanite"
        mode="solo"
        title="Nanite putting on a work helmet"
        variant="helmet"
      />
      <div className="login-screen__copy">
        <h1>Nanites</h1>
        <p>
          {setupHiddenAndUnconfigured
            ? "Local setup is hidden. Configure local GitHub App metadata and secrets, or set NANITES_SHOW_SETUP=true."
            : "Small durable agents for GitHub repository maintenance."}
        </p>
      </div>
      <Button
        color="primary"
        size="lg"
        disabled={setupHiddenAndUnconfigured}
        onClick={() => {
          const loginUrl = new URL(GITHUB_OAUTH_LOGIN_PATH, window.location.href);
          loginUrl.searchParams.set(
            AUTH_RETURN_TO_PARAM,
            normalizeAuthenticatedReturnToPath(returnTo),
          );
          window.location.href = loginUrl.toString();
        }}
      >
        <GithubMotionMark size={18} />
        <span>Sign in with GitHub</span>
      </Button>
    </main>
  );
}
