import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";
import { componentTagger } from "lovable-tagger";

// After every production build, render the ~260 data-driven SEO routes to
// static HTML in dist/ (crawlers that don't run JS — Bing, DuckDuckGo, AI
// crawlers — otherwise see empty pages). Lives in the vite config, not an npm
// postbuild hook, so it runs no matter how the build is invoked (Lovable's
// pipeline included). The script never throws: a prerender failure logs and
// ships SPA-only pages rather than blocking a publish.
const prerenderSeo = (): Plugin => ({
  name: "prerender-seo",
  apply: "build",
  closeBundle() {
    execSync("node scripts/prerender-seo.mjs", { stdio: "inherit" });
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    // PORT lets the preview harness assign a free port (multiple sessions run
    // dev servers against this repo); default stays 8080 for humans.
    port: Number(process.env.PORT) || 8080,
  },
  plugins: [react(), mode === "development" && componentTagger(), prerenderSeo()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
