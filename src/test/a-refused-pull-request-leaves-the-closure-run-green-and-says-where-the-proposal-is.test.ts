// @vitest-environment node
/**
 * A REFUSED PULL REQUEST LEAVES THE CLOSURE RUN GREEN AND SAYS WHERE THE
 * PROPOSAL IS (review of 2026-11-21, on STRUCTURED-B1 part 2).
 *
 * The daily closure check commits its proposal to posting-closure/next-publish
 * and opens one pull request from it. In this repository "Allow GitHub Actions
 * to create and approve pull requests" is off (the workflow permissions API
 * answers default_workflow_permissions "read" and
 * can_approve_pull_request_reviews false), so GitHub refuses the workflow's
 * token a new pull request whatever `pull-requests: write` says. The step ran
 * under the default `bash -e` with no fallback, so every run that measured
 * anything failed after sending the branch, and a run failing for that read
 * like the STOP rule's alarm. Turning the setting on is the owner's call (it
 * also lets workflows approve pull requests); until then the step says where
 * the proposal is and succeeds.
 *
 * Held by running the step's own script, taken from the workflow file, under
 * GitHub's two bash invocations, with `git`, `gh` and `node` stubbed: the
 * stubs write nothing anywhere but this test's temporary directory.
 */
import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const WORKFLOW = parse(readFileSync(resolve(__dirname, "../../.github/workflows/posting-closure.yml"), "utf8")) as {
  jobs: { check: { steps: Array<{ name?: string; run?: string; if?: string }> } };
};
const STEP = WORKFLOW.jobs.check.steps.find((s) => /^Propose the closed pages/.test(s.name ?? ""));
const REPO = "owner/repo";
const COMPARE = `https://github.com/${REPO}/compare/main...posting-closure/next-publish?expand=1`;
const REFUSAL = "pull request create failed: GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)";
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

// Each stub appends its arguments to calls.log; `gh` answers as STUB_* says.
const GIT = `#!/bin/sh
echo "git $*" >> "$CALLS"
case "$1" in
  diff) exit 1;;
  push) [ -n "$STUB_PUSH_REFUSED" ] && { echo "remote: Permission denied" >&2; exit 1; }; exit 0;;
  *) exit 0;;
esac
`;
const GH = `#!/bin/sh
echo "gh $*" >> "$CALLS"
case "$1 $2" in
  "pr list") [ -n "$STUB_OPEN_PR" ] && echo "$STUB_OPEN_PR"; exit 0;;
  "pr create") if [ -n "$STUB_PR_REFUSED" ]; then echo "${REFUSAL}" >&2; exit 1; fi; echo "https://github.com/${REPO}/pull/90"; exit 0;;
  "issue list") [ -n "$STUB_OPEN_ISSUE" ] && echo "$STUB_OPEN_ISSUE"; exit 0;;
  *) exit 0;;
esac
`;
const NODE = `#!/bin/sh
echo "node $*" >> "$CALLS"
exit 0
`;

function runStep(shell: string[], stub: Record<string, string>) {
  expect(STEP?.run, "the proposal step and its script").toBeTruthy();
  const dir = mkdtempSync(join(tmpdir(), "closure-pr-"));
  dirs.push(dir);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  for (const [name, body] of [["git", GIT], ["gh", GH], ["node", NODE]] as const) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  mkdirSync(join(dir, ".posting-closure"));
  writeFileSync(join(dir, ".posting-closure", "closed-today.txt"), "/jobs/posting/workday/pnc~wd5~External/R217438-1 2026-11-21 employer\n");
  writeFileSync(join(dir, ".posting-closure", "employer-stated.txt"), "/jobs/posting/greenhouse/acme/1 2026-11-21T02:41Z open -\n");
  writeFileSync(join(dir, "step.sh"), STEP!.run!);
  writeFileSync(join(dir, "summary.md"), "");
  writeFileSync(join(dir, "calls.log"), "");
  const r = spawnSync(shell[0], [...shell.slice(1), join(dir, "step.sh")], {
    cwd: dir,
    encoding: "utf8",
    timeout: 20_000,
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: dir,
      CALLS: join(dir, "calls.log"),
      GITHUB_REPOSITORY: REPO,
      GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
      GH_TOKEN: "stub",
      RUN_LABEL: "run 44431382185",
      ...stub,
    },
  });
  return {
    status: r.status,
    stdout: r.stdout,
    summary: readFileSync(join(dir, "summary.md"), "utf8"),
    calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean),
  };
}

// GitHub runs a `run:` with no `shell:` as `bash -e {0}`, and `shell: bash` as below.
const SHELLS = [["bash", "-e"], ["bash", "--noprofile", "--norc", "-eo", "pipefail"]];

describe.each(SHELLS)("the proposal step under %s %s", (...shell) => {
  it("succeeds when GitHub refuses the pull request, with the branch still sent", () => {
    const r = runStep(shell, { STUB_PR_REFUSED: "1", STUB_OPEN_ISSUE: "7" });
    expect(r.status, r.stdout + r.calls.join("\n")).toBe(0);
    expect(r.calls).toContain('git push -q --force origin HEAD:refs/heads/posting-closure/next-publish');
    expect(r.calls.some((c) => c.startsWith("gh pr create "))).toBe(true);
  });

  it("puts the refusal and the link to open the pull request by hand in the run summary and a warning", () => {
    const r = runStep(shell, { STUB_PR_REFUSED: "1", STUB_OPEN_ISSUE: "7" });
    expect(r.summary).toContain("### Posting closure proposal");
    expect(r.summary).toContain("GitHub refused to open the pull request for this run's proposal (run 44431382185: pull request create failed: GraphQL: GitHub Actions is not permitted");
    expect(r.summary).toContain(COMPARE);
    expect(r.stdout).toMatch(/^::warning title=Posting closure proposal::GitHub refused to open the pull request/m);
  });

  it("tells the standing issue, or opens it when none is open", () => {
    const told = runStep(shell, { STUB_PR_REFUSED: "1", STUB_OPEN_ISSUE: "7" });
    const comment = told.calls.find((c) => c.startsWith("gh issue comment 7 "));
    expect(comment, told.calls.join("\n")).toBeTruthy();
    expect(comment).toContain(COMPARE);
    const opened = runStep(shell, { STUB_PR_REFUSED: "1" });
    expect(opened.status).toBe(0);
    const create = opened.calls.find((c) => c.startsWith("gh issue create "));
    expect(create, opened.calls.join("\n")).toBeTruthy();
    expect(create).toContain("--label posting-closure-closed");
    expect(create).toContain(COMPARE);
  });

  it("succeeds and says so when the branch itself cannot be sent", () => {
    const r = runStep(shell, { STUB_PUSH_REFUSED: "1", STUB_OPEN_ISSUE: "7" });
    expect(r.status).toBe(0);
    expect(r.calls.some((c) => c.startsWith("gh pr "))).toBe(false);
    expect(r.summary).toContain("could not be sent to branch posting-closure/next-publish");
  });

  it("opens the pull request and warns of nothing when GitHub allows it", () => {
    const r = runStep(shell, {});
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`https://github.com/${REPO}/pull/90`);
    expect(r.stdout).not.toMatch(/::warning/);
    expect(r.summary).toBe("");
    expect(r.calls.some((c) => c.startsWith("gh issue "))).toBe(false);
  });

  it("updates an open pull request rather than opening another", () => {
    const r = runStep(shell, { STUB_OPEN_PR: "88", STUB_PR_REFUSED: "1" });
    expect(r.status).toBe(0);
    expect(r.calls.some((c) => c.startsWith("gh pr comment 88 "))).toBe(true);
    expect(r.calls.some((c) => c.startsWith("gh pr create "))).toBe(false);
    expect(r.summary).toBe("");
  });
});

describe("the run's own verdict", () => {
  it("is still what fails it: the last step fails exactly when the check needs attention", () => {
    const last = WORKFLOW.jobs.check.steps[WORKFLOW.jobs.check.steps.length - 1];
    expect(last.if).toBe("steps.check.outputs.failed != ''");
    expect(last.run).toMatch(/exit 1\s*$/);
    expect(STEP?.if).toBe("always() && steps.check.outputs.code != '2'");
  });
});
