// @vitest-environment node
/**
 * THE REQUIRED BUILD BAKES OFFLINE, AND A PULL REQUEST BAKES LIVE ONLY WHEN IT
 * CHANGES THE BAKE (cost audit 2026-11-08: Do first #8 and the owner's
 * decision on built-output).
 *
 * WHAT WAS WRONG. Every CI run baked the site against LIVE production twice:
 * once in the `test` job's production build, whose dist/ no later step read,
 * and once in `built-output`, on every push to main and every pull request
 * event. One live bake is about 1,100-1,200 production reads (up to 721
 * job-board calls, 372-492 get_company_intel RPCs) and the test job's copy
 * took 174 s of the required path.
 *
 * WHAT HOLDS NOW, read from the workflow as GitHub parses it and run where it
 * can be run (bash against a fake npm and a fake git; the real
 * scripts/bake-scope.mjs on the real tree):
 *   - the test job's build sets PRERENDER_OFFLINE=1 and fails, by name, when
 *     the offline bake wrote no dist/pricing/index.html;
 *   - built-output waits for bake-scope and is skipped (which GitHub counts as
 *     passing for a required check) only on a pull request that changes
 *     nothing the bake runs or reads; a push, a bake change, or a bake-scope
 *     that could not answer all run the live bake;
 *   - no workflow-level path filter can leave a check unreported.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { bakeInputs, bakeTouches, bakeVerdict, distGuards } from "../../scripts/bake-scope.mjs";

const ROOT = resolve(__dirname, "../..");
/** Each of these runs bash, and node under it: seconds each on a loaded machine. */
const SPAWN_BUDGET = 60_000;
const doc = parseDocument(readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8"));
type Step = { name?: string; id?: string; if?: string; run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = { steps?: Step[]; needs?: string | string[]; if?: string; outputs?: Record<string, string> };
const wf = doc.toJS() as { on: Record<string, unknown>; jobs: Record<string, Job> };
const build = (wf.jobs.test.steps ?? []).find((s) => s.name === "Production build");
const scopeJob = wf.jobs["bake-scope"];
const scopeStep = (scopeJob?.steps ?? []).find((s) => s.id === "scope");

/** A scratch dir with a bin/ of fakes ahead of the real PATH. */
function scratch(fakes: Record<string, string>): { dir: string; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(tmpdir(), "ci-bake-"));
  mkdirSync(join(dir, "bin"));
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(join(dir, "bin", name), body);
    chmodSync(join(dir, "bin", name), 0o755);
  }
  return { dir, env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}` } };
}

describe("the required test job bakes offline", () => {
  it("its production build sets PRERENDER_OFFLINE=1", () => {
    expect(build, "no Production build step in the test job").toBeTruthy();
    expect(build!.env?.PRERENDER_OFFLINE).toBe("1");
  });

  it("and fails by name when the offline bake wrote no dist/pricing/index.html, which vite only logs", () => {
    // A fake npm whose build writes a dist with or without the pricing page.
    const run = (writesPricing: boolean) => {
      const { dir, env } = scratch({ npm: `#!/bin/bash\nmkdir -p dist${writesPricing ? " dist/pricing && echo '<html>' > dist/pricing/index.html" : ""}\nexit 0\n` });
      let code = 0, out = "";
      try { out = execFileSync("bash", ["-e", "-c", build!.run!], { cwd: dir, env, encoding: "utf8", stdio: "pipe" }); }
      catch (e) { code = (e as { status?: number }).status ?? 1; out = String((e as { stdout?: string }).stdout ?? ""); }
      return { code, out };
    };
    const missing = run(false);
    expect(missing.code, "a dist with no prerendered pages passed the required build").not.toBe(0);
    expect(missing.out).toContain("::error::the offline bake wrote no dist/pricing/index.html");
    expect(run(true).code).toBe(0);
  }, SPAWN_BUDGET);
});

/**
 * GitHub's job condition, for the one shape built-output uses: `!cancelled()`
 * and `needs.<job>.outputs.<name> != '<v>'`. Any other term throws, so a
 * condition this cannot read fails here rather than passing unread.
 */
function jobRuns(job: Job, outputs: Record<string, Record<string, string>>, cancelled = false): boolean {
  if (!job.if) return true;
  const expr = job.if.replace(/^\$\{\{\s*|\s*\}\}$/g, "").trim();
  return expr.split("&&").map((t) => t.trim()).every((t) => {
    if (t === "!cancelled()") return !cancelled;
    const m = /^needs\.([\w-]+)\.outputs\.([\w-]+) != '([^']*)'$/.exec(t);
    if (!m) throw new Error(`a condition this evaluator cannot read: ${t}`);
    return (outputs[m[1]]?.[m[2]] ?? "") !== m[3];
  });
}

describe("built-output runs the live bake on main and on pull requests that change the bake, and nowhere else", () => {
  const job = wf.jobs["built-output"];

  it("waits for bake-scope, and its skip is a job condition, never a workflow path filter", () => {
    expect(job.needs).toBe("bake-scope");
    expect(scopeJob?.outputs?.live).toBe("${{ steps.scope.outputs.live }}");
    for (const ev of Object.values(wf.on ?? {})) {
      const filters = ev && typeof ev === "object" ? Object.keys(ev as object) : [];
      expect(filters.filter((k) => /^paths/.test(k)), "a workflow-level path filter can leave a required check waiting").toEqual([]);
    }
  });

  it("runs when bake-scope says live, is skipped only when it says not, and runs when it could not answer", () => {
    expect(jobRuns(job, { "bake-scope": { live: "true" } })).toBe(true);
    expect(jobRuns(job, { "bake-scope": { live: "false" } })).toBe(false);
    expect(jobRuns(job, { "bake-scope": {} }), "a failed bake-scope must not skip the live bake").toBe(true);
    expect(jobRuns(job, { "bake-scope": { live: "true" } }, true)).toBe(false);
  });

  // The step, run in bash: a fake git answers the diff, the real script reads the real tree.
  const scope = (event: string, gitDiff: string | null): string => {
    const { dir, env } = scratch({
      git: gitDiff === null ? "#!/bin/bash\nexit 128\n" : `#!/bin/bash\n[ "$1" = diff ] && printf '%s\\n' ${gitDiff.split("\n").map((l) => `'${l}'`).join(" ")}\n`,
    });
    const out = join(dir, "github_output");
    writeFileSync(out, "");
    execFileSync("bash", ["-e", "-c", scopeStep!.run!], { cwd: ROOT, env: { ...env, EVENT: event, GITHUB_OUTPUT: out }, stdio: "pipe" });
    return readFileSync(out, "utf8").trim();
  };

  it("a push to main bakes live", () => {
    expect(scope("push", "README.md")).toBe("live=true");
  }, SPAWN_BUDGET);

  it("a pull request that changes no bake input skips the live bake", () => {
    expect(scope("pull_request", "supabase/functions/check-subscription/index.ts\nsrc/pages/Jobs.tsx\ndocs/job-board-deploy-notes.md")).toBe("live=false");
  }, SPAWN_BUDGET);

  it("a pull request that changes the bake, a module it imports, or a guard on dist/ bakes live", () => {
    expect(scope("pull_request", "docs/x.md\nscripts/prerender-seo.mjs")).toBe("live=true");
    expect(scope("pull_request", "src/config/products.ts")).toBe("live=true");
    expect(scope("pull_request", "src/test/sitemap-prerender-parity.test.ts")).toBe("live=true");
  }, SPAWN_BUDGET);

  it("a diff that fails or lists nothing bakes live", () => {
    expect(scope("pull_request", null)).toBe("live=true");
    expect(scope("pull_request", "")).toBe("live=true");
  }, SPAWN_BUDGET);
});

describe("the bake's inputs are computed from the tree", () => {
  const inputs = bakeInputs(ROOT);

  it("every bake script, the build plugin, the template, the env it reads and the workflow itself", () => {
    const scripts = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
    expect(scripts.length).toBeGreaterThan(0);
    for (const f of ["scripts/prerender-seo.mjs", "scripts/prerender-pages.mjs", "vite.config.ts", "index.html", ".env", "package-lock.json", ".github/workflows/ci.yml"]) {
      expect(inputs.files.has(f), f).toBe(true);
    }
  });

  it("every module the bake's data entry names, followed through its own imports", () => {
    const src = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
    const named = [...src.matchAll(/from "\.\.\/((?:src|supabase)\/[^"]+)"/g)].map((m) => m[1]);
    expect(named.length, "the independent read found no data-entry import: it is broken, not the scope").toBeGreaterThan(20);
    for (const n of named) {
      const hit = [n, `${n}.ts`, `${n}.tsx`].some((p) => inputs.files.has(p));
      expect(hit, `${n} is imported by the bake and is not in its scope`).toBe(true);
    }
    // One step deeper than the entry: a module the entry's modules import.
    expect(inputs.files.has("src/lib/listing/apply-url.ts")).toBe(true);
  });

  it("the files the bake reads as text: the legal pages, the catalogue, the locales and the seed lists", () => {
    for (const f of ["src/pages/Terms.tsx", "src/pages/Privacy.tsx", "supabase/functions/job-board/sources.ts"]) expect(inputs.files.has(f), f).toBe(true);
    for (const d of ["src/i18n/locales/", "scripts/seo-seed/", "public/"]) expect(inputs.dirs.has(d), d).toBe(true);
  });

  it("every guard on built output, the same selection the built-output job runs", () => {
    const guards = distGuards(ROOT).map((p: string) => p.slice(ROOT.length + 1));
    expect(guards.length).toBeGreaterThanOrEqual(5);
    for (const g of guards) expect(inputs.files.has(g), g).toBe(true);
    expect(inputs.files.has("src/test/helpers/built-output.ts")).toBe(true);
  });

  it("and not the code the bake never runs", () => {
    expect(bakeTouches(["src/pages/Jobs.tsx", "supabase/functions/check-subscription/index.ts", "worker/src/index.ts", "docs/DEPLOY-LEDGER.md"], inputs)).toEqual([]);
  });

  it("a bake file a pull request deletes still counts, because the bake still names it", () => {
    const dir = mkdtempSync(join(tmpdir(), "bake-scope-root-"));
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "src/test"), { recursive: true });
    writeFileSync(join(dir, "scripts/prerender-seo.mjs"), 'const t = readFileSync(join(root, "src/pages/Gone.tsx"), "utf8");\n');
    expect(bakeVerdict("src/pages/Gone.tsx\n", dir)).toMatchObject({ live: true });
    expect(bakeVerdict("src/pages/Other.tsx\n", dir)).toMatchObject({ live: false });
  });
});
