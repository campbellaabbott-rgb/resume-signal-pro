/**
 * The only test that presses submit has to be attached to a gate.
 *
 * worker/src/harness.ts drives the REAL applyToPosting through an actual click
 * and classifies all six outcomes. Nothing invoked it. No test imported it, no
 * hook ran it — so the branch that decides whether a person's application is
 * recorded as SENT was last executed by hand in July.
 *
 * Everything else that looks like coverage stops short of the button.
 * vendor-adapters, broker-contract and the fixtures compare selectors and field
 * names against recordings. None of them submit, wait for the page to settle,
 * or run confirmed().
 *
 * THE BUG IT CATCHES ALREADY HAPPENED. "Thank you for your interest in this
 * role" is ordinary job-ad copy that sits on the form page, so a submit that
 * FAILED matched the phrase list and was recorded as sent — the application
 * silently lost, and the duplicate guard then blocking the candidate from
 * applying properly. Reintroducing it (checking phrases before visibility in
 * classifyConfirmation) makes the harness report
 *
 *   FAIL  failed submit that says 'thank you' -> submitted (expected not-submitted)
 *
 * so the guard has teeth against the exact historical fault.
 *
 * WHY THIS GUARDS scripts/hooks AND NOT .git/hooks: .git/hooks is untracked, so
 * a fix living only there is invisible to review and gone on a fresh clone —
 * the same shape as the .git/info/exclude fault that hid both workflow files.
 * The tracked file is the source of truth; the installed copy is a build
 * artifact of `npm run prepare`, and a tracked fix nobody installed fails
 * exactly like a fix nobody wrote.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const hook = readFileSync(resolve(root, "scripts/hooks/pre-push"), "utf8");
const workerPkg = JSON.parse(readFileSync(resolve(root, "worker/package.json"), "utf8"));

describe("the apply-driver harness is wired to a gate", () => {
  it("the worker exposes it as a script", () => {
    expect(workerPkg.scripts?.harness, "worker/package.json lost its harness script")
      .toMatch(/harness\.ts/);
  });

  it("the pre-push hook runs it", () => {
    expect(hook, "pre-push no longer runs the apply-driver harness")
      .toMatch(/npm run --silent harness/);
  });

  it("it is scoped to worker changes, so a docs push stays fast", () => {
    // 40s and six browsers. Scoped to worker/ rather than worker/src/ so that
    // dropping a dependency in worker/package.json still triggers it — the
    // adapters can break without a line of worker/src changing.
    expect(hook).toMatch(/grep -qE '\^worker\/'/);
  });

  it("the installed hook matches the tracked source", () => {
    const installed = resolve(root, ".git/hooks/pre-push");
    if (!existsSync(installed)) return; // fresh clone, before `npm install`
    expect(readFileSync(installed, "utf8"),
      "run `npm run prepare` — .git/hooks/pre-push has drifted from scripts/hooks/pre-push")
      .toBe(hook);
  });
});
