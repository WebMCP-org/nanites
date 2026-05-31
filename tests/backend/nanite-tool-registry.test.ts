import { naniteTools } from "#/backend/nanites/manager-tools.ts";

test("Nanite tool registry declares the canonical manager tools explicitly", () => {
  expect(naniteTools.map((tool) => tool.name)).toEqual([
    "sigvelo_create_nanite",
    "sigvelo_debug_nanites",
    "sigvelo_deprovision_nanites",
    "sigvelo_start_nanite_run",
    "sigvelo_cancel_nanite_runs",
    "sigvelo_test_nanite_trigger",
    "sigvelo_explore_nanite_workspace",
    "sigvelo_reset_nanite_debug",
  ]);
});

test("Nanite tool names do not drift into duplicate MCP registrations", () => {
  const toolNames = naniteTools.map((tool) => tool.name);
  expect(new Set(toolNames).size).toBe(toolNames.length);
});

test("Nanite tools keep runtime validation at the input boundary", () => {
  for (const tool of naniteTools) {
    expect(tool.config).not.toHaveProperty("outputSchema");
  }
});
