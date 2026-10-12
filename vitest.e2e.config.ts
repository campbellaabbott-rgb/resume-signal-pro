import { defineConfig } from "vitest/config";
import path from "path";

// THE MONEY PATH ALONE (critical-path plan 2026-10-12, CP-I). The end-to-end
// purchase scenarios under src/test/e2e also run in the default suite; this
// config runs only them, for the e2e-purchase workflow and for a builder who
// changed a checkout, the webhook, a verifier, the sweep, a generator or a
// purchase mailer:
//
//   npx vitest run -c vitest.e2e.config.ts
//
// Node, not jsdom: every handler is bundled with esbuild and the database is
// pglite. Two workers: each file builds its own database and loads seven
// handlers, and the 8 GB machines that run this are shared.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/test/e2e/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**", "**/New Folder With Items/**"],
    maxWorkers: 2,
  },
});
