import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIGenerator, type OpenAPIGeneratorGenerateOptions } from "@orpc/openapi";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { RPCHandler } from "@orpc/server/fetch";
import { onError } from "@orpc/server";
import { ResponseHeadersPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { LOG_EVENTS } from "@nanites/observability/log-events";
import { OTEL_ATTRS } from "@nanites/observability/otel-attrs";
import type { BaseContext } from "#/backend/orpc/context.ts";
import { getErrorMessage, getErrorType } from "#/backend/orpc/error-format.ts";
import type { AppRouter } from "#/backend/orpc/router.ts";
import type { AdminRouter } from "#/backend/orpc/routers/admin.ts";
import {
  buildAdminOpenAPIGenerateOptions,
  buildPublicOpenAPIGenerateOptions,
} from "#/backend/orpc/openapi-contract.ts";
import {
  ADMIN_API_DOCS_PATH,
  ADMIN_API_PREFIX,
  ADMIN_API_SPEC_PATH,
  API_DOCS_PATH,
  API_PREFIX,
  API_SPEC_PATH,
} from "#/shared/constants/openapi-document.ts";

const schemaConverters = [new ZodToJsonSchemaConverter()];
const openApiGenerator = new OpenAPIGenerator({ schemaConverters });
const OPENAPI_INFO = {
  title: "Nanites API",
  version: "0.1.0",
  description: "GitHub-native maintenance layer for AI-accelerated codebases.",
} as const;
const ADMIN_OPENAPI_INFO = {
  title: "Nanites Admin API",
  version: "0.1.0",
  description: "Internal admin telemetry, account, and usage APIs for SigVelo operators.",
} as const;
const OPENAPI_SPEC_GENERATE_OPTIONS = buildPublicOpenAPIGenerateOptions(OPENAPI_INFO);
const ADMIN_OPENAPI_SPEC_GENERATE_OPTIONS = buildAdminOpenAPIGenerateOptions(ADMIN_OPENAPI_INFO);

let cachedOpenAPIDocument: Awaited<ReturnType<OpenAPIGenerator["generate"]>> | null = null;
let cachedAdminOpenAPIDocument: Awaited<ReturnType<OpenAPIGenerator["generate"]>> | null = null;

function toOpenAPIHandlerPath(path: string, prefix: string): `/${string}` {
  return path.slice(prefix.length) as `/${string}`;
}

function buildOpenAPIHandler(
  router: AppRouter | AdminRouter,
  {
    docsPath,
    docsTitle,
    specGenerateOptions,
    specPath,
  }: {
    docsPath: `/${string}`;
    docsTitle: string;
    specGenerateOptions: OpenAPIGeneratorGenerateOptions;
    specPath: `/${string}`;
  },
) {
  return new OpenAPIHandler(router, {
    interceptors: [
      onError((error, options) => {
        options.context.logger.error(LOG_EVENTS.API_REQUEST_FAILED, {
          [OTEL_ATTRS.HTTP_REQUEST_METHOD]: options.request.method,
          [OTEL_ATTRS.URL_PATH]: new URL(options.request.url).pathname,
          [OTEL_ATTRS.REQUEST_ID]: options.context.requestId,
          [OTEL_ATTRS.ERROR_TYPE]: getErrorType(error),
          [OTEL_ATTRS.EXCEPTION_MESSAGE]: getErrorMessage(error),
          error,
        });
      }),
    ],
    plugins: [
      new SmartCoercionPlugin({ schemaConverters }),
      new ResponseHeadersPlugin(),
      new OpenAPIReferencePlugin({
        docsPath,
        docsProvider: "scalar",
        docsTitle,
        specPath,
        schemaConverters,
        specGenerateOptions,
      }),
    ],
  });
}

async function getOpenAPIHandler() {
  const { appRouter } = await import("#/backend/orpc/router.ts");

  return buildOpenAPIHandler(appRouter, {
    docsPath: toOpenAPIHandlerPath(API_DOCS_PATH, API_PREFIX),
    docsTitle: "Nanites API Reference",
    specGenerateOptions: OPENAPI_SPEC_GENERATE_OPTIONS,
    specPath: toOpenAPIHandlerPath(API_SPEC_PATH, API_PREFIX),
  });
}

export async function getOpenAPIDocument() {
  if (cachedOpenAPIDocument) {
    return cachedOpenAPIDocument;
  }

  const { appRouter } = await import("#/backend/orpc/router.ts");
  cachedOpenAPIDocument = await openApiGenerator.generate(appRouter, OPENAPI_SPEC_GENERATE_OPTIONS);

  return cachedOpenAPIDocument;
}

async function getAdminOpenAPIHandler() {
  const { adminRouter } = await import("#/backend/orpc/routers/admin.ts");

  return buildOpenAPIHandler(adminRouter, {
    docsPath: toOpenAPIHandlerPath(ADMIN_API_DOCS_PATH, ADMIN_API_PREFIX),
    docsTitle: "Nanites Admin API Reference",
    specGenerateOptions: ADMIN_OPENAPI_SPEC_GENERATE_OPTIONS,
    specPath: toOpenAPIHandlerPath(ADMIN_API_SPEC_PATH, ADMIN_API_PREFIX),
  });
}

export async function getAdminOpenAPIDocument() {
  if (cachedAdminOpenAPIDocument) {
    return cachedAdminOpenAPIDocument;
  }

  const { adminRouter } = await import("#/backend/orpc/routers/admin.ts");
  cachedAdminOpenAPIDocument = await openApiGenerator.generate(
    adminRouter,
    ADMIN_OPENAPI_SPEC_GENERATE_OPTIONS,
  );

  return cachedAdminOpenAPIDocument;
}

async function getRPCHandler() {
  const { appRouter } = await import("#/backend/orpc/router.ts");

  return new RPCHandler(appRouter, {
    interceptors: [
      onError((error, options) => {
        options.context.logger.error(LOG_EVENTS.API_REQUEST_FAILED, {
          [OTEL_ATTRS.HTTP_REQUEST_METHOD]: options.request.method,
          [OTEL_ATTRS.URL_PATH]: new URL(options.request.url).pathname,
          [OTEL_ATTRS.REQUEST_ID]: options.context.requestId,
          [OTEL_ATTRS.ERROR_TYPE]: getErrorType(error),
          [OTEL_ATTRS.EXCEPTION_MESSAGE]: getErrorMessage(error),
          error,
        });
      }),
    ],
    plugins: [new ResponseHeadersPlugin()],
  });
}

async function getAdminRPCHandler() {
  const { adminRouter } = await import("#/backend/orpc/routers/admin.ts");

  return new RPCHandler(adminRouter, {
    interceptors: [
      onError((error, options) => {
        options.context.logger.error(LOG_EVENTS.API_REQUEST_FAILED, {
          [OTEL_ATTRS.HTTP_REQUEST_METHOD]: options.request.method,
          [OTEL_ATTRS.URL_PATH]: new URL(options.request.url).pathname,
          [OTEL_ATTRS.REQUEST_ID]: options.context.requestId,
          [OTEL_ATTRS.ERROR_TYPE]: getErrorType(error),
          [OTEL_ATTRS.EXCEPTION_MESSAGE]: getErrorMessage(error),
          error,
        });
      }),
    ],
    plugins: [new ResponseHeadersPlugin()],
  });
}

export const openAPIHandler = {
  async handle(...args: Parameters<OpenAPIHandler<BaseContext>["handle"]>) {
    const handler = await getOpenAPIHandler();
    return handler.handle(...args);
  },
};

export const adminOpenAPIHandler = {
  async handle(...args: Parameters<OpenAPIHandler<BaseContext>["handle"]>) {
    const handler = await getAdminOpenAPIHandler();
    return handler.handle(...args);
  },
};

export const rpcHandler = {
  async handle(...args: Parameters<RPCHandler<BaseContext>["handle"]>) {
    const handler = await getRPCHandler();
    return handler.handle(...args);
  },
};

export const adminRpcHandler = {
  async handle(...args: Parameters<RPCHandler<BaseContext>["handle"]>) {
    const handler = await getAdminRPCHandler();
    return handler.handle(...args);
  },
};
