import "./frontend/styles.css";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient, router } from "#/frontend/lib/router.ts";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Nanites client could not find #root.");
}

const root = createRoot(rootElement);
root.render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
