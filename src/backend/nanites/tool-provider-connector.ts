import { CodemodeConnector } from "@cloudflare/codemode";
import type { ConnectorTools, ToolProvider } from "@cloudflare/codemode";

type SimpleProviderTools = Record<
  string,
  {
    description?: string;
    execute: (args?: unknown) => Promise<unknown>;
  }
>;

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
    return Object.fromEntries(
      Object.entries(this.#provider.tools as SimpleProviderTools).map(([name, providerTool]) => [
        name,
        {
          description: providerTool.description,
          execute: (args) => providerTool.execute(args),
        },
      ]),
    );
  }

  protected override instructions(): string | undefined {
    return this.#provider.types;
  }
}
