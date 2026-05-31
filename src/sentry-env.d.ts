/// <reference types="vite/client" />

export {};

declare global {
  namespace Cloudflare {
    interface Env {
      SENTRY_DSN?: string;
    }
  }

  interface Env {
    SENTRY_DSN?: string;
  }

  interface ImportMetaEnv {
    readonly VITE_SENTRY_DSN?: string;
    readonly VITE_SENTRY_ENVIRONMENT?: string;
    readonly VITE_SENTRY_RELEASE?: string;
    readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
    readonly VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE?: string;
    readonly VITE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
