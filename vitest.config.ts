import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import os from "node:os";
import { maxWorkersFor } from "./vitest.workers";

// Standalone config rather than merging vite.config.ts, since that file's default
// export is a mode-dependent function (defineConfig(({ mode }) => ...)) which isn't
// straightforward to merge — duplicating the resolve alias here is simpler and
// avoids coupling the test runner's config to the app build config's shape.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // One fork per 2 GB of memory, not one per core: see vitest.workers.ts for
    // the measurement that made the default fail the pre-push gate.
    maxWorkers: maxWorkersFor(os.totalmem(), os.availableParallelism?.() ?? os.cpus().length),
    // Agent worktrees nest full repo copies under .claude/worktrees — without
    // this exclude their in-progress tests get swept into (and can fail) the
    // main repo's runs, and every suite double-counts.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**", "**/New Folder With Items/**"],
  },
});
