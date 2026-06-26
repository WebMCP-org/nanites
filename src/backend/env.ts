import { z, type ZodIssue } from "zod";

const requiredEnvStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "must not be empty")
  .refine((value) => !value.trim().startsWith("replace-with-"), "must not be a placeholder value");

const optionalEnvStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "must not be empty")
  .refine((value) => !value.trim().startsWith("replace-with-"), "must not be a placeholder value")
  .optional()
  .or(z.literal(""));

const githubAppIdSchema = requiredEnvStringSchema.refine((value) => {
  const appId = Number(value);
  return Number.isInteger(appId) && appId > 0;
}, "must be a positive integer");

type NanitesValidatedEnv = Pick<
  Env,
  | "AUTH_COOKIE_SECRET"
  | "CLOUDFLARE_ACCOUNT_ID"
  | "CLOUDFLARE_API_TOKEN"
  | "GITHUB_APP_ID"
  | "GITHUB_APP_SLUG"
  | "GITHUB_APP_CLIENT_ID"
  | "GITHUB_APP_PRIVATE_KEY"
  | "GITHUB_APP_CLIENT_SECRET"
  | "GITHUB_APP_WEBHOOK_SECRET"
> &
  Partial<
    Pick<
      Env,
      "ALLOW_TEST_AUTH" | "NANITES_LLM_BASE_URL" | "NANITES_LLM_FIXTURE" | "GITHUB_TEST_USER_TOKEN"
    >
  >;

export const nanitesEnvSchema: z.ZodType<NanitesValidatedEnv> = z
  .object({
    AUTH_COOKIE_SECRET: requiredEnvStringSchema,
    CLOUDFLARE_ACCOUNT_ID: requiredEnvStringSchema,
    CLOUDFLARE_API_TOKEN: requiredEnvStringSchema,
    GITHUB_APP_ID: githubAppIdSchema,
    GITHUB_APP_SLUG: requiredEnvStringSchema,
    GITHUB_APP_CLIENT_ID: requiredEnvStringSchema,
    GITHUB_APP_PRIVATE_KEY: requiredEnvStringSchema,
    GITHUB_APP_CLIENT_SECRET: requiredEnvStringSchema,
    GITHUB_APP_WEBHOOK_SECRET: requiredEnvStringSchema,

    ALLOW_TEST_AUTH: optionalEnvStringSchema,
    NANITES_LLM_BASE_URL: optionalEnvStringSchema,
    NANITES_LLM_FIXTURE: optionalEnvStringSchema,
    GITHUB_TEST_USER_TOKEN: optionalEnvStringSchema,
  })
  .passthrough();

export function requireNanitesEnv(env: Env): Env {
  nanitesEnvSchema.parse(env);
  return env;
}

export function summarizeNanitesEnvIssues(issues: readonly ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`).join("; ");
}
