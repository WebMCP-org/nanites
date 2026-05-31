import { z } from "zod";

export const healthCheckOutputSchema = z
  .object({
    status: z.literal("ok").describe("Worker health state."),
  })
  .describe("Health check response returned when the worker can serve requests.");

export type HealthCheckOutput = z.infer<typeof healthCheckOutputSchema>;
