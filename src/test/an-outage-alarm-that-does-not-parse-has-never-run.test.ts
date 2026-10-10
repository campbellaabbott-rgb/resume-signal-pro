/**
 * AN OUTAGE ALARM THAT DOES NOT PARSE HAS NEVER RUN.
 *
 * .github/workflows/board-health.yml was the board's only alarm that lives
 * outside the system it watches. From 2026-08-12 to 2026-10-08 it ran zero
 * times: inline python in two `run: |` blocks started its try:/except lines at
 * column 0, which ends a YAML block scalar, so GitHub could not read the file,
 * never saw the schedule, and recorded 561 push-triggered 0-second failures
 * named after the file path. The guard over it (instrument-recovery.test.ts)
 * matched spellings in the raw text, and every spelling was present.
 *
 * Three more defects sat behind the parse error, each one a way for the probe
 * to call a dead board healthy or to fail to say so:
 *   - a missing or null lastSliceAgeMin printed "None", `[ None -gt 360 ]`
 *     errored, and the error read as a pass;
 *   - lastSliceAgeMin is stamped when a slice is ADMITTED, so slices admitted
 *     and then killed read young for ever;
 *   - `gh issue create --label board-health` fails when the label does not
 *     exist, and nothing created it.
 *
 * So this file parses the workflow as GitHub would, and then RUNS its two
 * scripts in bash against a fake curl and a fake gh, asserting what each one
 * writes. It needs bash and jq, which every GitHub runner and this repo's Macs
 * have.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { parseDocument } from "yaml";

const WF = readFileSync(resolve(__dirname, "../../.github/workflows/board-health.yml"), "utf8");
const doc = parseDocument(WF);

type Step = { name?: string; id?: string; if?: string; run?: string };
type Workflow = {
  on?: { schedule?: Array<{ cron?: string }>; workflow_dispatch?: unknown };
  jobs?: { probe?: { steps?: Step[] } };
};
const wf = (doc.errors.length ? {} : doc.toJS()) as Workflow;
const steps = wf.jobs?.probe?.steps ?? [];
const stepNamed = (re: RegExp) => steps.find((s) => re.test(s.name ?? ""));

describe("the workflow is a workflow GitHub can read", () => {
  it("parses with no errors", () => {
    expect(doc.errors.map((e) => e.message), "board-health.yml does not parse, so it can never run").toEqual([]);
  });

  it("carries a schedule GitHub can fire unattended, read from the parsed file", () => {
    const cron = wf.on?.schedule?.[0]?.cron ?? "";
    expect(cron, "no on.schedule[0].cron in the parsed workflow").toMatch(/^\S+ \* \* \* \*$/);
    const minute = cron.split(" ")[0];
    const perHour = minute === "*" ? 60 : minute.startsWith("*/") ? 60 / Number(minute.slice(2)) : minute.split(",").length;
    // Faster than its own 6-hour threshold, slower than every 5 minutes.
    expect(perHour).toBeGreaterThanOrEqual(1);
    expect(perHour).toBeLessThanOrEqual(12);
    expect(wf.on && "workflow_dispatch" in wf.on, "it can no longer be run by hand").toBe(true);
  });

  it("has the probe, the alarm, and a step that fails the run, in that order", () => {
    const probe = steps.findIndex((s) => s.id === "probe");
    const alarm = steps.findIndex((s) => /alarm/i.test(s.name ?? ""));
    const fail = steps.findIndex((s) => /fail the run/i.test(s.name ?? ""));
    expect(probe, "no step with id probe").toBeGreaterThan(-1);
    expect(alarm).toBeGreaterThan(probe);
    expect(fail).toBeGreaterThan(alarm);
    for (const i of [alarm, fail]) expect(steps[i].if).toBe("steps.probe.outputs.failed != ''");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Running the scripts. A fake `curl` answers the board request and the status
// request from two fixture files; a fake `gh` records its argv. GITHUB_OUTPUT
// is a real file, read back as key=value lines.
// ─────────────────────────────────────────────────────────────────────────────

let dir = "";
const FAKE_CURL = `#!/bin/bash
for a in "$@"; do case "$a" in *'"action":"status"'*) cat "$FIX_STATUS"; exit 0;; esac; done
cat "$FIX_BOARD"
`;
const FAKE_GH = `#!/bin/bash
printf '%s\\n' "$(printf '%s' "$*" | tr '\\n' ' ')" >> "$GH_LOG"
case "$1 $2" in "issue list") echo "";; esac
exit 0
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "board-health-"));
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  writeFileSync(join(dir, "bin", "gh"), FAKE_GH);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  chmodSync(join(dir, "bin", "gh"), 0o755);
});
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const HEALTHY_STATUS = { lastSliceAgeMin: 0, sliceStats: { workAt: minutesAgo(4) } };

function runProbe(board: string, status: string, env = 'VITE_SUPABASE_PUBLISHABLE_KEY="pk_test"\n') {
  const run = stepNamed(/probe the board/i)?.run;
  if (!run) throw new Error("no probe script in the parsed workflow");
  const case_ = mkdtempSync(join(dir, "case-"));
  writeFileSync(join(case_, ".env"), env);
  writeFileSync(join(case_, "board.json"), board);
  writeFileSync(join(case_, "status.json"), status);
  writeFileSync(join(case_, "out"), "");
  execFileSync("bash", ["-c", run], {
    cwd: case_,
    encoding: "utf8",
    env: {
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      GITHUB_OUTPUT: join(case_, "out"),
      SB_URL: "https://example.invalid",
      FIX_BOARD: join(case_, "board.json"),
      FIX_STATUS: join(case_, "status.json"),
    },
  });
  const out: Record<string, string> = {};
  for (const line of readFileSync(join(case_, "out"), "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

describe("the probe fails on every state that is not a breathing board", () => {
  it("positive control: a board with a total and both stamps young is healthy", () => {
    const out = runProbe(JSON.stringify({ total: 712_232 }), JSON.stringify(HEALTHY_STATUS));
    expect(out.failed, out.note).toBe("");
  });

  it("a status with a null slice age is a failure, not a pass", () => {
    const out = runProbe(JSON.stringify({ total: 712_232 }), JSON.stringify({ ...HEALTHY_STATUS, lastSliceAgeMin: null }));
    expect(out.failed).toBe("probe");
    expect(out.note).toMatch(/slice age/);
  });

  it("a status with no slice age at all is a failure", () => {
    const out = runProbe(JSON.stringify({ total: 712_232 }), JSON.stringify({ sliceStats: HEALTHY_STATUS.sliceStats }));
    expect(out.failed).toBe("probe");
  });

  it("a slice admitted a minute ago whose last finished work is seven hours old is a dead pipeline", () => {
    const out = runProbe(
      JSON.stringify({ total: 712_232 }),
      JSON.stringify({ lastSliceAgeMin: 1, sliceStats: { workAt: minutesAgo(7 * 60) } }),
    );
    expect(out.failed).toBe("probe");
    expect(out.note).toMatch(/finish its work/);
  });

  it("a slice admitted seven hours ago is a dead scheduler", () => {
    const out = runProbe(JSON.stringify({ total: 712_232 }), JSON.stringify({ ...HEALTHY_STATUS, lastSliceAgeMin: 421 }));
    expect(out.failed).toBe("probe");
    expect(out.note).toMatch(/421 minutes/);
  });

  it("a board that answers HTML, or nothing, is a failure", () => {
    expect(runProbe("<html>504 Gateway Timeout</html>", JSON.stringify(HEALTHY_STATUS)).failed).toBe("probe");
    expect(runProbe("", JSON.stringify(HEALTHY_STATUS)).failed).toBe("probe");
  });

  it("a board that answers a total of zero is serving nothing, and says so", () => {
    const out = runProbe(JSON.stringify({ total: 0 }), JSON.stringify(HEALTHY_STATUS));
    expect(out.failed).toBe("probe");
    expect(out.note).toMatch(/zero postings/);
  });

  it("a missing key is a loud misconfiguration, never a silent pass", () => {
    const out = runProbe(JSON.stringify({ total: 1 }), JSON.stringify(HEALTHY_STATUS), "OTHER=1\n");
    expect(out.failed).toBe("config");
  });
});

describe("the alarm can open its issue", () => {
  it("creates the label before it files an issue under it", () => {
    const run = stepNamed(/alarm/i)?.run;
    if (!run) throw new Error("no alarm script in the parsed workflow");
    const log = join(dir, "gh.log");
    writeFileSync(log, "");
    execFileSync("bash", ["-c", run], {
      encoding: "utf8",
      env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, GH_LOG: log, GITHUB_REPOSITORY: "o/r", NOTE: "probe failing" },
    });
    const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
    const label = calls.findIndex((c) => /^label create board-health\b/.test(c));
    const create = calls.findIndex((c) => /^issue create\b/.test(c) && /--label board-health/.test(c));
    expect(create, `gh calls: ${calls.join(" | ")}`).toBeGreaterThan(-1);
    expect(label, "the issue is filed under a label nothing created").toBeGreaterThan(-1);
    expect(label).toBeLessThan(create);
    expect(calls[create], "the body states a cadence the schedule does not run").not.toMatch(/every 10 minutes/);
  });
});
