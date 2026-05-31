import type { DbClient } from "@nanites/db/client";
import type { Logger } from "@logtape/logtape";
import type { ResponseHeadersPluginContext } from "@orpc/server/plugins";
import type { SigveloMcpAuthProps } from "#/backend/mcp/auth-context.ts";

/** Request-scoped dependencies shared by every oRPC procedure. */
export interface BaseContext extends ResponseHeadersPluginContext {
  req: Request;
  env: Env;
  db: DbClient;
  requestId: string;
  logger: Logger;
  mcpAuthProps?: SigveloMcpAuthProps;
}
