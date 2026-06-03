import { hc } from "hono/client";
import type { NanitesHttpApp } from "#/backend/http.ts";

export const httpClient = hc<NanitesHttpApp>("/", {
  init: {
    credentials: "include",
  },
});
