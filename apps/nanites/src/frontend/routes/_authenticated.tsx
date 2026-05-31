import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute, useLocation } from "@tanstack/react-router";
import { Avatar, Badge, Popover } from "@nanites/ui";
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckCircleIcon,
  GithubLogoIcon,
  PlusIcon,
  SignOutIcon,
} from "@phosphor-icons/react";
import {
  buildReturnToPath,
  invalidateAuthQueries,
  requireSession,
} from "#/frontend/features/auth/auth-client.ts";
import {
  buildGitHubAppInstallOnAnotherOwnerHref,
  buildGitHubAppManageAccessHref,
  SIGVELO_GITHUB_APP_URL,
} from "#/shared/github-app.ts";
import { useORPC } from "#/frontend/lib/orpc.tsx";
import { API_DOCS_PATH } from "#/shared/constants/openapi-document.ts";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context, location }) => {
    await requireSession(context, buildReturnToPath(location));
  },
  component: AuthenticatedLayout,
});

/**
 * GitHub avatar URLs accept a `?s=N` query param to request a pixel-sized variant served from the
 * CDN. Appending one keeps the menu payload light without losing crispness on retina displays.
 */
function withAvatarSize(avatarUrl: string | null, size: number): string | undefined {
  if (!avatarUrl) {
    return undefined;
  }

  try {
    const url = new URL(avatarUrl);
    url.searchParams.set("s", String(size));
    return url.toString();
  } catch {
    return avatarUrl;
  }
}

function AccountMenu({ returnToPath }: { readonly returnToPath: string }) {
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const orpc = useORPC();
  const sessionQuery = useQuery({
    ...orpc.auth.session.getOptional.queryOptions(),
    throwOnError: true,
  });
  const installationsQuery = useQuery({
    ...orpc.auth.installations.listVisible.queryOptions(),
    enabled: false,
    throwOnError: true,
  });

  const changeInstallation = useMutation(
    orpc.auth.installations.setActive.mutationOptions({
      onSuccess: async (_data, variables) => {
        await invalidateAuthQueries(queryClient, orpc.auth.key());
        const installation = installationsQuery.data?.installations.find(
          (candidate) => candidate.id === variables.githubInstallationId,
        );
        await navigate({
          to: "/nanites",
          search: installation
            ? {
                account: installation.account.login,
                installationId: installation.id,
              }
            : {},
        });
      },
    }),
  );

  const logout = useMutation(
    orpc.auth.session.logout.mutationOptions({
      onSuccess: async () => {
        await invalidateAuthQueries(queryClient, orpc.auth.key());
        await navigate({
          to: "/",
          search: {
            returnTo: "/nanites",
          },
          replace: true,
        });
      },
    }),
  );

  if (sessionQuery.isPending) {
    return (
      <button type="button" className="account-menu__trigger" disabled>
        <Avatar.Root className="account-menu__trigger-avatar">
          <Avatar.Fallback>--</Avatar.Fallback>
        </Avatar.Root>
        <span className="account-menu__trigger-label">Loading account</span>
        <CaretDownIcon size={14} aria-hidden="true" />
      </button>
    );
  }

  const session = sessionQuery.data;
  const activeInstallation = session?.activeInstallation ?? null;
  const installations = installationsQuery.data?.installations ?? [];
  const otherInstallations = installations.filter(
    (installation) => installation.id !== activeInstallation?.id,
  );

  const installHref = buildGitHubAppInstallOnAnotherOwnerHref(returnToPath);
  const manageAccessHref = activeInstallation
    ? buildGitHubAppManageAccessHref({
        state: returnToPath,
        suggestedTargetId: activeInstallation.account.id,
      })
    : null;

  const triggerLabel = activeInstallation?.account.login ?? "No account";
  const triggerInitials = activeInstallation
    ? activeInstallation.account.login.slice(0, 2).toUpperCase()
    : "—";
  const triggerAvatarSrc = withAvatarSize(activeInstallation?.account.avatar_url ?? null, 40);
  const headerAvatarSrc = withAvatarSize(activeInstallation?.account.avatar_url ?? null, 64);

  return (
    <Popover.Root>
      <Popover.Trigger
        className="account-menu__trigger"
        onClick={() => {
          if (!installationsQuery.isFetching) {
            void installationsQuery.refetch();
          }
        }}
      >
        <Avatar.Root className="account-menu__trigger-avatar">
          {triggerAvatarSrc ? <Avatar.Image src={triggerAvatarSrc} alt="" /> : null}
          <Avatar.Fallback>{triggerInitials}</Avatar.Fallback>
        </Avatar.Root>
        <span className="account-menu__trigger-label">{triggerLabel}</span>
        <CaretDownIcon size={14} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end">
          <Popover.Popup className="account-menu__popup">
            {activeInstallation ? (
              <div className="account-menu__header">
                <Avatar.Root className="account-menu__header-avatar">
                  {headerAvatarSrc ? <Avatar.Image src={headerAvatarSrc} alt="" /> : null}
                  <Avatar.Fallback>
                    {activeInstallation.account.login.slice(0, 2).toUpperCase()}
                  </Avatar.Fallback>
                </Avatar.Root>
                <div className="account-menu__header-info">
                  <span className="account-menu__header-login">
                    {activeInstallation.account.login}
                  </span>
                  <span className="account-menu__header-type">
                    {activeInstallation.account.type}
                  </span>
                </div>
                <Badge color="primary" variant="outline">
                  <CheckCircleIcon size={12} weight="fill" aria-hidden="true" />
                  <span>Active</span>
                </Badge>
              </div>
            ) : (
              <div className="account-menu__empty">
                <span className="account-menu__empty-title">No accounts connected</span>
                <span className="account-menu__empty-body">
                  Install the SigVelo GitHub App on a user or an organization to let nanites work on
                  repositories.
                </span>
              </div>
            )}

            <div className="account-menu__divider" />

            <div className="account-menu__section-label">Accounts</div>
            {installationsQuery.isFetching && installations.length === 0 ? (
              <div className="account-menu__empty">
                <span className="account-menu__empty-title">Loading accounts</span>
              </div>
            ) : null}
            {otherInstallations.length > 0 ? (
              <ul className="account-menu__list">
                {otherInstallations.map((installation) => {
                  const rowAvatarSrc = withAvatarSize(installation.account.avatar_url, 56);
                  return (
                    <li key={installation.id}>
                      <button
                        type="button"
                        className="account-menu__account-row"
                        disabled={changeInstallation.isPending}
                        onClick={() =>
                          changeInstallation.mutate({
                            githubInstallationId: installation.id,
                          })
                        }
                      >
                        <Avatar.Root className="account-menu__row-avatar">
                          {rowAvatarSrc ? <Avatar.Image src={rowAvatarSrc} alt="" /> : null}
                          <Avatar.Fallback>
                            {installation.account.login.slice(0, 2).toUpperCase()}
                          </Avatar.Fallback>
                        </Avatar.Root>
                        <div className="account-menu__row-info">
                          <span className="account-menu__row-login">
                            {installation.account.login}
                          </span>
                          <span className="account-menu__row-type">
                            {installation.account.type}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {installationsQuery.isSuccess && otherInstallations.length === 0 ? (
              <div className="account-menu__empty">
                <span className="account-menu__empty-title">No other accounts</span>
              </div>
            ) : null}

            <div className="account-menu__divider" />

            <a className="account-menu__action" href={installHref} target="_blank" rel="noreferrer">
              <PlusIcon size={14} aria-hidden="true" />
              <span>
                {installations.length === 0
                  ? "Install SigVelo on GitHub"
                  : "Install on another account"}
              </span>
              <ArrowSquareOutIcon size={14} aria-hidden="true" />
            </a>
            {manageAccessHref ? (
              <a
                className="account-menu__action"
                href={manageAccessHref}
                target="_blank"
                rel="noreferrer"
              >
                <GithubLogoIcon size={14} aria-hidden="true" />
                <span>Manage account access</span>
                <ArrowSquareOutIcon size={14} aria-hidden="true" />
              </a>
            ) : null}
            <a
              className="account-menu__action"
              href={SIGVELO_GITHUB_APP_URL}
              target="_blank"
              rel="noreferrer"
            >
              <GithubLogoIcon size={14} aria-hidden="true" />
              <span>View SigVelo on GitHub Marketplace</span>
              <ArrowSquareOutIcon size={14} aria-hidden="true" />
            </a>

            <div className="account-menu__divider" />

            <button
              type="button"
              className="account-menu__action"
              disabled={logout.isPending}
              onClick={() => logout.mutate({})}
            >
              <SignOutIcon size={14} aria-hidden="true" />
              <span>{logout.isPending ? "Signing out..." : "Sign out"}</span>
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AuthenticatedLayout() {
  const location = useLocation();
  const returnToPath = buildReturnToPath(location);

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-topbar__inner">
          <div className="app-topbar__left">
            <Link to="/nanites" className="app-topbar__wordmark">
              SigVelo
            </Link>
          </div>
          <div className="app-topbar__right">
            <a className="app-topbar__link" href={API_DOCS_PATH} target="_blank" rel="noreferrer">
              Public API reference
            </a>
            <AccountMenu returnToPath={returnToPath} />
          </div>
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
