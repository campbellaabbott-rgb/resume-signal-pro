// @vitest-environment node
/**
 * A RED TEST STEP HID THE BUILD AND THE HARNESS, AND THE GUARDS ON BUILT
 * OUTPUT SKIPPED ON EVERY RUN.
 *
 * .github/workflows/ci.yml, as it stood on 2026-10-10 (L12-02, L12-10, L12-11):
 *   - every step ran only if every step before it had passed, and 15 of main's
 *     last 20 runs were red at the test step, so on those commits the
 *     production build and the apply-driver harness never ran at all;
 *   - the worker's install was `npm ci || npm install`, which papered over a
 *     package.json / package-lock.json drift that failed the bot-wall sweep
 *     every week;
 *   - vitest ran before the build, so the five suites that read dist/ skipped
 *     on every run and the sitemap guards had never executed anywhere;
 *   - nothing ran the 62 Deno tests beside the edge functions.
 *
 * This file reads the workflow as GitHub does (parsed, not grepped) and runs
 * what can be run: the step conditions through a small evaluator of the one
 * expression shape the file uses, the worker install and the built-output
 * selection in bash against fakes.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { DIST_REQUIRED, skipWithoutDist } from "./helpers/built-output";

const ROOT = resolve(__dirname, "../..");
const doc = parseDocument(readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8"));
type Step = { name?: string; id?: string; if?: string; run?: string; uses?: string; env?: Record<string, string>; ["working-directory"]?: string };
type Job = { steps?: Step[] };
const wf = (doc.errors.length ? {} : doc.toJS()) as { jobs?: Record<string, Job> };
const jobs = wf.jobs ?? {};
const testSteps = jobs.test?.steps ?? [];
const label = (s: Step) => s.name ?? s.uses ?? s.run ?? "?";

/**
 * GitHub's step condition, for the one shape this workflow uses: terms joined
 * by &&, each `!cancelled()` or `steps.<id>.outcome == 'success'`. No `if` is
 * `success()`: every earlier step passed. Any other term throws, so a future
 * condition this evaluator cannot read fails here rather than passing unread.
 */
function runs(step: Step, outcome: Record<string, "success" | "failure" | "skipped">, anyFailed: boolean): boolean {
  if (!step.if) return !anyFailed;
  const expr = step.if.replace(/^\$\{\{\s*|\s*\}\}$/g, "").trim();
  return expr.split("&&").map((t) => t.trim()).every((t) => {
    if (t === "!cancelled()") return true;
    const m = /^steps\.([\w-]+)\.outcome == 'success'$/.exec(t);
    if (!m) throw new Error(`a condition this evaluator cannot read: ${t}`);
    return outcome[m[1]] === "success";
  });
}

/** Walk the job with one step forced to fail; return the steps that did not run. */
function skippedAfter(failing: string): string[] {
  const outcome: Record<string, "success" | "failure" | "skipped"> = {};
  let anyFailed = false;
  const skipped: string[] = [];
  for (const s of testSteps) {
    if (!runs(s, outcome, anyFailed)) { skipped.push(label(s)); if (s.id) outcome[s.id] = "skipped"; continue; }
    const failed = label(s) === failing;
    if (s.id) outcome[s.id] = failed ? "failure" : "success";
    anyFailed ||= failed;
  }
  return skipped;
}

const CHECKS = ["Typecheck", "Edge functions syntax check", "Tests (includes golden detection corpus)", "Production build", "Apply-driver harness (six outcomes, past the click)"];

describe("ci.yml is a workflow GitHub can read", () => {
  it("parses, and has the test, deno-tests and built-output jobs", () => {
    expect(doc.errors.map((e) => e.message)).toEqual([]);
    expect(Object.keys(jobs)).toEqual(expect.arrayContaining(["test", "deno-tests", "built-output"]));
  });
});

describe("a failing check does not hide the checks after it", () => {
  it("positive control: with nothing failing, every step runs", () => {
    expect(skippedAfter("(none)")).toEqual([]);
  });

  for (const failing of CHECKS) {
    it(`with "${failing}" red, every other check still runs`, () => {
      expect(testSteps.map(label), "the check is no longer in the job").toContain(failing);
      const hidden = skippedAfter(failing).filter((s) => CHECKS.includes(s));
      expect(hidden, `a red "${failing}" hid these checks`).toEqual([]);
    });
  }

  it("but a failed install still stops the checks that need it, rather than failing them noisily", () => {
    const deps = testSteps.find((s) => s.id === "deps");
    expect(deps, "no install step with id deps").toBeTruthy();
    const hidden = skippedAfter(label(deps!));
    expect(hidden).toEqual(expect.arrayContaining(["Typecheck", "Tests (includes golden detection corpus)", "Production build"]));
  });
});

describe("the worker's install refuses a lockfile that disagrees with package.json", () => {
  it("runs the step against an npm whose `ci` refuses: the step fails, it does not fall back", () => {
    const step = testSteps.find((s) => s["working-directory"] === "worker" && /npm/.test(s.run ?? "") && !/playwright/.test(s.run ?? ""));
    expect(step, "no worker install step").toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), "ci-worker-"));
    mkdirSync(join(dir, "bin"));
    // A fake npm: `ci` refuses the way npm does on a drifted lock; anything else succeeds.
    writeFileSync(join(dir, "bin", "npm"), '#!/bin/bash\n[ "$1" = "ci" ] && { echo "npm error code EUSAGE" >&2; exit 1; }\nexit 0\n');
    chmodSync(join(dir, "bin", "npm"), 0o755);
    let code = 0;
    try {
      execFileSync("bash", ["-e", "-c", step!.run!], { cwd: dir, env: { PATH: `${join(dir, "bin")}:${process.env.PATH}` }, stdio: "pipe" });
    } catch (e) { code = (e as { status?: number }).status ?? 1; }
    expect(code, "the worker install passed over an npm ci refusal").not.toBe(0);
  });
});

describe("the Deno tests run in CI", () => {
  it("a job runs scripts/deno-tests.sh after installing Deno", () => {
    const steps = jobs["deno-tests"]?.steps ?? [];
    const setup = steps.findIndex((s) => /^denoland\/setup-deno@/.test(s.uses ?? ""));
    const run = steps.findIndex((s) => /bash scripts\/deno-tests\.sh/.test(s.run ?? ""));
    expect(setup).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(setup);
  });

  // Run 38174026636: the job had Deno and no node deps, so the layoff mirror's
  // parity test failed on "Cannot find module 'tsx/cjs/api'" and the check
  // never ran in CI. The job installs what that child process needs first.
  it("the job installs node and the root deps before the tests, because one Deno test runs node through tsx", () => {
    const steps = jobs["deno-tests"]?.steps ?? [];
    const node = steps.findIndex((s) => /^actions\/setup-node@/.test(s.uses ?? ""));
    const install = steps.findIndex((s) => /^npm ci\b/.test(s.run ?? ""));
    const run = steps.findIndex((s) => /bash scripts\/deno-tests\.sh/.test(s.run ?? ""));
    expect(node, "the deno-tests job sets up no node").toBeGreaterThan(-1);
    expect(install, "the deno-tests job installs no node deps").toBeGreaterThan(node);
    expect(run).toBeGreaterThan(install);
    // The need is real: drop it here only when no Deno test shells out to node and tsx any more.
    expect(readFileSync(resolve(ROOT, "scripts/deno-tests.sh"), "utf8")).toMatch(/--allow-run=node/);
    expect(readFileSync(resolve(ROOT, "supabase/functions/layoff-filings/mirror_test.ts"), "utf8")).toMatch(/new Deno\.Command\("node", \{\s*args: \["scripts\/layoff-board-names-mirror\.mjs", "--emit"\]/);
    expect(readFileSync(resolve(ROOT, "scripts/layoff-board-names-mirror.mjs"), "utf8")).toMatch(/require\("tsx\/cjs\/api"\)/);
  });

  it("the script hands Deno only the *_test.ts files, never the vitest files beside them", () => {
    const src = readFileSync(resolve(ROOT, "scripts/deno-tests.sh"), "utf8");
    const dir = mkdtempSync(join(tmpdir(), "deno-tests-"));
    mkdirSync(join(dir, "bin"));
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "supabase/functions/fn"), { recursive: true });
    writeFileSync(join(dir, "supabase/functions/fn/a_test.ts"), "");
    writeFileSync(join(dir, "supabase/functions/fn/b.test.ts"), "");
    writeFileSync(join(dir, "scripts/deno-tests.sh"), src);
    writeFileSync(join(dir, "bin", "deno"), `#!/bin/bash\nprintf '%s\\n' "$@" > "${dir}/argv"\n`);
    chmodSync(join(dir, "bin", "deno"), 0o755);
    execFileSync("bash", [join(dir, "scripts/deno-tests.sh")], { env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, HOME: dir } });
    const argv = readFileSync(join(dir, "argv"), "utf8").split("\n");
    expect(argv).toContain("supabase/functions/fn/a_test.ts");
    expect(argv).not.toContain("supabase/functions/fn/b.test.ts");
  });
});

describe("the guards on built output run, after a build, instead of skipping", () => {
  const steps = jobs["built-output"]?.steps ?? [];
  const build = steps.findIndex((s) => /npm run build/.test(s.run ?? ""));
  const guard = steps.findIndex((s) => /vitest run/.test(s.run ?? ""));

  it("the job builds first, then runs the guards with RB_REQUIRE_DIST=1", () => {
    expect(build).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(build);
    expect(steps[guard].env?.RB_REQUIRE_DIST).toBe("1");
  });

  it("its file selection, run, picks every suite that reads dist/ -- and nothing else", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-built-"));
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "npx"), `#!/bin/bash\nprintf '%s\\n' "$@" > "${dir}/argv"\n`);
    chmodSync(join(dir, "bin", "npx"), 0o755);
    execFileSync("bash", ["-e", "-c", steps[guard].run!], { cwd: ROOT, env: { PATH: `${join(dir, "bin")}:${process.env.PATH}` }, stdio: "pipe" });
    const picked = readFileSync(join(dir, "argv"), "utf8").split("\n").filter((a) => a.startsWith("src/test/")).map((a) => a.replace("src/test/", "")).sort();
    // Independently: every test file that skips on the presence of something under dist/.
    const T = resolve(ROOT, "src/test");
    const readsDist = readdirSync(T)
      .filter((f) => /\.test\.tsx?$/.test(f))
      .filter((f) => { const s = readFileSync(join(T, f), "utf8"); return /skipIf\(/.test(s) && /["'/]dist\//.test(s); })
      .sort();
    expect(readsDist.length, "the independent scan found no dist/ guard: it is broken, not the workflow").toBeGreaterThanOrEqual(5);
    expect(picked).toEqual(readsDist);
  });

  it("a missing dist/ is a skip only where nobody required the build", () => {
    expect(skipWithoutDist(true, false)).toBe(false);
    expect(skipWithoutDist(true, true)).toBe(false);
    expect(skipWithoutDist(false, false)).toBe(true);
    expect(skipWithoutDist(false, true), "required, and absent: the suite must run and fail").toBe(false);
    expect(DIST_REQUIRED).toBe(process.env.RB_REQUIRE_DIST === "1");
  });
});
