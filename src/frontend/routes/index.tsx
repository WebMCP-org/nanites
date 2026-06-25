import { GITHUB_OAUTH_LOGIN_PATH, AUTH_RETURN_TO_PARAM } from "#/shared/constants.ts";
import { Button } from "#/frontend/ui/components/Button.tsx";
import { GithubMotionMark } from "#/frontend/ui/components/GithubMotionMark.tsx";
import { NaniteScene } from "#/frontend/ui/components/NaniteScene.tsx";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { loadSession } from "#/frontend/lib/auth.ts";
import { httpClient } from "#/frontend/lib/http-client.ts";
import { isLocalSetupOrigin } from "#/frontend/lib/setup-origin.ts";
import { parseResponse } from "hono/client";
import { WrenchIcon } from "@phosphor-icons/react";
import {
  normalizeAuthenticatedReturnToPath,
  readRequestedReturnTo,
  resolveAuthReturnTo,
} from "#/shared/utils/auth.ts";

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
  const setupHiddenAndIncomplete = !setupStatus.showSetup && !setupStatus.setupComplete;
  const localSetupAvailable = setupHiddenAndIncomplete && isLocalSetupOrigin();
  const loginDisabled = !setupStatus.runtimeConfigReadable;

  return (
    <main className="login-screen">
      <NaniteScene className="login-screen__nanite" mode="solo" variant="helmet" />
      <div className="login-screen__copy">
        <h1>Nanites</h1>
        <p>
          {setupHiddenAndIncomplete
            ? localSetupAvailable
              ? "Finish local setup to create or restore the dev GitHub App, then sign in."
              : "Setup is not complete. Ask an operator to enable setup or configure this deployment."
            : "Small durable agents for GitHub repository maintenance."}
        </p>
      </div>
      <div className="login-screen__actions">
        <Button
          color="primary"
          size="lg"
          disabled={loginDisabled}
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
        {localSetupAvailable ? (
          <a className="button button--outline button--neutral button--lg" href="/setup/local">
            <WrenchIcon size={18} aria-hidden="true" />
            <span>Open local setup</span>
          </a>
        ) : null}
      </div>
    </main>
  );
}
