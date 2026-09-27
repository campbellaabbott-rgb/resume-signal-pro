import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";
import { existsSync } from "fs";
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
    // The bake is gated on being run as a script; a gate that did not open
    // exits 0 with an SPA-only dist and every prerendered page gone. That is
    // not blocked here (the never-block policy above stands) but it is never
    // silent: a known prerendered page must exist when the bake ran.
    if (!existsSync(path.resolve(__dirname, "dist/pricing/index.html"))) {
      console.error("[prerender-seo] POST-CONDITION FAILED: dist/pricing/index.html was not written — the bake did not run; this dist is SPA-only");
    }
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
