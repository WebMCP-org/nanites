/** Canonical production origin for public app-level OpenAPI servers. */
export const PUBLIC_APP_ORIGIN = "https://app.sigvelo.com";

/** Public mount point for oRPC/OpenAPI routes served by the worker. */
export const API_PREFIX = "/api";

/** Browser path to the generated API reference. */
export const API_DOCS_PATH = `${API_PREFIX}/docs`;

/** Browser path to the generated public OpenAPI specification document. */
export const API_SPEC_PATH = `${API_PREFIX}/spec.json`;

/** Admin-only mount point for the internal oRPC/OpenAPI routes served by the worker. */
export const ADMIN_API_PREFIX = "/admin/api";

/** Browser path to the generated admin API reference. */
export const ADMIN_API_DOCS_PATH = `${ADMIN_API_PREFIX}/docs`;

/** Browser path to the generated admin OpenAPI specification document. */
export const ADMIN_API_SPEC_PATH = `${ADMIN_API_PREFIX}/spec.json`;
