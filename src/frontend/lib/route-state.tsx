import { DEFAULT_AUTH_RETURN_TO_PATH } from "#/shared/constants.ts";
import { type ReactNode, useEffect } from "react";
import * as Sentry from "@sentry/react";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Link, Navigate, type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { Button } from "#/frontend/ui/components/Button.tsx";
import { Card } from "#/frontend/ui/components/Card.tsx";
import { NaniteScene, type NaniteSceneVariant } from "#/frontend/ui/components/NaniteScene.tsx";
import { ArrowClockwiseIcon, ArrowUUpLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";
import { isAuthenticationRequiredError, readApiErrorMessage } from "#/frontend/lib/auth.ts";
import { resolveAuthReturnTo } from "#/shared/utils/auth.ts";

interface StateAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly icon?: ReactNode;
  readonly variant?: "normal" | "outline" | "ghost";
}

interface PageStateCardProps {
  readonly title: string;
  readonly description: string;
  readonly actions?: readonly StateAction[];
  readonly sceneVariant?: NaniteSceneVariant;
}

export function RoutePendingPage({
  title,
  description,
}: {
  readonly title?: string;
  readonly description?: string;
} = {}) {
  const loadingText = title?.trim() || description?.trim() || null;

  // ponytail: card-less, centered loader shared by routes and the chat Suspense fallback.
  return (
    <div className="page-loading">
      <NaniteScene className="page-loading__nanite" mode="solo" variant="working" />
      {loadingText ? (
        <div className="page-loading__copy">
          <p className="app-page-description">{loadingText}</p>
        </div>
      ) : (
        <span className="visually-hidden">Loading</span>
      )}
    </div>
  );
}

export function RouteNotFoundPage() {
  return (
    <div className="not-found">
      <div className="not-found__inner">
        <NaniteScene className="not-found__nanite" mode="solo" variant="concerned" />
        <div className="not-found__content">
          <span className="not-found__eyebrow">404</span>
          <h1 className="not-found__heading">There aren't any nanites here.</h1>
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

  return <GenericRouteErrorPage {...props} />;
}

function AuthRedirectBoundary() {
  const returnTo =
    typeof window === "undefined"
      ? DEFAULT_AUTH_RETURN_TO_PATH
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

  const message =
    readApiErrorMessage(error) ?? (error instanceof Error ? error.message : "Unknown error.");

  return (
    <PageStateCard
      sceneVariant="concerned"
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

function PageStateCard({
  title,
  description,
  actions = [],
  sceneVariant = "idle",
}: PageStateCardProps) {
  return (
    <div className="app-shell">
      <main className="app-main">
        <div className="app-stack">
          <Card className="page-state-card">
            <div className="app-stack">
              <NaniteScene className="page-state-card__nanite" mode="solo" variant={sceneVariant} />
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
