// @vitest-environment node
/**
 * THE TESTS RUN THE MAMMOTH PRODUCTION RUNS (S12-167).
 *
 * parse-docx imports mammoth from esm.sh at an exact version (1.12.3), and the
 * vitest harness hands the handler the npm package instead. package.json said
 * "^1.6.0" and package-lock.json resolved 1.6.0, so CI's `npm ci` tested a
 * mammoth production never ran (it throws on Strict Open XML; 1.12.3 reads
 * it), while Lovable's bun.lock carried a third version.
 *
 * WHAT HOLDS NOW: package.json pins the exact version parse-docx imports, and
 * package-lock.json (what CI installs, with `npm ci`) and bun.lock (what
 * Lovable installs) resolve that same version.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument } from "yaml";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const deployed = /esm\.sh\/mammoth@(\d+\.\d+\.\d+)/.exec(read("supabase/functions/parse-docx/libs.ts"))?.[1];

describe("one mammoth, from production's import to every lockfile", () => {
  it("parse-docx imports an exact mammoth version", () => {
    expect(deployed, "parse-docx/libs.ts no longer imports mammoth from esm.sh at an exact version").toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("package.json pins that exact version, with no range", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(pkg.devDependencies?.mammoth ?? pkg.dependencies?.mammoth).toBe(deployed);
  });

  it("package-lock.json, which CI installs, resolves it", () => {
    const lock = JSON.parse(read("package-lock.json")) as { packages: Record<string, { version?: string; devDependencies?: Record<string, string> }> };
    expect(lock.packages["node_modules/mammoth"]?.version).toBe(deployed);
    expect(lock.packages[""]?.devDependencies?.mammoth).toBe(deployed);
  });

  it("bun.lock, which Lovable installs, resolves it", () => {
    const bun = read("bun.lock");
    expect(/"mammoth": \["mammoth@(\d+\.\d+\.\d+)"/.exec(bun)?.[1]).toBe(deployed);
    expect(/^ {8}"mammoth": "([^"]+)",$/m.exec(bun)?.[1]).toBe(deployed);
  });

  it("CI's test job installs from package-lock.json with npm ci, so the lock is what the tests run", () => {
    const ci = parseDocument(read(".github/workflows/ci.yml")).toJS() as { jobs: Record<string, { steps?: Array<{ run?: string }> }> };
    const runs = (ci.jobs.test?.steps ?? []).map((s) => s.run ?? "");
    expect(runs.some((r) => /^npm ci\b/m.test(r)), "the test job no longer installs with npm ci").toBe(true);
    expect(runs.some((r) => /npm install\b/.test(r)), "an npm install would resolve past the lock").toBe(false);
  });
});
