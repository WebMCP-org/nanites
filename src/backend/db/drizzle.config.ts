import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/backend/db/schema.ts",
  out: "./src/backend/db/migrations",
  dialect: "sqlite",
  driver: "d1-http",
  // Developer-only remote migration generation. Self-host setup does not ask users for these.
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
    token: process.env.CLOUDFLARE_API_TOKEN!,
  },
  verbose: true,
  strict: true,
});
