import { createRoot, type Root } from "react-dom/client";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { installAuthQueryRedirects } from "#/frontend/routes/-auth-client.ts";
import { ORPCProvider, adminOrpc, orpc, queryClient } from "#/frontend/lib/orpc.tsx";
import { createAppRouter } from "#/frontend/router.ts";

interface RenderedApp {
  readonly container: HTMLDivElement;
  readonly cleanup: () => void;
}

function createTestRouter(initialPath: string) {
  const history = createMemoryHistory({
    initialEntries: [initialPath],
  });

  return createAppRouter({
    history,
    context: {
      queryClient,
      orpc,
      adminOrpc,
    },
    scrollRestoration: false,
  });
}

export function renderApp(initialPath: string): RenderedApp {
  queryClient.clear();
  document.body.innerHTML = "";

  const container = document.createElement("div");
  document.body.appendChild(container);

  const router = createTestRouter(initialPath);
  installAuthQueryRedirects(router);

  const root: Root = createRoot(container);
  root.render(
    <ORPCProvider>
      <RouterProvider router={router} />
    </ORPCProvider>,
  );

  return {
    container,
    cleanup: () => {
      root.unmount();
      queryClient.clear();
      document.body.innerHTML = "";
    },
  };
}
