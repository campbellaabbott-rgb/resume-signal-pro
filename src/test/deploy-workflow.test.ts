/**
 * THE DEPLOY THAT REPORTS SUCCESS AND SHIPS STALE CODE.
 *
 * Twice on 2026-08-07 a deploy completed and the live functions were two
 * versions behind: origin/main held BUILD_VERSION 2026-08-07.3 while job-board
 * answered 2026-08-07.1, because the project copy had stopped pulling from
 * GitHub. Nothing surfaced it. It was caught by hand-diffing the deployed
 * bundle against the repo, twice, and it would have gone unnoticed otherwise.
 *
 * The workflow this file guards exists mostly for its SECOND job. Deploying
 * automatically is convenient; proving what is live matches the commit is the
 * part that closes a hole this project has actually fallen into.
 */
import { describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { parseDocument } from "yaml";

const wf = readFileSync(resolve(__dirname, "../../.github/workflows/deploy.yml"), "utf8");

describe("verification is not optional", () => {
  it("runs even when the deploy job skipped or failed", () => {
    // "Is the live code the code I pushed" is worth answering even when this
    // workflow did not do the deploying — a human Lovable session is still
    // the normal path here.
    expect(wf).toMatch(/needs: deploy\s*\n\s*if: always\(\)/);
  });

  it("waits before reading, so propagation is not mistaken for a stale deploy", () => {
    expect(wf).toMatch(/sleep 45/);
  });
});

/**
 * THE VERIFY STEP, RUN (L12-08). It read SUPABASE_URL / SUPABASE_ANON_KEY from
 * repo secrets that were never set, printed a warning and exited 0 on every
 * push since it was written: a green "verify" that had compared nothing. This
 * runs the step as GitHub does (bash -eo pipefail) against a fake curl, a
 * fixture .env and a fixture job-board BUILD_VERSION, and reads its exit code.
 */
describe("the verify step compares, and cannot pass without comparing", () => {
  type Step = { name?: string; run?: string };
  const steps = ((parseDocument(wf).toJS() as { jobs?: { verify?: { steps?: Step[] } } }).jobs?.verify?.steps ?? []);
  const step = steps.find((s) => /BUILD_VERSION/.test(s.run ?? ""));
  const ENV = 'VITE_SUPABASE_PUBLISHABLE_KEY="pk_test"\nVITE_SUPABASE_URL="https://p.supabase.co"\n';

  function verify(o: { env?: string; repo?: string; live?: string }): { code: number; out: string } {
    if (!step?.run) throw new Error("no BUILD_VERSION comparison step in the verify job");
    const dir = mkdtempSync(join(tmpdir(), "deploy-verify-"));
    mkdirSync(join(dir, "bin"));
    mkdirSync(join(dir, "supabase/functions/job-board"), { recursive: true });
    writeFileSync(join(dir, ".env"), o.env ?? ENV);
    writeFileSync(join(dir, "supabase/functions/job-board/index.ts"), `const BUILD_VERSION = "${o.repo ?? "2026-09-09.92"}";\n`);
    writeFileSync(join(dir, "status.json"), o.live ?? "");
    writeFileSync(join(dir, "bin", "curl"), `#!/bin/bash\ncat "${dir}/status.json"\n`);
    chmodSync(join(dir, "bin", "curl"), 0o755);
    try {
      const out = execFileSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run], { cwd: dir, encoding: "utf8", stdio: "pipe", env: { PATH: `${join(dir, "bin")}:${process.env.PATH}` } });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  }
  const live = (v: string) => JSON.stringify({ version: v, lastSliceAgeMin: 0 });

  it("positive control: production serving this commit's build passes", () => {
    const r = verify({ live: live("2026-09-09.92") });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/Deploy verified/);
  });

  it("a later build in production passes too: this build or later", () => {
    expect(verify({ live: live("2026-09-09.100") }).code).toBe(0);
    expect(verify({ live: live("2026-10-12.1") }).code).toBe(0);
  });

  it("an older build in production fails, naming both builds", () => {
    const r = verify({ live: live("2026-09-09.90") });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/2026-09-09\.90/);
    expect(r.out).toMatch(/2026-09-09\.92/);
    expect(verify({ live: live("2026-09-09.9") }).code, "compared as text, .9 would sort after .92").not.toBe(0);
  });

  it("a version that is not YYYY-MM-DD.N fails as not compared, where a letter sorted after every date and passed", () => {
    for (const v of ["degraded", "job-board.2026-09-09.80", "2026-10-01.x", "2026-09-09"]) {
      const r = verify({ live: live(v) });
      expect(r.code, `live '${v}' was read as this build or later\n${r.out}`).not.toBe(0);
      expect(r.out, v).toMatch(/nothing was compared/);
    }
    const repo = verify({ repo: "next", live: live("2026-09-09.92") });
    expect(repo.code, repo.out).not.toBe(0);
    expect(repo.out).toMatch(/nothing was compared/);
  });

  it("with no URL or key to read, it fails: nothing compared is not verified", () => {
    const r = verify({ env: "OTHER=1\n", live: live("2026-09-09.92") });
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/nothing was compared/);
  });

  it("a status that answers no version, or no JSON, fails", () => {
    expect(verify({ live: "<html>502</html>" }).code).not.toBe(0);
    expect(verify({ live: JSON.stringify({ lastSliceAgeMin: 0 }) }).code).not.toBe(0);
    expect(verify({ live: "" }).code).not.toBe(0);
  });

  it("the committed .env carries the pair the step reads", () => {
    const dotenv = readFileSync(resolve(__dirname, "../../.env"), "utf8");
    expect(dotenv).toMatch(/^VITE_SUPABASE_URL=\S+/m);
    expect(dotenv).toMatch(/^VITE_SUPABASE_PUBLISHABLE_KEY=\S+/m);
  });
});

describe("migrations do not apply themselves", () => {
  it("is manual-dispatch only and needs an explicit confirmation word", () => {
    // A migration that applies itself removes the step where a human reads the
    // error. On 2026-08-07 a migration in this repo silently reverted a
    // documented incident fix; the suite caught it, but that gate is real.
    expect(wf).toMatch(/if: github\.event_name == 'workflow_dispatch' && github\.event\.inputs\.apply_migrations == 'apply'/);
  });

  it("is not triggered by push", () => {
    const migrate = wf.slice(wf.indexOf("  migrate:"));
    expect(migrate).not.toMatch(/on:\s*\n\s*push/);
  });
});

describe("the deploy itself", () => {
  it("deploys ALL functions, never one", () => {
    // 2026-08-03: a single-function deploy was followed by 79 of 80 functions
    // returning NOT_FOUND_FUNCTION_BLOB — an eight-minute outage covering every
    // checkout path and the scanner.
    expect(wf).toMatch(/supabase functions deploy --project-ref/);
    expect(wf).not.toMatch(/functions deploy [a-z-]+ --project-ref/);
  });

  it("skips with a notice when unconfigured instead of failing", () => {
    expect(wf).toMatch(/ready=false/);
    expect(wf).toMatch(/::notice title=Deploy skipped::/);
  });

  it("serialises runs so two deploys cannot race", () => {
    expect(wf).toMatch(/concurrency:\s*\n\s*#[^\n]*\n\s*#[^\n]*\n\s*group: deploy-main/);
    expect(wf).toMatch(/cancel-in-progress: false/);
  });
});
