import { env } from "cloudflare:test";
import { GITHUB_WEBHOOK_PATH } from "#/shared/constants.ts";
import type { EmitterWebhookEvent, EmitterWebhookEventName } from "@octokit/webhooks";
import { encodeHex } from "#/backend/crypto.ts";
import type { GitHubWebhookEventName } from "#/shared/utils/github.ts";
import { TEST_GITHUB_APP_ID } from "./d1-baseline.ts";

const textEncoder = new TextEncoder();

type DeepPartial<T> = T extends readonly (infer TItem)[]
  ? readonly DeepPartial<TItem>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type TestGitHubWebhookPayload<TEventName extends EmitterWebhookEventName> = DeepPartial<
  EmitterWebhookEvent<TEventName>["payload"]
>;

async function signGitHubWebhookBody(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return `sha256=${encodeHex(await crypto.subtle.sign("HMAC", key, textEncoder.encode(body)))}`;
}

export async function buildTestGitHubWebhookRequest({
  body,
  delivery,
  event,
  origin,
  signed = true,
}: {
  readonly body: string;
  readonly delivery: string;
  readonly event: GitHubWebhookEventName;
  readonly origin: string;
  readonly signed?: boolean;
}): Promise<Request> {
  const headers = new Headers({
    "content-type": "application/json",
    "x-github-delivery": delivery,
    "x-github-event": event,
    "x-github-hook-installation-target-id": String(TEST_GITHUB_APP_ID),
    "x-github-hook-installation-target-type": "integration",
  });

  if (signed) {
    headers.set(
      "x-hub-signature-256",
      await signGitHubWebhookBody(body, env.GITHUB_APP_WEBHOOK_SECRET),
    );
  }

  return new Request(`${origin}${GITHUB_WEBHOOK_PATH}`, {
    method: "POST",
    headers,
    body,
  });
}
