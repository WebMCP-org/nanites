import * as Sentry from "@sentry/react";
import { router } from "#/frontend/lib/router.ts";

const DEFAULT_DEV_TRACES_SAMPLE_RATE = 1;
const DEFAULT_PROD_TRACES_SAMPLE_RATE = 0.1;
const DEFAULT_REPLAY_SESSION_SAMPLE_RATE = 0.1;
const DEFAULT_REPLAY_ON_ERROR_SAMPLE_RATE = 1;
const SAMPLING_RATE_MIN = 0;
const SAMPLING_RATE_MAX = 1;

function parseSamplingRate(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < SAMPLING_RATE_MIN || parsed > SAMPLING_RATE_MAX) {
    return fallback;
  }

  return parsed;
}

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
