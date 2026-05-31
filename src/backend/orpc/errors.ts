import { z } from "zod";

const NOT_FOUND_ERROR_CODE = "resource_not_found";
const NOT_FOUND_ERROR_MESSAGE = "Resource not found.";
const INTERNAL_SERVER_ERROR_CODE = "internal_server_error";
const INTERNAL_SERVER_ERROR_MESSAGE =
  "An unexpected error occurred. Contact support with the requestId.";

/**
 * Cross-cutting not-found payload shared across public API procedures.
 *
 * @see .agents/skills/maintainable-typescript/opinionated-stack/errors-are-schema.md
 */
export const notFoundErrorDataSchema = z
  .object({
    code: z.literal(NOT_FOUND_ERROR_CODE),
    message: z.literal(NOT_FOUND_ERROR_MESSAGE),
    resource: z.string().min(1).describe("The type of resource that was not found."),
    resourceId: z.string().min(1).describe("The identifier that was used for the lookup."),
  })
  .describe("The requested resource does not exist.");

/**
 * Cross-cutting internal-error payload shared across public API procedures.
 *
 * @see .agents/skills/maintainable-typescript/references/error-messages-are-ux.md
 */
export const internalErrorDataSchema = z
  .object({
    code: z.literal(INTERNAL_SERVER_ERROR_CODE),
    message: z.literal(INTERNAL_SERVER_ERROR_MESSAGE),
    requestId: z
      .string()
      .min(1)
      .describe("Support correlation identifier for this failed request."),
  })
  .describe(INTERNAL_SERVER_ERROR_MESSAGE);

export type NotFoundErrorData = z.infer<typeof notFoundErrorDataSchema>;
export type InternalErrorData = z.infer<typeof internalErrorDataSchema>;

export function buildNotFoundErrorData(resource: string, resourceId: string): NotFoundErrorData {
  return notFoundErrorDataSchema.parse({
    code: NOT_FOUND_ERROR_CODE,
    message: NOT_FOUND_ERROR_MESSAGE,
    resource,
    resourceId,
  });
}

export function buildInternalErrorData(requestId: string): InternalErrorData {
  return internalErrorDataSchema.parse({
    code: INTERNAL_SERVER_ERROR_CODE,
    message: INTERNAL_SERVER_ERROR_MESSAGE,
    requestId,
  });
}

export const baseErrors = {
  NOT_FOUND: {
    data: notFoundErrorDataSchema,
  },
  INTERNAL_SERVER_ERROR: {
    data: internalErrorDataSchema,
  },
} as const;
