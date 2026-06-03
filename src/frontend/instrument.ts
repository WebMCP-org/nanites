import * as Sentry from "@sentry/react";
import { parseSamplingRate } from "#/shared/observability/sampling.ts";
import { router } from "#/frontend/router.ts";

const DEFAULT_DEV_TRACES_SAMPLE_RATE = 1;
const DEFAULT_PROD_TRACES_SAMPLE_RATE = 0.1;
const DEFAULT_REPLAY_SESSION_SAMPLE_RATE = 0.1;
const DEFAULT_REPLAY_ON_ERROR_SAMPLE_RATE = 1;

function getTracePropagationTargets(): Array<string | RegExp> {
  if (typeof window === "undefined") {
    return [];
  }

  return [window.location.origin];
}

const dsn = import.meta.env.VITE_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    integrations: [
      Sentry.tanstackRouterBrowserTracingIntegration(router),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    tracesSampleRate: parseSamplingRate(
      import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
      import.meta.env.DEV ? DEFAULT_DEV_TRACES_SAMPLE_RATE : DEFAULT_PROD_TRACES_SAMPLE_RATE,
    ),
    tracePropagationTargets: getTracePropagationTargets(),
    replaysSessionSampleRate: parseSamplingRate(
      import.meta.env.VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE,
      DEFAULT_REPLAY_SESSION_SAMPLE_RATE,
    ),
    replaysOnErrorSampleRate: parseSamplingRate(
      import.meta.env.VITE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE,
      DEFAULT_REPLAY_ON_ERROR_SAMPLE_RATE,
    ),
  });
}
