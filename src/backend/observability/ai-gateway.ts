import Cloudflare from "cloudflare";
import type { LogGetResponse } from "cloudflare/resources/ai-gateway/logs";

export type CloudflareAiGatewayLog = LogGetResponse;

export async function readCloudflareAiGatewayLog(input: {
  env: Env;
  logId: string;
  gatewayId: string;
}): Promise<CloudflareAiGatewayLog | null> {
  try {
    return await new Cloudflare({
      apiToken: input.env.CLOUDFLARE_API_TOKEN.trim(),
    }).aiGateway.logs.get(input.gatewayId, input.logId, {
      account_id: input.env.CLOUDFLARE_ACCOUNT_ID,
    });
  } catch {
    return null;
  }
}
