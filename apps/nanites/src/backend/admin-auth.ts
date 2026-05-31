import { createRemoteJWKSet, jwtVerify } from "jose";
import { ADMIN_ERROR_CODES } from "@nanites/contracts/admin";

const CF_ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
const CF_ACCESS_AUTHENTICATED_USER_EMAIL_HEADER = "cf-access-authenticated-user-email";
const LOCAL_ADMIN_EMAIL = "local-admin@example.invalid";
const cloudflareJwksByTeamDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getCloudflareAccessTeamDomain(env: Env): string | null {
  return typeof env.CLOUDFLARE_ACCESS_TEAM_DOMAIN === "string" &&
    env.CLOUDFLARE_ACCESS_TEAM_DOMAIN.trim().length > 0
    ? env.CLOUDFLARE_ACCESS_TEAM_DOMAIN.trim()
    : null;
}

function getCloudflareAccessAudience(env: Env): string | null {
  return typeof env.CLOUDFLARE_ACCESS_AUD === "string" &&
    env.CLOUDFLARE_ACCESS_AUD.trim().length > 0
    ? env.CLOUDFLARE_ACCESS_AUD.trim()
    : null;
}

export interface AdminActor {
  email: string;
  sub?: string;
}

export interface VerifiedCloudflareAccessClaims extends AdminActor {}

export type AdminAuthFailureReason = "cloudflare";

export type AdminAccessResult =
  | { ok: true; actor: AdminActor }
  | { ok: false; reason: AdminAuthFailureReason };

export function requiresCloudflareAccessForAdmin(env: Env): boolean {
  return Boolean(getCloudflareAccessTeamDomain(env) && getCloudflareAccessAudience(env));
}

function getAccessAuthenticatedUserEmail(request: Request): string | null {
  const email = request.headers.get(CF_ACCESS_AUTHENTICATED_USER_EMAIL_HEADER);
  if (typeof email !== "string" || email.trim().length === 0) {
    return null;
  }

  return normalizeAdminEmail(email);
}

function getCloudflareAccessJwks(teamDomain: string) {
  const cached = cloudflareJwksByTeamDomain.get(teamDomain);
  if (cached) {
    return cached;
  }

  const jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
  cloudflareJwksByTeamDomain.set(teamDomain, jwks);
  return jwks;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function allowsLocalAdminBypass(request: Request, env: Env): boolean {
  if (env.ALLOW_TEST_AUTH === "true") {
    return true;
  }

  try {
    return isLoopbackHostname(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

export async function verifyCloudflareAccessJwt(
  request: Request,
  env: Env,
): Promise<VerifiedCloudflareAccessClaims | null> {
  const jwt = request.headers.get(CF_ACCESS_JWT_HEADER);
  const teamDomain = getCloudflareAccessTeamDomain(env);
  const audience = getCloudflareAccessAudience(env);
  if (!jwt || !teamDomain || !audience) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(jwt, getCloudflareAccessJwks(teamDomain), {
      audience,
    });

    const jwtEmail =
      typeof payload.email === "string" && payload.email.trim().length > 0
        ? normalizeAdminEmail(payload.email)
        : null;
    const headerEmail = getAccessAuthenticatedUserEmail(request);
    const resolvedEmail = jwtEmail ?? headerEmail;
    if (!resolvedEmail) {
      return null;
    }

    return {
      email: resolvedEmail,
      sub: typeof payload.sub === "string" ? payload.sub : undefined,
    };
  } catch {
    return null;
  }
}

export async function authorizeAdminRequest(
  request: Request,
  env: Env,
): Promise<AdminAccessResult> {
  if (!requiresCloudflareAccessForAdmin(env)) {
    if (!allowsLocalAdminBypass(request, env)) {
      return {
        ok: false,
        reason: "cloudflare",
      };
    }

    return {
      ok: true,
      actor: {
        email: LOCAL_ADMIN_EMAIL,
      },
    };
  }

  const cloudflareAccessClaims = await verifyCloudflareAccessJwt(request, env);
  if (!cloudflareAccessClaims) {
    return {
      ok: false,
      reason: "cloudflare",
    };
  }

  return {
    ok: true,
    actor: cloudflareAccessClaims,
  };
}

export function buildAdminUnauthorizedErrorData() {
  return {
    code: ADMIN_ERROR_CODES.cloudflareAccessRequired,
    message: "Cloudflare Access is required for admin routes.",
  } as const;
}
