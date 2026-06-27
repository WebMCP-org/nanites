/**
 * Safe browser destination after login when the requested return path is absent or rejected.
 */
export const DEFAULT_AUTH_RETURN_TO_PATH = "/nanites";

/**
 * Browser login route for the Nanites dashboard.
 */
export const LOGIN_ROUTE_PATH = "/";

/**
 * Shared prefix for the browser GitHub OAuth endpoints.
 */
export const GITHUB_AUTH_ROUTE_PREFIX = "/auth/github/";

/**
 * Browser route that starts the GitHub OAuth flow.
 */
export const GITHUB_OAUTH_LOGIN_PATH = `${GITHUB_AUTH_ROUTE_PREFIX}login`;

/**
 * Browser route that receives the GitHub OAuth callback.
 */
export const GITHUB_OAUTH_CALLBACK_PATH = `${GITHUB_AUTH_ROUTE_PREFIX}callback`;

/**
 * Query parameter used to preserve a post-auth redirect target.
 */
export const AUTH_RETURN_TO_PARAM = "returnTo";

/**
 * Path scope for browser auth cookies. `/` lets login state cover the dashboard and MCP
 * authorization screens.
 */
export const BROWSER_AUTH_COOKIE_PATH = "/";

/**
 * Auth cookie SameSite policy. `Lax` allows GitHub's top-level redirect back to the app while
 * blocking most cross-site ambient-cookie sends.
 */
export const BROWSER_AUTH_COOKIE_SAME_SITE = "lax";

/**
 * Auth cookies owned by the Nanites browser login flow.
 *
 * The sealed app session is intentionally distinct from the sealed GitHub user token.
 */
export const BROWSER_AUTH_COOKIE_NAMES = {
  session: "nanites_session",
  githubUserToken: "nanites_github_user_token",
  githubOAuthState: "nanites_github_oauth_state",
} as const satisfies Record<string, string>;

/**
 * URL base used only to parse app-relative browser paths with the platform `URL` parser.
 */
export const RELATIVE_URL_BASE = "https://sigvelo.local";

/**
 * GitHub path that starts a fresh app installation.
 */
export const SIGVELO_GITHUB_APP_INSTALL_PATH = "/installations/new";

/**
 * GitHub path that edits permissions for an existing app installation.
 */
export const SIGVELO_GITHUB_APP_PERMISSIONS_PATH = `${SIGVELO_GITHUB_APP_INSTALL_PATH}/permissions`;

/**
 * Worker route that receives GitHub App webhook deliveries.
 */
export const GITHUB_WEBHOOK_PATH = "/api/github/webhook";

/**
 * GitHub stamps app webhook deliveries with the owning app id in this header, which lets one
 * webhook URL serve every registered app.
 */
export const GITHUB_WEBHOOK_TARGET_ID_HEADER = "x-github-hook-installation-target-id";

/**
 * Public MCP endpoint exposed by the Worker.
 */
export const MCP_ROUTE = "/mcp";

/**
 * OAuth authorization endpoint used by MCP clients.
 */
export const MCP_AUTHORIZE_ROUTE = "/authorize";

/**
 * Browser route that renders the human MCP authorization consent screen.
 */
export const MCP_AUTHORIZE_UI_ROUTE = "/mcp-authorize";

/**
 * API route that resolves the pending MCP authorization request for the consent screen.
 */
export const MCP_AUTHORIZE_CONTEXT_ROUTE = "/api/mcp/oauth/authorize-context";

/**
 * OAuth token endpoint used by MCP clients.
 */
export const MCP_TOKEN_ROUTE = "/oauth/token";

/**
 * Dynamic client registration endpoint used by MCP clients.
 */
export const MCP_CLIENT_REGISTRATION_ROUTE = "/oauth/register";

/**
 * Short-lived browser cookie that binds MCP consent form submissions to the current auth request.
 */
export const MCP_CONSENT_COOKIE_NAME = "sigvelo_mcp_consent";

/**
 * Cookie path for MCP consent state. It is limited to the OAuth authorize route instead of the full
 * app because only that route needs to receive it.
 */
export const MCP_CONSENT_COOKIE_PATH = MCP_AUTHORIZE_ROUTE;

/**
 * MCP consent cookie lifetime in seconds. Ten minutes is enough for a human approval flow without
 * leaving stale consent state around for long.
 */
export const MCP_CONSENT_COOKIE_MAX_AGE_SECONDS = 10 * 60;

/**
 * MCP OAuth scopes understood by Nanites tools.
 */
export const MCP_SCOPES = {
  read: "nanites:read",
  write: "nanites:write",
} as const satisfies Record<string, string>;

/**
 * Ordered scope allowlist accepted by the MCP server and tool authorization checks.
 */
export const SUPPORTED_MCP_SCOPES = [MCP_SCOPES.read, MCP_SCOPES.write] as const;

/**
 * Agents SDK class name used by browser clients for the repo-scoped Nanites manager.
 */
export const NANITE_MANAGER_NAME = "sigvelo-nanite-manager";

/**
 * Agents SDK class name used by browser clients for installation manager chat.
 */
export const MANAGER_CONVERSATION_AGENT_NAME = "sigvelo-manager-conversation-agent";

/**
 * Agents SDK class name used by browser clients for stable Nanite chat.
 */
export const NANITE_AGENT_NAME = "sigvelo-nanite-agent";

/**
 * Default model for SigVelo agents. Shared with the browser so the UI can show the same fallback
 * model used by getModel() when conversation state predates the `model` field.
 */
export const DEFAULT_SIGVELO_AGENT_MODEL_ID = "@cf/zai-org/glm-5.2";

/**
 * Canonical manager Durable Object key pattern. A deployment has one active GitHub App, so the
 * GitHub installation id is the runtime manager boundary.
 */
export const NANITE_MANAGER_KEY_PATTERN = /^installation:(\d+)$/;
