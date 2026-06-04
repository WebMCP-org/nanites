import { Button } from "#/frontend/ui/components/Button.tsx";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { GithubLogoIcon } from "@phosphor-icons/react";
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
    <div className="login-split">
      <div className="login-panel">
        <div className="login-panel__inner">
          <span className="login-panel__wordmark">Sigvelo</span>
        </div>
      </div>
      <div className="login-form">
        <div className="login-form__inner">
          <div className="login-form__header">
            <h2 className="login-form__title">Sign in</h2>
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
            <GithubLogoIcon size={18} />
            <span>Sign in with GitHub</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
