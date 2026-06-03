import { type ReactNode, useEffect } from "react";
import * as Sentry from "@sentry/react";
import { useQueryClient, useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Link, Navigate, type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { Badge } from "#/frontend/ui/components/Badge.tsx";
import { Button } from "#/frontend/ui/components/Button.tsx";
import { Card } from "#/frontend/ui/components/Card.tsx";
import { ArrowClockwiseIcon, ArrowUUpLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";
import {
  DEFAULT_AUTH_RETURN_TO,
  getInstallationAuthErrorDetails,
  invalidateAuthQueries,
  isAuthenticationRequiredError,
  type InstallationAuthErrorDetails,
  resolveAuthReturnTo,
} from "#/frontend/routes/-auth-client.ts";

interface StateAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly icon?: ReactNode;
  readonly variant?: "normal" | "outline" | "ghost";
}

interface PageStateCardProps {
  readonly badge: string;
  readonly badgeColor?: "neutral" | "primary" | "warning" | "destructive";
  readonly title: string;
  readonly description: string;
  readonly actions?: readonly StateAction[];
}

export function RoutePendingPage() {
  return (
    <PageStateCard
      badge="Loading"
      badgeColor="primary"
      title="Loading route."
      description="SigVelo is preparing the next screen and syncing the required data."
    />
  );
}

export function RouteNotFoundPage() {
  return (
    <div className="not-found">
      <div className="not-found__inner">
        <span className="not-found__wordmark">Sigvelo</span>
        <div className="not-found__content">
          <span className="not-found__eyebrow">404</span>
          <h1 className="not-found__heading">
            There aren't any nanites here to work on your frontend.
          </h1>
          <p className="not-found__body">
            The route you followed doesn't exist. It may have moved, been renamed, or never shipped.
            Head back to Nanites to pick up where you left off.
          </p>
        </div>
        <div className="not-found__actions">
          <Link to="/nanites" className="not-found__cta">
            <span>Back to Nanites</span>
            <ArrowRightIcon size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}

export function RouteErrorBoundary(props: ErrorComponentProps) {
  if (isAuthenticationRequiredError(props.error)) {
    return <AuthRedirectBoundary />;
  }

  const installationError = getInstallationAuthErrorDetails(props.error);
  if (installationError) {
    return <InstallationRouteErrorPage installationError={installationError} {...props} />;
  }

  return <GenericRouteErrorPage {...props} />;
}

function AuthRedirectBoundary() {
  const returnTo =
    typeof window === "undefined"
      ? DEFAULT_AUTH_RETURN_TO
      : resolveAuthReturnTo(window.location.href);

  return <Navigate to="/" search={{ returnTo }} replace />;
}

function GenericRouteErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const queryErrorResetBoundary = useQueryErrorResetBoundary();
  const isDashboardLocation = router.state.location.pathname !== "/";

  useResetQueryBoundary(queryErrorResetBoundary);

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const message = error instanceof Error ? error.message : "Unknown error.";

  return (
    <PageStateCard
      badge="Dashboard Error"
      badgeColor="destructive"
      title="Something failed to load."
      description={message}
      actions={[
        {
          label: "Try again",
          onClick: () => {
            queryErrorResetBoundary.reset();
            reset();
            void router.invalidate();
          },
          icon: <ArrowClockwiseIcon size={14} />,
        },
        isDashboardLocation
          ? {
              label: "Back to Nanites",
              onClick: () => {
                queryErrorResetBoundary.reset();
                reset();
                void router.navigate({ to: "/nanites" });
              },
              icon: <ArrowUUpLeftIcon size={14} />,
              variant: "outline",
            }
          : {
              label: "Go home",
              onClick: () => {
                queryErrorResetBoundary.reset();
                reset();
                void router.navigate({ to: "/" });
              },
              icon: <ArrowUUpLeftIcon size={14} />,
              variant: "outline",
            },
      ]}
    />
  );
}

function InstallationRouteErrorPage({
  installationError,
  reset,
}: ErrorComponentProps & {
  readonly installationError: InstallationAuthErrorDetails;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const queryErrorResetBoundary = useQueryErrorResetBoundary();

  useResetQueryBoundary(queryErrorResetBoundary);

  const title =
    installationError.code === "active_installation_required"
      ? "Choose an installation to continue."
      : "This installation is no longer available.";
  const description =
    installationError.code === "active_installation_required"
      ? "SigVelo needs an active installation before loading Nanites. Pick one to continue."
      : "GitHub access for this installation changed, so SigVelo can no longer use it. Pick another installation or reinstall the SigVelo GitHub App.";

  return (
    <PageStateCard
      badge="Installation required"
      badgeColor="warning"
      title={title}
      description={description}
      actions={[
        {
          label: "Reload installations",
          onClick: () => {
            queryErrorResetBoundary.reset();
            reset();
            void invalidateAuthQueries(queryClient).then(() => router.navigate({ to: "/nanites" }));
          },
          icon: <ArrowClockwiseIcon size={14} />,
        },
        {
          label: "Back to Nanites",
          onClick: () => {
            queryErrorResetBoundary.reset();
            reset();
            void router.navigate({ to: "/nanites" });
          },
          icon: <ArrowUUpLeftIcon size={14} />,
          variant: "outline",
        },
      ]}
    />
  );
}

function PageStateCard({
  badge,
  badgeColor = "neutral",
  title,
  description,
  actions = [],
}: PageStateCardProps) {
  return (
    <div className="app-shell">
      <main className="app-main">
        <div className="app-stack">
          <Card>
            <div className="app-stack">
              <Badge color={badgeColor} variant="outline">
                {badge}
              </Badge>
              <div className="app-page-header">
                <h1 className="app-page-title">{title}</h1>
                <p className="app-page-description">{description}</p>
              </div>
              {actions.length > 0 ? (
                <div className="app-action-row">
                  {actions.map((action) => (
                    <Button
                      key={action.label}
                      color={action.variant === "normal" ? "primary" : "neutral"}
                      size="sm"
                      variant={action.variant ?? "normal"}
                      onClick={action.onClick}
                    >
                      {action.icon}
                      <span>{action.label}</span>
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}

function useResetQueryBoundary(
  queryErrorResetBoundary: ReturnType<typeof useQueryErrorResetBoundary>,
) {
  useEffect(() => {
    queryErrorResetBoundary.reset();
  }, [queryErrorResetBoundary]);
}
