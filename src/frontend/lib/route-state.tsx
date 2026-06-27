import { DEFAULT_AUTH_RETURN_TO_PATH } from "#/shared/constants.ts";
import { useEffect } from "react";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { Link, Navigate, type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { Button } from "#/frontend/ui/components/Button.tsx";
import { Card } from "#/frontend/ui/components/Card.tsx";
import { NaniteScene } from "#/frontend/ui/components/NaniteScene.tsx";
import { ArrowClockwiseIcon, ArrowUUpLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";
import { isAuthenticationRequiredError, readApiProblem } from "#/frontend/lib/api-errors.ts";
import { resolveAuthReturnTo } from "#/shared/utils/auth.ts";

interface PageStateMetadataItem {
  readonly label: string;
  readonly value: string;
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
  const problem = readApiProblem(error);
  const message =
    problem?.detail ??
    problem?.title ??
    (error instanceof Error ? error.message : "Unknown error.");
  const details = problem?.details ? Object.entries(problem.details) : [];
  const metadata: readonly PageStateMetadataItem[] = problem
    ? [
        ...details.map(([label, value]) => ({
          label: label.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase()),
          value: formatMetadataValue(value),
        })),
        { label: "Status", value: String(problem.status) },
        { label: "Code", value: problem.code },
        { label: "Request ID", value: problem.requestId },
      ]
    : [];

  useEffect(() => {
    queryErrorResetBoundary.reset();
  }, [queryErrorResetBoundary]);

  const actions = [
    {
      label: "Try again",
      onClick: () => {
        queryErrorResetBoundary.reset();
        reset();
        void router.invalidate();
      },
      icon: <ArrowClockwiseIcon size={14} />,
      variant: "normal" as const,
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
          variant: "outline" as const,
        }
      : {
          label: "Go home",
          onClick: () => {
            queryErrorResetBoundary.reset();
            reset();
            void router.navigate({ to: "/" });
          },
          icon: <ArrowUUpLeftIcon size={14} />,
          variant: "outline" as const,
        },
  ];

  return (
    <div className="app-shell">
      <main className="app-main">
        <div className="app-stack">
          <Card className="page-state-card">
            <div className="app-stack">
              <NaniteScene className="page-state-card__nanite" mode="solo" variant="concerned" />
              <div className="app-page-header">
                <h1 className="app-page-title">{problem?.title ?? "Something failed to load."}</h1>
                <p className="app-page-description">{message}</p>
              </div>
              {metadata.length > 0 ? (
                <dl className="page-state-card__metadata">
                  {metadata.map((item) => (
                    <div className="page-state-card__metadata-item" key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
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
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}

function formatMetadataValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(formatMetadataValue).join(", ");
  }

  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value) ?? String(value);
}
