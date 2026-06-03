import { parse, serialize, type SerializeOptions } from "cookie";
import { EncryptJWT, jwtDecrypt, errors as joseErrors, type JWTPayload } from "jose";
import { z } from "zod";
import type { GitHubUserToken } from "#/backend/github.ts";
import {
  BROWSER_AUTH_COOKIE_NAMES,
  BROWSER_AUTH_COOKIE_PATH,
  BROWSER_AUTH_COOKIE_PURPOSES,
  BROWSER_AUTH_COOKIE_SAME_SITE,
  buildBrowserSessionExpiration,
  NANITES_BROWSER_AUTH_HKDF_HASH,
  NANITES_BROWSER_AUTH_HKDF_SALT,
  NANITES_BROWSER_AUTH_JWE_ALG,
  NANITES_BROWSER_AUTH_JWE_ENC,
  NANITES_BROWSER_AUTH_JWE_ISSUER,
} from "#/backend/browser-auth/policy.ts";

const isoDateTimeSchema = z.string();
const githubIdSchema = z.number().int().positive();
const githubLoginSchema = z.string().min(1);

export type BrowserAuthenticatedActor = {
  id: number;
  login: string;
} & Record<string, unknown>;

export type SessionInstallationAccountSnapshot = {
  id: number;
  login: string;
  type: string;
  avatar_url: string | null;
};

export type SessionInstallationSnapshot = {
  id: number;
  account: SessionInstallationAccountSnapshot;
};

// Cookie boundary check: preserve GitHub's authenticated user object, but require the fields the app reads.
export const authenticatedActorSchema: z.ZodType<BrowserAuthenticatedActor> = z
  .object({
    id: githubIdSchema,
    login: githubLoginSchema,
  })
  .passthrough();
const sessionInstallationAccountSchema: z.ZodType<SessionInstallationAccountSnapshot> = z.object({
  id: githubIdSchema,
  login: githubLoginSchema,
  type: z.string().min(1),
  avatar_url: z.string().nullable(),
});

export const sessionInstallationSnapshotSchema: z.ZodType<SessionInstallationSnapshot> = z.object({
  id: githubIdSchema,
  account: sessionInstallationAccountSchema,
});
export const nanitesSessionSchema = z.object({
  githubViewer: authenticatedActorSchema,
  activeGithubInstallationId: githubIdSchema.nullable(),
  sessionInstallationSnapshot: sessionInstallationSnapshotSchema.nullable().optional(),
  expiresAt: isoDateTimeSchema,
});
const browserNanitesContextSchema = z.object({
  actor: authenticatedActorSchema,
  activeInstallation: sessionInstallationSnapshotSchema.nullable(),
  expiresAt: isoDateTimeSchema,
});
export const githubUserTokenSchema: z.ZodType<GitHubUserToken> = z.object({
  accessToken: z.string().min(1),
  expiresAt: isoDateTimeSchema.nullable(),
  refreshToken: z.string().min(1).nullable(),
  refreshTokenExpiresAt: isoDateTimeSchema.nullable(),
});
export const githubOAuthStateSchema = z.object({
  state: z.string().min(1),
  codeVerifier: z.string().min(43).max(128),
  returnToPath: z.string().min(1),
  expiresAt: isoDateTimeSchema,
});

export type BrowserNanitesContext = z.infer<typeof browserNanitesContextSchema>;
export type NanitesSession = z.infer<typeof nanitesSessionSchema>;
export type GitHubOAuthState = z.infer<typeof githubOAuthStateSchema>;

const textEncoder = new TextEncoder();

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function buildCookieOptions(
  request: Request,
  expiresAt: string,
  overrides?: Partial<SerializeOptions>,
): SerializeOptions {
  return {
    path: BROWSER_AUTH_COOKIE_PATH,
    httpOnly: true,
    sameSite: BROWSER_AUTH_COOKIE_SAME_SITE,
    secure: isSecureRequest(request),
    expires: new Date(expiresAt),
    ...overrides,
  };
}

function buildExpiredCookieOptions(request: Request): SerializeOptions {
  return {
    path: BROWSER_AUTH_COOKIE_PATH,
    httpOnly: true,
    sameSite: BROWSER_AUTH_COOKIE_SAME_SITE,
    secure: isSecureRequest(request),
    expires: new Date(0),
    maxAge: 0,
  };
}

/**
 * Derives a stable 256-bit JWE secret from the Worker string secret and a purpose label.
 *
 * `AUTH_COOKIE_SECRET` is configured as a Wrangler string secret, not as a pre-generated JWK.
 * HKDF keeps the actual content-encryption key purpose-scoped while still letting the app use one
 * operator-managed Worker secret.
 */
async function deriveCookieEncryptionKey(secret: string, purpose: string): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    "HKDF",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: NANITES_BROWSER_AUTH_HKDF_HASH,
      salt: textEncoder.encode(NANITES_BROWSER_AUTH_HKDF_SALT),
      info: textEncoder.encode(purpose),
    },
    keyMaterial,
    256,
  );

  return new Uint8Array(derivedBits);
}

type CookiePayloadSchema = z.ZodType<JWTPayload>;

async function sealCookieValue<TSchema extends CookiePayloadSchema>(
  schema: TSchema,
  value: z.input<TSchema>,
  env: Env,
  purpose: string,
  expiresAt: string,
): Promise<string> {
  const parsedValue = schema.parse(value);
  const key = await deriveCookieEncryptionKey(env.AUTH_COOKIE_SECRET, purpose);

  return new EncryptJWT(parsedValue)
    .setProtectedHeader({
      alg: NANITES_BROWSER_AUTH_JWE_ALG,
      enc: NANITES_BROWSER_AUTH_JWE_ENC,
      typ: purpose,
    })
    .setIssuer(NANITES_BROWSER_AUTH_JWE_ISSUER)
    .setIssuedAt()
    .setExpirationTime(new Date(expiresAt))
    .encrypt(key);
}

async function readSealedCookieValue<TSchema extends CookiePayloadSchema>(
  schema: TSchema,
  sealedValue: string,
  env: Env,
  purpose: string,
): Promise<z.output<TSchema> | null> {
  const key = await deriveCookieEncryptionKey(env.AUTH_COOKIE_SECRET, purpose);

  try {
    const { payload } = await jwtDecrypt<z.output<TSchema>>(sealedValue, key, {
      typ: purpose,
      issuer: NANITES_BROWSER_AUTH_JWE_ISSUER,
      keyManagementAlgorithms: [NANITES_BROWSER_AUTH_JWE_ALG],
      contentEncryptionAlgorithms: [NANITES_BROWSER_AUTH_JWE_ENC],
    });

    return schema.parse(payload);
  } catch (error) {
    if (error instanceof joseErrors.JOSEError || error instanceof z.ZodError) {
      return null;
    }

    throw error;
  }
}

async function readOptionalCookie<TSchema extends CookiePayloadSchema>(
  request: Request,
  env: Env,
  cookieName: string,
  schema: TSchema,
  purpose: string,
): Promise<z.output<TSchema> | null> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  const sealedValue = parse(cookieHeader)[cookieName];
  if (!sealedValue) {
    return null;
  }

  return readSealedCookieValue(schema, sealedValue, env, purpose);
}

export async function sealSessionCookie(
  session: NanitesSession,
  request: Request,
  env: Env,
): Promise<string> {
  return serialize(
    BROWSER_AUTH_COOKIE_NAMES.session,
    await sealCookieValue(
      nanitesSessionSchema,
      session,
      env,
      BROWSER_AUTH_COOKIE_PURPOSES.session,
      session.expiresAt,
    ),
    buildCookieOptions(request, session.expiresAt),
  );
}

export async function readSessionCookie(
  request: Request,
  env: Env,
): Promise<NanitesSession | null> {
  return readOptionalCookie(
    request,
    env,
    BROWSER_AUTH_COOKIE_NAMES.session,
    nanitesSessionSchema,
    BROWSER_AUTH_COOKIE_PURPOSES.session,
  );
}

export function clearSessionCookie(request: Request): string {
  return serialize(BROWSER_AUTH_COOKIE_NAMES.session, "", buildExpiredCookieOptions(request));
}

export async function sealGitHubUserTokenCookie(
  githubUserToken: GitHubUserToken,
  request: Request,
  env: Env,
): Promise<string> {
  const cookieExpiresAt =
    githubUserToken.refreshTokenExpiresAt ??
    githubUserToken.expiresAt ??
    buildBrowserSessionExpiration();
  return serialize(
    BROWSER_AUTH_COOKIE_NAMES.githubUserToken,
    await sealCookieValue(
      githubUserTokenSchema,
      githubUserToken,
      env,
      BROWSER_AUTH_COOKIE_PURPOSES.githubUserToken,
      cookieExpiresAt,
    ),
    buildCookieOptions(request, cookieExpiresAt),
  );
}

export async function readGitHubUserTokenCookie(
  request: Request,
  env: Env,
): Promise<GitHubUserToken | null> {
  return readOptionalCookie(
    request,
    env,
    BROWSER_AUTH_COOKIE_NAMES.githubUserToken,
    githubUserTokenSchema,
    BROWSER_AUTH_COOKIE_PURPOSES.githubUserToken,
  );
}

export function clearGitHubUserTokenCookie(request: Request): string {
  return serialize(
    BROWSER_AUTH_COOKIE_NAMES.githubUserToken,
    "",
    buildExpiredCookieOptions(request),
  );
}

export async function sealGitHubOAuthStateCookie(
  githubOAuthState: GitHubOAuthState,
  request: Request,
  env: Env,
): Promise<string> {
  return serialize(
    BROWSER_AUTH_COOKIE_NAMES.githubOAuthState,
    await sealCookieValue(
      githubOAuthStateSchema,
      githubOAuthState,
      env,
      BROWSER_AUTH_COOKIE_PURPOSES.githubOAuthState,
      githubOAuthState.expiresAt,
    ),
    buildCookieOptions(request, githubOAuthState.expiresAt),
  );
}

export async function readGitHubOAuthStateCookie(
  request: Request,
  env: Env,
): Promise<GitHubOAuthState | null> {
  return readOptionalCookie(
    request,
    env,
    BROWSER_AUTH_COOKIE_NAMES.githubOAuthState,
    githubOAuthStateSchema,
    BROWSER_AUTH_COOKIE_PURPOSES.githubOAuthState,
  );
}

export function clearGitHubOAuthStateCookie(request: Request): string {
  return serialize(
    BROWSER_AUTH_COOKIE_NAMES.githubOAuthState,
    "",
    buildExpiredCookieOptions(request),
  );
}
