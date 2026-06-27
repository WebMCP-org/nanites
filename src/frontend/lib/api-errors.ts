import { DetailedError } from "hono/client";
import { z } from "zod";

const detailedErrorDetailSchema = z.object({ data: z.unknown() }).passthrough();
const apiProblemSchema = z.object({
  title: z.string(),
  detail: z.string(),
  status: z.number().int(),
  code: z.string(),
  instance: z.string(),
  kind: z.string().optional(),
  requestId: z.string(),
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

  return readApiProblem(error)?.code === "authentication_required";
}
