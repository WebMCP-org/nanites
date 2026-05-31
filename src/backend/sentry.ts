import * as Sentry from "@sentry/cloudflare";
import { parseSamplingRate } from "@nanites/observability/sampling";

const DEFAULT_LOCAL_TRACES_SAMPLE_RATE = 1;
const DEFAULT_REMOTE_TRACES_SAMPLE_RATE = 0.1;

export function createServerSentryOptions(env: Env) {
  const isLocalLikeEnvironment =
    env.SENTRY_ENVIRONMENT === "local" || env.SENTRY_ENVIRONMENT === "development";

  return {
    dsn: env.SENTRY_DSN ?? "",
    enabled: Boolean(env.SENTRY_DSN),
    environment: env.SENTRY_ENVIRONMENT,
    tracesSampleRate: parseSamplingRate(
      env.SENTRY_TRACES_SAMPLE_RATE,
      isLocalLikeEnvironment ? DEFAULT_LOCAL_TRACES_SAMPLE_RATE : DEFAULT_REMOTE_TRACES_SAMPLE_RATE,
    ),
    integrations: [Sentry.vercelAIIntegration()],
  };
}

export function createAISdkTelemetry(
  env: Env,
  functionId: string,
): { isEnabled: true; functionId: string } | undefined {
  if (!env.SENTRY_DSN) {
    return undefined;
  }

  return {
    isEnabled: true,
    functionId,
  };
}
