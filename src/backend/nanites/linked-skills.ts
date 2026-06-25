import type { SkillSource } from "agents/skills";
import {
  workspaceSkillLinks,
  type SkillLinkWorkspace,
  type WorkspaceSkillLinksOptions,
} from "@sigvelo/skill-links";

export function createNaniteWorkspaceSkillSource(input: {
  workspace: SkillLinkWorkspace;
  sourceUrls: WorkspaceSkillLinksOptions["sourceUrls"];
  beforeRefresh?: () => Promise<void>;
}): SkillSource {
  return workspaceSkillLinks(input.workspace, {
    id: "nanite-linked-skills",
    sourceUrls: input.sourceUrls,
    beforeRefresh: input.beforeRefresh,
  });
}
