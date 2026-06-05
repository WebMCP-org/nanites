import { Button } from "#/frontend/ui/components/Button.tsx";
import { GithubMotionMark } from "#/frontend/ui/components/GithubMotionMark.tsx";
import { NaniteScene } from "#/frontend/ui/components/NaniteScene.tsx";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { loadSession } from "#/frontend/lib/auth.ts";
import {
  AUTH_RETURN_TO_PARAM,
  GITHUB_OAUTH_LOGIN_PATH,
  normalizeAuthenticatedReturnToPath,
  readRequestedReturnTo,
  resolveAuthReturnTo,
} from "#/auth.ts";

export const Route = createFileRoute("/")({
  loader: async ({ context, location }) => {
    const session = await loadSession(context, { force: true });
    if (session) {
      throw redirect({ href: resolveAuthReturnTo(location.href) });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const returnTo = readRequestedReturnTo(new URLSearchParams(window.location.search));

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
        <p>Small durable agents for GitHub repository maintenance.</p>
      </div>
      <Button
        color="primary"
        size="lg"
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
