export type AgentConnectionTarget = "codex" | "claude-code" | "skill" | "mcp-json";

export type AgentConnectionCommand = {
  readonly target: AgentConnectionTarget;
  readonly label: string;
  readonly description: string;
  readonly language: "bash" | "json";
  readonly code: string;
};

const NANITES_MCP_NAME = "nanites";
const NANITES_PLUGIN_MARKETPLACE = "WebMCP-org/nanites";
const CLAUDE_CODE_PLUGIN_REF = "nanites@nanites";

export function buildNanitesMcpUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/mcp`;
}

export function buildAgentConnectionCommands(origin: string): readonly AgentConnectionCommand[] {
  const mcpUrl = buildNanitesMcpUrl(origin);

  return [
    {
      target: "codex",
      label: "Codex",
      description: "Install the Nanites plugin marketplace, then connect this deployment over MCP.",
      language: "bash",
      code: [
        `NANITES_MCP_URL="${mcpUrl}"`,
        "",
        `codex plugin marketplace add ${NANITES_PLUGIN_MARKETPLACE}`,
        `codex mcp add ${NANITES_MCP_NAME} --url "$NANITES_MCP_URL"`,
        `codex mcp login ${NANITES_MCP_NAME}`,
      ].join("\n"),
    },
    {
      target: "claude-code",
      label: "Claude Code",
      description: "Install the Nanites plugin and add this deployment as the Nanites MCP server.",
      language: "bash",
      code: [
        `NANITES_MCP_URL="${mcpUrl}"`,
        "",
        `claude plugin marketplace add ${NANITES_PLUGIN_MARKETPLACE}`,
        `claude plugin install ${CLAUDE_CODE_PLUGIN_REF}`,
        `claude mcp add --transport http --scope user ${NANITES_MCP_NAME} "$NANITES_MCP_URL"`,
      ].join("\n"),
    },
    {
      target: "skill",
      label: "Skill Only",
      description: "Install the Nanites skill without installing a plugin.",
      language: "bash",
      code: [
        `npx --yes skills add ${NANITES_PLUGIN_MARKETPLACE} \\`,
        `  --skill nanites \\`,
        `  --global \\`,
        `  --copy \\`,
        `  --agent codex claude-code \\`,
        `  -y`,
      ].join("\n"),
    },
    {
      target: "mcp-json",
      label: "MCP JSON",
      description: "Use this with clients that accept direct MCP server JSON.",
      language: "json",
      code: JSON.stringify(
        {
          mcpServers: {
            [NANITES_MCP_NAME]: {
              type: "http",
              url: mcpUrl,
            },
          },
        },
        null,
        2,
      ),
    },
  ];
}
