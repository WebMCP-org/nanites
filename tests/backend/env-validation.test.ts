import { createExecutionContext, env } from "cloudflare:test";
import worker from "#/server.ts";

test("Worker fails closed before routing when required env is a placeholder", async () => {
  const response = await worker.fetch(
    new Request("https://sigvelo-agent-tests.example.workers.dev/api/auth/session/optional"),
    {
      ...env,
      GITHUB_APP_ID: "replace-with-github-app-id",
    },
    createExecutionContext(),
  );

  await expect(response.json()).resolves.toEqual({ code: "deployment_runtime_config_invalid" });
  expect(response.status).toBe(503);
});

test("Worker fails closed before routing when Cloudflare API token is missing", async () => {
  const envWithoutCloudflareApiToken = { ...env };
  delete (envWithoutCloudflareApiToken as Partial<Env>).CLOUDFLARE_API_TOKEN;

  const response = await worker.fetch(
    new Request("https://sigvelo-agent-tests.example.workers.dev/api/auth/session/optional"),
    envWithoutCloudflareApiToken,
    createExecutionContext(),
  );

  await expect(response.json()).resolves.toEqual({ code: "deployment_runtime_config_invalid" });
  expect(response.status).toBe(503);
});
