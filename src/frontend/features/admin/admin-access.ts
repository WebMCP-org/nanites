import { ORPCError } from "@orpc/client";
import { ADMIN_ERROR_CODES } from "@nanites/contracts/admin";

export function isAdminNotAuthorizedError(error: unknown): boolean {
  if (!(error instanceof ORPCError) || error.status !== 403) {
    return false;
  }

  if (typeof error.data !== "object" || error.data === null || !("code" in error.data)) {
    return false;
  }

  return error.data.code === ADMIN_ERROR_CODES.cloudflareAccessRequired;
}
