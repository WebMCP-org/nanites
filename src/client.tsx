import "./frontend/instrument.ts";
import "./frontend/styles.css";
import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { ORPCProvider } from "#/frontend/lib/orpc.tsx";
import { installAuthQueryRedirects } from "#/frontend/routes/-auth-client.ts";
import { router } from "#/frontend/router.ts";

installAuthQueryRedirects(router);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Nanites client could not find #root.");
}

const root = createRoot(rootElement, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
});
root.render(
  <ORPCProvider>
    <RouterProvider router={router} />
  </ORPCProvider>,
);
