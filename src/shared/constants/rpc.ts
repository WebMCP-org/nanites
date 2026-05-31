/** Public mount point for the app's typed oRPC transport. */
export const RPC_PREFIX = "/rpc";

/** Admin-only mount point for the internal oRPC transport. */
export const ADMIN_RPC_PREFIX = "/admin/rpc";

/** Builds a stable public RPC transport path from procedure segments. */
export function buildRpcPath(...segments: readonly string[]) {
  return [RPC_PREFIX, ...segments].join("/");
}

/** Builds a stable admin RPC transport path from procedure segments. */
export function buildAdminRpcPath(...segments: readonly string[]) {
  return [ADMIN_RPC_PREFIX, ...segments].join("/");
}
