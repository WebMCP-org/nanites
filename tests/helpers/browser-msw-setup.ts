// fallow-ignore-file unused-file
import { afterAll, afterEach, beforeAll } from "vite-plus/test";
import { setupWorker } from "msw/browser";

const browserWorker = setupWorker();

beforeAll(async () => {
  await browserWorker.start({ onUnhandledRequest: "error" });
});

afterEach(() => {
  browserWorker.resetHandlers();
});

afterAll(() => {
  browserWorker.stop();
});
