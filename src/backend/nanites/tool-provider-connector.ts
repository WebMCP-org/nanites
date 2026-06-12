import { CodemodeConnector } from "@cloudflare/codemode";
import type { ConnectorTools, ToolProvider } from "@cloudflare/codemode";

/**
 * Adapts a plain ToolProvider ({ name, tools, types }) to the class-based
 * CodemodeConnector surface that @cloudflare/think 0.9 execute tools consume.
 * Supports simple tool records (description + execute) — the shape of the
 * SigVelo git and artifact providers.
 */
export class ToolProviderConnector extends CodemodeConnector {
  readonly #provider: ToolProvider;

  constructor(ctx: DurableObjectState, provider: ToolProvider) {
    super(ctx, {});
    this.#provider = provider;
  }

  name(): string {
    return this.#provider.name ?? "codemode";
  }

  protected tools(): ConnectorTools {
    return this.#provider.tools as ConnectorTools;
  }

  override async getTypeScriptTypes(): Promise<string> {
    return this.#provider.types ?? super.getTypeScriptTypes();
  }
}
