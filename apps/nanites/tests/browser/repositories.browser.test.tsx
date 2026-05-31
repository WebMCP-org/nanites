import {
  type ActiveInstallation,
  type InstallationRepository,
  type OptionalBrowserNanitesContext,
  installationRepositorySchema,
  listInstallationRepositoriesOutputSchema,
  optionalBrowserNanitesContextSchema,
  visibleInstallationsOutputSchema,
} from "@nanites/contracts/auth";
import { http, ws } from "msw";
import { managerStateOutputSchema } from "#/backend/orpc/contracts/nanites.ts";
import { buildRpcPath } from "#/shared/constants/rpc.ts";
import { page, test } from "../helpers/browser-test.ts";
import { orpcSuccess } from "../helpers/orpc-response.ts";
import { renderApp } from "../helpers/render-app.tsx";

const SESSION_GET_OPTIONAL_RPC_PATH = buildRpcPath("auth", "session", "getOptional");
const SESSION_GET_RPC_PATH = buildRpcPath("auth", "session", "get");
const INSTALLATIONS_LIST_VISIBLE_RPC_PATH = buildRpcPath("auth", "installations", "listVisible");
const REPOSITORIES_LIST_ACTIVE_RPC_PATH = buildRpcPath("auth", "repositories", "listActive");
const NANITES_MANAGER_GET_RPC_PATH = buildRpcPath("nanites", "manager", "get");
const naniteManagerSocket = ws.link(
  "ws://localhost:63315/agents/sigvelo-nanite-manager/:managerName",
);

const authenticatedSession = optionalBrowserNanitesContextSchema.parse({
  actor: {
    id: 7,
    login: "alex",
  },
  activeInstallation: {
    id: 1,
    account: {
      id: 11,
      login: "WebMCP-org",
      type: "Organization",
      avatar_url: null,
    },
  },
  expiresAt: "2026-04-11T12:00:00.000Z",
});

const visibleInstallations = visibleInstallationsOutputSchema.parse({
  installations: [
    {
      id: 1,
      account: {
        id: 11,
        login: "WebMCP-org",
        type: "Organization",
        avatar_url: null,
      },
    },
  ],
});

function registerAuthenticatedDashboardHandlers(
  repositories: readonly InstallationRepository[],
  options?: {
    readonly session?: OptionalBrowserNanitesContext;
    readonly installations?: readonly ActiveInstallation[];
  },
) {
  return [
    http.post(`*${SESSION_GET_OPTIONAL_RPC_PATH}`, () =>
      orpcSuccess(optionalBrowserNanitesContextSchema, options?.session ?? authenticatedSession),
    ),
    http.post(`*${SESSION_GET_RPC_PATH}`, () =>
      orpcSuccess(optionalBrowserNanitesContextSchema, options?.session ?? authenticatedSession),
    ),
    http.post(`*${INSTALLATIONS_LIST_VISIBLE_RPC_PATH}`, () =>
      orpcSuccess(visibleInstallationsOutputSchema, {
        installations: [...(options?.installations ?? visibleInstallations.installations)],
      }),
    ),
    http.post(`*${REPOSITORIES_LIST_ACTIVE_RPC_PATH}`, () =>
      orpcSuccess(listInstallationRepositoriesOutputSchema, {
        repositories: [...repositories],
      }),
    ),
    http.post(`*${NANITES_MANAGER_GET_RPC_PATH}`, () =>
      orpcSuccess(managerStateOutputSchema, {
        managerName: "installation:1",
        state: {
          nanites: {},
          runs: {},
          runOrder: [],
          updatedAt: null,
        },
      }),
    ),
    naniteManagerSocket.addEventListener("connection", ({ client }) => {
      client.send(
        JSON.stringify({
          type: "cf_agent_identity",
          agent: "sigvelo-nanite-manager",
          name: "installation:1",
        }),
      );
      client.send(
        JSON.stringify({
          type: "cf_agent_state",
          state: {
            nanites: {},
            runs: {},
            runOrder: [],
            updatedAt: null,
          },
        }),
      );
    }),
  ];
}

test("active installation opens the Nanites workspace", async ({ worker }) => {
  worker.use(
    ...registerAuthenticatedDashboardHandlers([
      installationRepositorySchema.parse({
        id: 101,
        name: "nanites",
        full_name: "WebMCP-org/nanites",
        owner: { login: "WebMCP-org" },
        default_branch: "main",
        private: true,
        permissions: {
          admin: true,
          push: true,
          pull: true,
        },
      }),
    ]),
  );

  const app = renderApp("/nanites");

  try {
    await page.getByText("Waiting for the runtime").findElement();
    await page.getByText("No Nanites are registered for this installation yet.").findElement();
  } finally {
    app.cleanup();
  }
});

test("empty installation list renders the GitHub App install state", async ({ worker }) => {
  worker.use(
    ...registerAuthenticatedDashboardHandlers([], {
      session: optionalBrowserNanitesContextSchema.parse({
        ...authenticatedSession,
        activeInstallation: null,
      }),
      installations: [],
    }),
  );

  const app = renderApp("/nanites");

  try {
    await page
      .getByRole("heading", { level: 1, name: "Install the SigVelo GitHub App" })
      .findElement();
    await page.getByText("Select all repositories or only the repositories").findElement();
    await page.getByRole("link", { name: /install github app/i }).findElement();
  } finally {
    app.cleanup();
  }
});

test("installed accounts without an active installation render the account chooser", async ({
  worker,
}) => {
  worker.use(
    ...registerAuthenticatedDashboardHandlers([], {
      session: optionalBrowserNanitesContextSchema.parse({
        ...authenticatedSession,
        activeInstallation: null,
      }),
    }),
  );

  const app = renderApp("/nanites");

  try {
    await page
      .getByRole("heading", { level: 1, name: "Choose where Nanites can work" })
      .findElement();
    await page.getByText("WebMCP-org").findElement();
    await page.getByText("Use account").findElement();
    await page.getByRole("link", { name: /install on another account/i }).findElement();
  } finally {
    app.cleanup();
  }
});

test("active installation without repositories still opens the Nanites workspace", async ({
  worker,
}) => {
  worker.use(...registerAuthenticatedDashboardHandlers([]));

  const app = renderApp("/nanites");

  try {
    await page.getByText("Waiting for the runtime").findElement();
    await page.getByText("No Nanites are registered for this installation yet.").findElement();
  } finally {
    app.cleanup();
  }
});
