import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

/**
 * Page-level accessibility tests for React component Storybook stories.
 *
 * These scan rendered Storybook story iframes for WCAG 2.2 AA violations
 * using axe-core. They complement the per-story addon-a11y checks by testing
 * composed pages and dark mode.
 *
 * Requires Storybook running on port 6011: pnpm storybook
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const storyUrl = (id: string) => `http://localhost:6011/iframe.html?id=${id}&viewMode=story`;

function scanStory(storyId: string, waitMs = 1000) {
  return async ({ page }: { page: Page }) => {
    await page.goto(storyUrl(storyId));
    await page.waitForTimeout(waitMs);
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  };
}

function scanStoryDarkMode(storyId: string) {
  return async ({ page }: { page: Page }) => {
    await page.goto(storyUrl(storyId));
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
      document.documentElement.classList.add("sigvelo-dark");
      document.documentElement.classList.remove("sigvelo-light");
    });
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  };
}

// --- A11y regression stories (dedicated a11y test compositions) ---

test.describe("A11y regression stories", () => {
  test("form labels have no violations", scanStory("a11y-regression-tests--form-labels"));
  test("button accessible names pass", scanStory("a11y-regression-tests--button-accessible-names"));
  test(
    "color contrast matrix - light mode",
    scanStory("a11y-regression-tests--color-contrast-matrix"),
  );
  test(
    "color contrast matrix - dark mode",
    scanStoryDarkMode("a11y-regression-tests--color-contrast-matrix"),
  );
  test("badge contrast", scanStory("a11y-regression-tests--badge-contrast"));
  test(
    "composite widgets (tabs, accordion)",
    scanStory("a11y-regression-tests--composite-widgets"),
  );
  test("interactive cards", scanStory("a11y-regression-tests--interactive-cards"));
  test("toggle states", scanStory("a11y-regression-tests--toggle-states"));
  test("progress with label", scanStory("a11y-regression-tests--progress-with-label"));
});

// --- Individual component default stories ---

test.describe("Component stories - light mode", () => {
  test("accordion", scanStory("components-accordion--default"));
  test("alert dialog", scanStory("components-alertdialog--default"));
  test("autocomplete", scanStory("components-autocomplete--default"));
  test("avatar", scanStory("components-avatar--default"));
  test("badge", scanStory("components-badge--default"));
  test("button", scanStory("components-button--primary"));
  test("card", scanStory("components-card--default"));
  test("checkbox", scanStory("components-checkbox--default"));
  test("checkbox group", scanStory("components-checkboxgroup--default"));
  test("collapsible", scanStory("components-collapsible--default"));
  test("combobox", scanStory("components-combobox--default"));
  test("dialog", scanStory("components-dialog--default"));
  test("field", scanStory("components-field--default"));
  test("fieldset", scanStory("components-fieldset--default"));
  test("form", scanStory("components-form--default"));
  test("input", scanStory("components-input--default"));
  test("label", scanStory("components-label--default"));
  test("menu", scanStory("components-menu--default"));
  test("menubar", scanStory("components-menubar--default"));
  test("meter", scanStory("components-meter--default"));
  test("navigation menu", scanStory("components-navigationmenu--default"));
  test("number field", scanStory("components-numberfield--default"));
  test("popover", scanStory("components-popover--default"));
  test("preview card", scanStory("components-previewcard--default"));
  test("progress", scanStory("components-progress--default"));
  test("radio group", scanStory("components-radiogroup--default"));
  test("scroll area", scanStory("components-scrollarea--default"));
  test("select", scanStory("components-select--default"));
  test("separator", scanStory("components-separator--default"));
  test("slider", scanStory("components-slider--default"));
  test("switch", scanStory("components-switch--default"));
  test("tabs", scanStory("components-tabs--default"));
  test("toast", scanStory("components-toast--default"));
  test("toggle", scanStory("components-toggle--default"));
  test("toggle group", scanStory("components-togglegroup--default"));
  test("toolbar", scanStory("components-toolbar--default"));
  test("tooltip", scanStory("components-tooltip--default"));

  // AI chat & code components
  test("artifact", scanStory("components-artifact--default"));
  test("chain of thought", scanStory("components-chainofthought--default"));
  test("code block", scanStory("components-codeblock--default"));
  test("commit", scanStory("components-commit--default"));
  test("context", scanStory("components-context--default"));
  test("conversation", scanStory("components-conversation--default"));
  test("conversation empty state", scanStory("components-conversation--empty-state"));
  test("environment variables", scanStory("components-environmentvariables--default"));
  test("file tree", scanStory("components-filetree--default"));
  test("message", scanStory("components-message--default"));
  test("message with actions", scanStory("components-message--with-actions"));
  test("message branching", scanStory("components-message--branching"));
  test("model selector", scanStory("components-modelselector--default"));
  test("prompt input", scanStory("components-promptinput--default"));
  test("prompt input with tools", scanStory("components-promptinput--with-tools"));
  test("queue", scanStory("components-queue--default"));
  test("reasoning", scanStory("components-reasoning--default"));
  test("sources", scanStory("components-sources--default"));
  test("task", scanStory("components-task--default"));
  test("terminal", scanStory("components-terminal--default"));
  test("test results", scanStory("components-testresults--default"));
  test("tool", scanStory("components-tool--default"));
  test("web preview", scanStory("components-webpreview--default"));
});

// --- Dark mode coverage for key interactive components ---

test.describe("Component stories - dark mode", () => {
  test("button", scanStoryDarkMode("components-button--primary"));
  test("input", scanStoryDarkMode("components-input--default"));
  test("card", scanStoryDarkMode("components-card--default"));
  test("dialog", scanStoryDarkMode("components-dialog--default"));
  test("tabs", scanStoryDarkMode("components-tabs--default"));
  test("select", scanStoryDarkMode("components-select--default"));
  test("form", scanStoryDarkMode("components-form--default"));
  test("badge", scanStoryDarkMode("components-badge--default"));
  test("meter", scanStoryDarkMode("components-meter--default"));
  test("progress", scanStoryDarkMode("components-progress--default"));
  test("switch", scanStoryDarkMode("components-switch--default"));
  test("slider", scanStoryDarkMode("components-slider--default"));
  test("accordion", scanStoryDarkMode("components-accordion--default"));
  test("checkbox", scanStoryDarkMode("components-checkbox--default"));
  test("radio group", scanStoryDarkMode("components-radiogroup--default"));

  // AI chat & code components
  test("artifact", scanStoryDarkMode("components-artifact--default"));
  test("chain of thought", scanStoryDarkMode("components-chainofthought--default"));
  test("code block", scanStoryDarkMode("components-codeblock--default"));
  test("commit", scanStoryDarkMode("components-commit--default"));
  test("context", scanStoryDarkMode("components-context--default"));
  test("conversation", scanStoryDarkMode("components-conversation--default"));
  test("conversation empty state", scanStoryDarkMode("components-conversation--empty-state"));
  test("environment variables", scanStoryDarkMode("components-environmentvariables--default"));
  test("file tree", scanStoryDarkMode("components-filetree--default"));
  test("message", scanStoryDarkMode("components-message--default"));
  test("model selector", scanStoryDarkMode("components-modelselector--default"));
  test("prompt input", scanStoryDarkMode("components-promptinput--default"));
  test("queue", scanStoryDarkMode("components-queue--default"));
  test("reasoning", scanStoryDarkMode("components-reasoning--default"));
  test("sources", scanStoryDarkMode("components-sources--default"));
  test("task", scanStoryDarkMode("components-task--default"));
  test("terminal", scanStoryDarkMode("components-terminal--default"));
  test("test results", scanStoryDarkMode("components-testresults--default"));
  test("tool", scanStoryDarkMode("components-tool--default"));
  test("web preview", scanStoryDarkMode("components-webpreview--default"));
});
