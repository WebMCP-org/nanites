import { CodemodeConnector } from "@cloudflare/codemode";
import type { ConnectorTools, ToolProvider } from "@cloudflare/codemode";

type ConnectorJsonSchema = NonNullable<ConnectorTools[string]["inputSchema"]>;

type SimpleProviderTools = Record<
  string,
  {
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    parameters?: unknown;
    execute: (args?: unknown) => Promise<unknown>;
  }
>;

function readJsonSchema(schema: unknown): ConnectorJsonSchema | undefined {
  if (
    schema &&
    typeof schema === "object" &&
    ("type" in schema || "properties" in schema || "$ref" in schema)
  ) {
    return schema as ConnectorJsonSchema;
  }
  return undefined;
}

export class ToolProviderConnector extends CodemodeConnector {
  readonly #provider: ToolProvider;

  constructor(ctx: DurableObjectState, provider: ToolProvider) {
    super(ctx, {});
    this.#provider = provider;
  }

  // fallow-ignore-next-line unused-class-member
  name(): string {
    return this.#provider.name ?? "codemode";
  }

  protected tools(): ConnectorTools {
    return Object.fromEntries(
      Object.entries(this.#provider.tools as SimpleProviderTools).map(([name, providerTool]) => [
        name,
        {
          description: providerTool.description,
          inputSchema: readJsonSchema(providerTool.inputSchema ?? providerTool.parameters),
          outputSchema: readJsonSchema(providerTool.outputSchema),
          execute: (args) => providerTool.execute(args),
        },
      ]),
    );
  }

  protected override instructions(): string | undefined {
    return this.#provider.types;
  }
}
