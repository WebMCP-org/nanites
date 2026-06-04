import { hc } from "hono/client";
import type { NanitesHttpApp } from "#/backend/api/apps.ts";

export const httpClient = hc<NanitesHttpApp>("/", {
  init: {
    credentials: "include",
  },
});
