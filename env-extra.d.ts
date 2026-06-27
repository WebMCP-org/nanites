/**
 * Hand-maintained additions to the generated Env in env.d.ts.
 *
 * Required runtime bindings belong in .env.example so Wrangler generates them
 * into env.d.ts. This file is only for optional local/test knobs.
 */
interface NanitesExtraEnv {
  ALLOW_TEST_AUTH?: string;
  NANITES_LLM_BASE_URL?: string;
  NANITES_LLM_FIXTURE?: string;
  GITHUB_TEST_USER_TOKEN?: string;
}

declare namespace Cloudflare {
  interface Env extends NanitesExtraEnv {}
}

interface Env extends NanitesExtraEnv {}
