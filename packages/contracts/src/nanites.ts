import { z } from "zod";
import { runConclusionSchema } from "@nanites/domain/business";
import { isoDateTimeSchema } from "./auth.ts";

export const naniteRunKeySchema = z
  .string()
  .min(1)
  .brand<"NaniteRunKey">()
  .meta({ title: "NaniteRunKey" })
  .describe("Internal correlation id for one repo-scoped Nanite attempt.");

export const naniteManagerKeySchema = z
  .string()
  .min(1)
  .brand<"NaniteManagerKey">()
  .meta({ title: "NaniteManagerKey" })
  .describe("Stable agent name for the installation-scoped Nanite manager.");

export const githubResultSurfaceSchema = z
  .object({
    checkRunId: z.number().int().positive().nullable(),
    checkRunName: z.string().min(1),
    headSha: z.string().min(1).nullable().default(null),
    status: z.enum(["queued", "in_progress", "completed"]),
    conclusion: runConclusionSchema.nullable(),
    detailsUrl: z.string().min(1).nullable(),
    summary: z.string().min(1).nullable(),
    updatedAt: isoDateTimeSchema.nullable(),
  })
  .describe("Thin GitHub result projection for the current Nanite attempt.");

export const naniteGitHubCheckOutputSchema = z
  .object({
    title: z.string().min(1),
    summary: z.string().min(1),
    text: z.string().min(1),
  })
  .describe("Canonical GitHub check-run output Sigvelo publishes for one Nanite attempt.");

export type NaniteRunKey = z.infer<typeof naniteRunKeySchema>;
export type NaniteManagerKey = z.infer<typeof naniteManagerKeySchema>;
export type GitHubResultSurface = z.infer<typeof githubResultSurfaceSchema>;
export type NaniteGitHubCheckOutput = z.infer<typeof naniteGitHubCheckOutputSchema>;
