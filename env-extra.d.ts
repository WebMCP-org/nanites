/**
 * Hand-maintained additions to the generated Env in env.d.ts.
 *
 * These are intentionally omitted from the public self-host Wrangler template
 * so Deploy to Cloudflare does not ask for values the app can default.
 */
interface Env {
  ALLOW_TEST_AUTH?: string;
  NANITES_CLOUDFLARE_SCRIPT_NAME?: string;
  NANITES_LLM_BASE_URL?: string;
  NANITES_LLM_FIXTURE?: string;
  NANITES_SHOW_SETUP?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
  GITHUB_TEST_USER_TOKEN?: string;
}
