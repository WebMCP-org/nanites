import * as Sentry from "@sentry/react";
import { router } from "#/frontend/lib/router.ts";

const DEFAULT_DEV_TRACES_SAMPLE_RATE = 1;
const DEFAULT_PROD_TRACES_SAMPLE_RATE = 0.1;
const DEFAULT_REPLAY_SESSION_SAMPLE_RATE = 0.1;
const DEFAULT_REPLAY_ON_ERROR_SAMPLE_RATE = 1;
const SAMPLING_RATE_MIN = 0;
const SAMPLING_RATE_MAX = 1;

type ClientSentryConfig = {
  dsn: string;
  environment: string | undefined;
  tracesSampleRate: string | undefined;
};

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

function initSentry(config: ClientSentryConfig): void {
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    integrations: [
      Sentry.tanstackRouterBrowserTracingIntegration(router),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    tracesSampleRate: parseSamplingRate(
      config.tracesSampleRate,
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

/**
 * The deployed worker serves instance-specific Sentry settings at runtime so
 * the same built bundle works for every self-hosted deployment: setting the
 * SENTRY_DSN worker secret enables browser Sentry with no rebuild.
 */
async function initSentryFromRuntimeConfig(): Promise<void> {
  try {
    const response = await fetch("/api/client-config");
    if (!response.ok) {
      return;
    }

    const config: { sentry?: Partial<Record<keyof ClientSentryConfig, string | null>> } =
      await response.json();
    if (!config.sentry?.dsn) {
      return;
    }

    initSentry({
      dsn: config.sentry.dsn,
      environment: config.sentry.environment ?? undefined,
      tracesSampleRate: config.sentry.tracesSampleRate ?? undefined,
    });
  } catch {
    // Sentry is optional observability; never block or break the app over it.
  }
}

const buildTimeDsn = import.meta.env.VITE_SENTRY_DSN;

if (buildTimeDsn) {
  initSentry({
    dsn: buildTimeDsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
    tracesSampleRate: import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
  });
} else if (typeof window !== "undefined") {
  void initSentryFromRuntimeConfig();
}
