import { DetailedError } from "hono/client";
import { z } from "zod";

const detailedErrorDetailSchema = z.object({ data: z.unknown().optional() }).passthrough();
const apiProblemSchema = z.object({
  title: z.string().optional(),
  detail: z.string().optional(),
  status: z.number().int().optional(),
  code: z.string().optional(),
  kind: z.string().optional(),
  requestId: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ApiProblem = z.output<typeof apiProblemSchema>;

function readDetailedErrorData(error: unknown): unknown {
  if (!(error instanceof DetailedError)) {
    return undefined;
  }

  return detailedErrorDetailSchema.safeParse(error.detail).data?.data;
}

export function readApiProblem(error: unknown): ApiProblem | null {
  const result = apiProblemSchema.safeParse(readDetailedErrorData(error));
  return result.success ? result.data : null;
}

export function isAuthenticationRequiredError(error: unknown): boolean {
  if (!(error instanceof DetailedError) || error.statusCode !== 401) {
    return false;
  }

  const code = readApiProblem(error)?.code;
  return code === undefined || code === "authentication_required";
}
