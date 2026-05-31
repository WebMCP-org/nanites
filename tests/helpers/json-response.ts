import type { z } from "zod";

export async function parseJsonResponse<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  return schema.parse(await response.json());
}
