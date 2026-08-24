import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A PRERENDERED PAGE NAMED ONE SCRIPT AND NEEDED THREE.
 *
 * Measured on the built output 2026-08-24: dist/jobs/index.html referenced
 * exactly one asset, the 808KB entry chunk. A phone therefore had to download
 * it, parse it, and only THEN let the router discover Jobs-*.js (176KB) — and
 * after parsing that, Footer-*.js (92KB). Three sequential round trips before
 * the board could paint, on a page whose server response already takes ~2.3s.
 *
 * modulepreload collapses them into one parallel fetch. It is a hint, not a
 * behaviour change: a stale or wrong filename costs one ignored request and
 * never a broken page, which is why the filenames are read from the build
 * output rather than written down.
 */
const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");

describe("a prerendered page names the chunks it needs", () => {
  it("chunk filenames are discovered from the build, never hardcoded", () => {
    // Hashes change every deploy; a literal would rot into a 404 hint.
    expect(SCRIPT).toMatch(/const chunkFor = \(prefix\) =>/);
    expect(SCRIPT).toMatch(/assetFiles\.find\(\(f\) => f\.startsWith\(`\$\{prefix\}-`\) && f\.endsWith\("\.js"\)\)/);
    expect(SCRIPT).not.toMatch(/modulepreload[^`]*assets\/Jobs-[A-Za-z0-9]{6}/);
  });

  it("the jobs route preloads its own chunk; other routes do not", () => {
    expect(SCRIPT).toMatch(/path === "\/jobs" \|\| path\.startsWith\("\/jobs\/"\)/);
  });

  it("a missing chunk warns instead of emitting a broken hint", () => {
    expect(SCRIPT).toMatch(/preload hint skipped/);
  });

  it("the hints are actually injected into the head", () => {
    expect(SCRIPT).toMatch(/headExtra \+= preloadFor\(path\);/);
  });

  // Only meaningful after a build; skipped rather than failed on a clean tree,
  // because the source assertions above already hold the contract.
  const jobsHtml = resolve(ROOT, "dist/jobs/index.html");
  it.skipIf(!existsSync(jobsHtml))("the built /jobs page carries both hints", () => {
    const html = readFileSync(jobsHtml, "utf8");
    const hints = [...html.matchAll(/<link rel="modulepreload" href="\/assets\/([^"]+)"/g)].map((m) => m[1]);
    expect(hints.some((h) => h.startsWith("Jobs-")), `hints were ${JSON.stringify(hints)}`).toBe(true);
    expect(hints.some((h) => h.startsWith("Footer-")), `hints were ${JSON.stringify(hints)}`).toBe(true);
    // Every hinted file must exist, or the browser wastes a request.
    for (const h of hints) {
      expect(existsSync(resolve(ROOT, "dist/assets", h)), `${h} is hinted but not built`).toBe(true);
    }
  });
});
