import { createDbClient } from "#/backend/db/index.ts";
import { recordVisibleInstallationSnapshots } from "#/backend/db/facts.ts";
import { AppError } from "#/backend/errors.ts";
import { isGitHubAuthenticationFailure, listVisibleInstallations } from "#/backend/github/index.ts";
import { requireDeploymentGitHubApp } from "#/backend/github/apps.ts";
import { buildNaniteManagerKey, type NaniteManagerKey } from "#/shared/utils/nanites.ts";
import {
  appendExpiredAuthCookies,
  clearRevokedSessionSelectionIfNeeded,
  readSessionInstallationSnapshots,
  requireGitHubUserToken,
  requireSession,
  type SessionInstallationSnapshot,
} from "#/backend/auth/session.ts";
import type { GitHubUserToken } from "#/backend/github/index.ts";

export type BrowserInstallationScope = {
  readonly githubAppId: number;
  readonly githubInstallationId: number;
  readonly account: SessionInstallationSnapshot["account"];
  readonly githubUserToken: GitHubUserToken;
  readonly managerName: NaniteManagerKey;
};

type RequireBrowserInstallationScopeInput = {
  readonly githubInstallationId: number | null;
  readonly responseHeaders?: Headers | undefined;
};

export async function listBrowserVisibleInstallationSnapshots(
  request: Request,
  env: Env,
  options?: {
    readonly responseHeaders?: Headers | undefined;
  },
): Promise<{
  readonly session: Awaited<ReturnType<typeof requireSession>>;
  readonly githubUserToken: Awaited<ReturnType<typeof requireGitHubUserToken>>;
  readonly installations: SessionInstallationSnapshot[];
}> {
  const session = await requireSession(request, env);
  const githubUserToken = await requireGitHubUserToken(request, env, {
    responseHeaders: options?.responseHeaders,
  });
  const db = createDbClient(env.DB);
  const deploymentGitHubApp = await requireDeploymentGitHubApp(db, env);

  try {
    const installations = readSessionInstallationSnapshots(
      await listVisibleInstallations(githubUserToken.accessToken),
      deploymentGitHubApp.appId,
    );
    await recordVisibleInstallationSnapshots(db, installations);
    await clearRevokedSessionSelectionIfNeeded({
      req: request,
      env,
      session,
      resHeaders: options?.responseHeaders,
      sessionInstallationSnapshots: installations,
    });

    return { session, githubUserToken, installations };
  } catch (error) {
    if (isGitHubAuthenticationFailure(error)) {
      appendExpiredAuthCookies(request, options?.responseHeaders);
      throw new AppError("authenticationRequired", { cause: error });
    }

    throw error;
  }
}

export async function requireBrowserInstallationScope(
  request: Request,
  env: Env,
  input: RequireBrowserInstallationScopeInput,
): Promise<BrowserInstallationScope> {
  if (input.githubInstallationId === null) {
    throw new AppError("activeInstallationRequired");
  }

  const { githubUserToken, installations } = await listBrowserVisibleInstallationSnapshots(
    request,
    env,
    {
      responseHeaders: input.responseHeaders,
    },
  );
  const installation =
    installations.find((candidate) => candidate.id === input.githubInstallationId) ?? null;

  if (!installation) {
    throw new AppError("installationAccessRevoked", {
      details: { githubInstallationId: input.githubInstallationId },
    });
  }

  return {
    githubAppId: installation.githubAppId,
    githubInstallationId: installation.id,
    account: installation.account,
    githubUserToken,
    managerName: buildNaniteManagerKey({
      githubAppId: installation.githubAppId,
      githubInstallationId: installation.id,
    }),
  };
}
