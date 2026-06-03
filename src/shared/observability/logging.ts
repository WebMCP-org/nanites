/**
 * Shared logger categories and runtime values for the agent app and its DB
 * package so the log stream stays queryable by stable dimensions.
 */
export const LOGGING = {
  ROOT_CATEGORY: "agent",
  APP_CATEGORY: ["agent", "app"],
  SERVER_CATEGORY: ["agent", "server"],
  NANITES_CATEGORY: ["agent", "nanites"],
  DB_CATEGORY: ["agent", "db"],
  LOGTAPE_META_CATEGORY: ["logtape", "meta"],
  REQUEST_CHILD_CATEGORY: "request",
  BROWSER_RUNTIME: "browser",
  WORKER_RUNTIME: "worker",
} as const;
