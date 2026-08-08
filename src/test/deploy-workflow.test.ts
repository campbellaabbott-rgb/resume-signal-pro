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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const wf = readFileSync(resolve(__dirname, "../../.github/workflows/deploy.yml"), "utf8");

describe("verification is not optional", () => {
  it("runs even when the deploy job skipped or failed", () => {
    // "Is the live code the code I pushed" is worth answering even when this
    // workflow did not do the deploying — a human Lovable session is still
    // the normal path here.
    expect(wf).toMatch(/needs: deploy\s*\n\s*if: always\(\)/);
  });

  it("compares the LIVE version against the repo, and fails on mismatch", () => {
    expect(wf).toMatch(/EXPECTED=\$\(grep -m1 -oE 'BUILD_VERSION/);
    expect(wf).toMatch(/if \[ "\$LIVE" != "\$EXPECTED" \]; then/);
    expect(wf).toMatch(/exit 1/);
  });

  it("waits before reading, so propagation is not mistaken for a stale deploy", () => {
    expect(wf).toMatch(/sleep 45/);
  });

  it("degrades to a warning when it cannot measure, rather than a false pass", () => {
    // No credentials means UNKNOWN, not OK. But it must not fail the run
    // either — an unconfigured pipeline that is permanently red teaches people
    // to ignore red.
    expect(wf).toMatch(/cannot verify what is live/);
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
