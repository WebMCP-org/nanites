/**
 * Hand-maintained additions to the generated Env in env.d.ts.
 *
 * GITHUB_TEST_USER_TOKEN is a test-only secret consumed when ALLOW_TEST_AUTH
 * is enabled. It must never be required for production deploys, so it cannot
 * be listed in wrangler.jsonc `secrets.required` (which is what generates the
 * secret entries in env.d.ts).
 */
interface Env {
  GITHUB_TEST_USER_TOKEN?: string;
}
