import type { z } from "zod";
import { HttpResponse } from "msw";

export function orpcSuccess<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  payload: z.input<TSchema>,
) {
  return HttpResponse.json({
    json: schema.parse(payload),
  });
}
