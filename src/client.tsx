import "./frontend/instrument.ts";
import "./frontend/styles.css";
import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { ORPCProvider } from "#/frontend/lib/orpc.tsx";
import { installAuthQueryRedirects } from "#/frontend/features/auth/auth-client.ts";
import { router } from "#/frontend/router.ts";

installAuthQueryRedirects(router);

const root = createRoot(document.getElementById("root")!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
});
root.render(
  <ORPCProvider>
    <RouterProvider router={router} />
  </ORPCProvider>,
);
