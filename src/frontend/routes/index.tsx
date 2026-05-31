import { Button } from "@nanites/ui";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { GithubLogoIcon } from "@phosphor-icons/react";
import {
  buildLoginHref,
  loadSession,
  readRequestedReturnToFromWindow,
  resolveAuthReturnTo,
} from "#/frontend/routes/-auth-client.ts";

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
  const returnTo = readRequestedReturnToFromWindow();

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
              window.location.href = buildLoginHref(returnTo);
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
