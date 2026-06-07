/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />

declare module "*?raw" {
  const contents: string;
  export default contents;
}
