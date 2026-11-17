// @vitest-environment node
//
// Node, not jsdom: this file runs scripts/check-functions.sh in bash against a
// fake deno, through child_process.
/**
 * CI NEVER TYPE-CHECKED AN EDGE FUNCTION (S14X-136).
 *
 * `deno check` ran only in the local pre-push hook (scripts/hooks/pre-push,
 * through npm run check:functions). CI's deno-tests job ran `deno test`, which
 * checks the test modules and what they import and nothing else: an entry
 * point or a _shared module no test reaches could carry a type error (the
 * class that took the production scan down on 2026-07-05) through every CI
 * run, as long as the push came from a machine without the hook, or with
 * --no-verify.
 *
 * Now the deno-tests job runs the same gate after installing Deno, with
 * --check-only so it does not run the Deno tests a second time (the job's
 * next step runs them), and each of the two steps runs whatever the other
 * said. The flag is proven here against a fake deno: it stops after the
 * typecheck, and without it the gate still runs the tests.
 */
import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";

const ROOT = resolve(__dirname, "../..");
type Step = { name?: string; uses?: string; run?: string; id?: string; if?: string };
const ci = parseDocument(readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8")).toJS() as { jobs?: Record<string, { steps?: Step[]; "timeout-minutes"?: number }> };
const job = ci.jobs?.["deno-tests"];
const steps = job?.steps ?? [];

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe("the deno-tests job typechecks every edge function", () => {
  const setup = steps.findIndex((s) => /^denoland\/setup-deno@/.test(s.uses ?? ""));
  const check = steps.findIndex((s) => /(^|\s)bash scripts\/check-functions\.sh --check-only\s*$/.test(s.run ?? ""));
  const tests = steps.findIndex((s) => /bash scripts\/deno-tests\.sh/.test(s.run ?? ""));

  it("runs scripts/check-functions.sh --check-only once Deno is installed, before the tests", () => {
    expect(setup, "the deno-tests job installs no Deno").toBeGreaterThan(-1);
    expect(check, "the deno-tests job has no step that runs scripts/check-functions.sh --check-only").toBeGreaterThan(setup);
    expect(tests).toBeGreaterThan(check);
  });

  it("each of the two steps runs whatever the other said, and only once Deno installed", () => {
    const denoId = steps[setup]?.id;
    expect(denoId, "the setup-deno step needs an id for the steps to read its outcome").toBeTruthy();
    for (const i of [check, tests]) {
      const cond = String(steps[i]?.if ?? "");
      expect(cond, `${steps[i]?.name}: a failure in the other step would skip it`).toMatch(/!cancelled\(\)/);
      expect(cond, `${steps[i]?.name}: it does not wait for Deno`).toContain(`steps.${denoId}.outcome == 'success'`);
    }
  });

  it("has room for about a hundred entry points checked one at a time", () => {
    expect(Number(job?.["timeout-minutes"] ?? 0)).toBeGreaterThanOrEqual(30);
  });
});

/** A checkout holding the gate, two functions, a fake deno and a deno-tests.sh that leaves a mark when run. */
function checkout(o: { broken?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "check-functions-"));
  dirs.push(dir);
  for (const d of ["bin", "scripts", "supabase/functions/alpha", "supabase/functions/beta", "supabase/functions/_shared"]) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, "scripts/check-functions.sh"), readFileSync(resolve(ROOT, "scripts/check-functions.sh"), "utf8"));
  writeFileSync(join(dir, "scripts/deno-tests.sh"), `#!/bin/bash\ntouch "${join(dir, "tests-ran")}"\n`);
  writeFileSync(join(dir, "supabase/functions/deno.json"), "{}");
  writeFileSync(join(dir, "supabase/functions/alpha/index.ts"), "export {};\n");
  writeFileSync(join(dir, "supabase/functions/alpha/thing_test.ts"), "export {};\n");
  writeFileSync(join(dir, "supabase/functions/beta/index.ts"), "export {};\n");
  writeFileSync(join(dir, "supabase/functions/_shared/x.ts"), "export {};\n");
  // The fake deno logs what it was asked to check and refuses the broken file.
  const broken = o.broken ? `case "$*" in *${o.broken}*) echo "ERROR TS2448 in ${o.broken}"; exit 1;; esac\n` : "";
  writeFileSync(join(dir, "bin/deno"), `#!/bin/bash\necho "$*" >> "${join(dir, "deno.log")}"\n${broken}exit 0\n`);
  chmodSync(join(dir, "bin/deno"), 0o755);
  return dir;
}
function gate(dir: string, args: string[]) {
  try {
    const out = execFileSync("bash", ["scripts/check-functions.sh", ...args], { cwd: dir, encoding: "utf8", stdio: "pipe", env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, HOME: dir } });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}
const checked = (dir: string) => (existsSync(join(dir, "deno.log")) ? readFileSync(join(dir, "deno.log"), "utf8") : "");

describe("--check-only typechecks and stops", () => {
  it("checks every entry point and every *_test.ts, then exits without running the Deno tests", () => {
    const dir = checkout();
    const r = gate(dir, ["--check-only"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/OK: all non-excluded edge functions typecheck clean/);
    const log = checked(dir);
    for (const f of ["alpha//index.ts", "alpha/thing_test.ts", "beta//index.ts"]) expect(log, f).toContain(f);
    expect(log, "_shared has no entry point of its own").not.toMatch(/_shared/);
    expect(existsSync(join(dir, "tests-ran")), "--check-only ran the Deno tests").toBe(false);
  });

  it("positive control: without the flag the gate still runs the Deno tests after the typecheck", () => {
    const dir = checkout();
    const r = gate(dir, []);
    expect(r.code, r.out).toBe(0);
    expect(existsSync(join(dir, "tests-ran"))).toBe(true);
  });

  it("a function that fails deno check fails the step and is named, flag or not", () => {
    const dir = checkout({ broken: "beta//index.ts" });
    const r = gate(dir, ["--check-only"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL: beta/);
    expect(r.out).toMatch(/1 function\(s\) failed deno check/);
    expect(existsSync(join(dir, "tests-ran"))).toBe(false);
  });

  it("an argument it does not know is refused, not read as the full gate", () => {
    const dir = checkout();
    const r = gate(dir, ["--checkonly"]);
    expect(r.code).toBe(2);
    expect(checked(dir)).toBe("");
  });
});
