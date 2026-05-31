import { sealSessionCookie } from "#/backend/browser-auth/cookies.ts";
import {
  ActiveInstallationRequiredError,
  clearActiveInstallationSelection,
  resolveSessionInstallation,
} from "#/backend/browser-auth/session.ts";
import type { ActiveInstallation, NanitesSession } from "@nanites/contracts/auth";
import type { GitHubInstallationId } from "@nanites/contracts/ids";
type ActiveInstallations = readonly ActiveInstallation[];

type RevalidationArgs = {
  req: Request;
  env: Env;
  session: NanitesSession;
  resHeaders: Headers | undefined;
  activeInstallations: ActiveInstallations;
};

export type ActiveInstallationRevalidationResult =
  | {
      status: "active";
      nextSession: NanitesSession;
      activeInstallation: ActiveInstallation;
    }
  | {
      status: "revoked";
      nextSession: NanitesSession;
      githubInstallationId: GitHubInstallationId;
    };

async function clearRevokedActiveInstallation({
  req,
  env,
  session,
  resHeaders,
}: Omit<RevalidationArgs, "activeInstallations"> & {
  githubInstallationId: GitHubInstallationId;
}): Promise<NanitesSession> {
  const nextSession = clearActiveInstallationSelection(session);
  resHeaders?.append("Set-Cookie", await sealSessionCookie(nextSession, req, env));
  return nextSession;
}

export async function clearRevokedSessionSelectionIfNeeded({
  session,
  ...args
}: RevalidationArgs): Promise<void> {
  const resolution = resolveSessionInstallation(session, args.activeInstallations);
  if (resolution.status !== "revoked") {
    return;
  }

  await clearRevokedActiveInstallation({
    ...args,
    session,
    githubInstallationId: resolution.githubInstallationId,
  });
}

export async function revalidateSelectedActiveInstallation({
  req,
  env,
  session,
  resHeaders,
  activeInstallations,
}: RevalidationArgs): Promise<ActiveInstallationRevalidationResult> {
  const resolution = resolveSessionInstallation(session, activeInstallations);
  if (resolution.status === "unselected") {
    throw new ActiveInstallationRequiredError();
  }

  if (resolution.status === "active") {
    return {
      status: "active",
      nextSession: session,
      activeInstallation: resolution.activeInstallation,
    };
  }

  return {
    status: "revoked",
    nextSession: await clearRevokedActiveInstallation({
      req,
      env,
      session,
      resHeaders,
      githubInstallationId: resolution.githubInstallationId,
    }),
    githubInstallationId: resolution.githubInstallationId,
  };
}
