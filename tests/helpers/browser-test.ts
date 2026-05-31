import { page } from "vite-plus/test/browser/context";
import { expect, test as baseTest } from "vite-plus/test";
import { browserWorker } from "./msw-browser-worker.ts";

type BrowserFixtures = {
  worker: typeof browserWorker;
};

export const test = baseTest.extend<BrowserFixtures>({
  worker: [
    // Oxlint warns on empty patterns, but Vitest fixtures require object destructuring here.
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(browserWorker);
    },
    { auto: true },
  ],
});

export { expect, page };
