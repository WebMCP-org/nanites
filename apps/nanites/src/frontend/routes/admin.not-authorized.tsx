import { Button, Card } from "@nanites/ui";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowClockwiseIcon, ArrowLeftIcon } from "@phosphor-icons/react";

export const Route = createFileRoute("/admin/not-authorized")({
  component: AdminNotAuthorizedRoute,
});

function AdminNotAuthorizedRoute() {
  return (
    <div className="app-shell">
      <main className="app-main">
        <div className="app-page app-page--narrow">
          <Card>
            <div className="app-stack">
              <span className="app-page-eyebrow">Admin Access</span>
              <h1 className="app-page-title">Admin access could not be verified.</h1>
              <p className="app-page-description">
                Cloudflare Access did not provide a valid admin identity for this request. Sign in
                again and retry <code>/admin</code>.
              </p>
              <div className="app-action-row">
                <Button color="primary" onClick={() => window.location.assign("/admin")}>
                  <ArrowClockwiseIcon size={16} />
                  <span>Retry admin access</span>
                </Button>
                <Button
                  color="neutral"
                  variant="outline"
                  onClick={() => window.location.assign("/")}
                >
                  <ArrowLeftIcon size={16} />
                  <span>Back to app</span>
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
