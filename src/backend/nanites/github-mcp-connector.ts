import { McpConnector } from "@cloudflare/codemode";
import type { McpConnectionLike } from "@cloudflare/codemode";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const GITHUB_MCP_SERVER_URL = "https://api.githubcopilot.com/mcp/";

export type GitHubMcpConnectorOptions = {
  /**
   * Issues the per-connection request headers: a freshly scoped GitHub App
   * installation token plus the X-MCP tool-filter headers. Called once per
   * connector instance — on the first execute call of the turn, when codemode
   * setup describes every connector (not on the first github.* call).
   */
  createHeaders: () => Promise<Record<string, string>>;
  /** Overridable for tests; defaults to GitHub's hosted MCP server. */
  url?: string;
  /** Overridable for tests; defaults to a real streamable-HTTP MCP client. */
  createConnection?: () => Promise<McpConnectionLike> | McpConnectionLike;
};

/**
 * Exposes the GitHub MCP server inside the codemode sandbox as `github.*`.
 * Tool scope is enforced twice: the scoped installation token limits API
 * authority, and the X-MCP-Tools / X-MCP-Exclude-Tools headers make the
 * server advertise only the tools derived from the Nanite's granted app
 * permissions.
 */
export class GitHubMcpConnector extends McpConnector {
  readonly #options: GitHubMcpConnectorOptions;

  constructor(ctx: DurableObjectState, options: GitHubMcpConnectorOptions) {
    super(ctx, {});
    this.#options = options;
  }

  name(): string {
    return "github";
  }

  protected override async createConnection(): Promise<McpConnectionLike> {
    if (this.#options.createConnection) {
      return this.#options.createConnection();
    }

    // A failure here fails codemode setup — and with it every execute call of
    // the current turn, git.* and state.* included — so make the cause
    // unmistakably GitHub MCP rather than a generic execute error.
    try {
      const headers = await this.#options.createHeaders();
      const client = new Client({ name: "sigvelo-nanite", version: "0.0.0" });
      const transport = new StreamableHTTPClientTransport(
        new URL(this.#options.url ?? GITHUB_MCP_SERVER_URL),
        { requestInit: { headers } },
      );
      await client.connect(transport);
      return {
        name: "github",
        client,
        fetchTools: async () => (await client.listTools()).tools,
      };
    } catch (error) {
      throw new Error(
        `GitHub MCP connection failed; github.* tools (and the execute tool with them) are unavailable this turn: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}
