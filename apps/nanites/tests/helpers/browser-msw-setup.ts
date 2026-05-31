import { afterAll, afterEach, beforeAll } from "vite-plus/test";
import { browserWorker } from "./msw-browser-worker.ts";

beforeAll(async () => {
  await browserWorker.start({ onUnhandledRequest: "error" });
});

afterEach(() => {
  browserWorker.resetHandlers();
});

afterAll(() => {
  browserWorker.stop();
});
