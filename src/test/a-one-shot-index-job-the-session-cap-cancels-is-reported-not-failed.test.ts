// @vitest-environment node
/**
 * A ONE-SHOT INDEX JOB THE SESSION CAP CANCELS IS REPORTED, NOT FAILED
 * (cost wave review, 2026-11-15).
 *
 * Section 7m of scripts/verify-deploy.sh FAILs an active cron job that sets no
 * timeout of its own and was cancelled by a statement timeout in 24 hours:
 * such a job is running under the session's two minutes by mistake. The cost
 * wave's one-shot index jobs (the duplicate-index droppers, the closure-basis
 * builder) are a single DROP or CREATE INDEX CONCURRENTLY each, which refuses
 * a SET in front of it, so they carry no timeout by design, and a cancel by
 * the two-minute cap is the retry their watcher expects. While one was still
 * listed, 7m read it as that mistake and FAILed the run.
 *
 * Run here: the section's own node script, cut from the file, over stub
 * get_cron_health rows.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const at = SCRIPT.indexOf('echo "== 7m.');
const open = SCRIPT.indexOf("node -e '", at);
const body = SCRIPT.slice(open + "node -e '".length, SCRIPT.indexOf("'\n", open + "node -e '".length));

type Row = Record<string, unknown>;
const job = (name: string, o: Row = {}): Row => ({
  ch_jobname: name, ch_schedule: "* * * * *", ch_active: true, ch_timeout: null, ch_runs: 30, ch_failed: 3,
  ch_timeouts: 3, ch_last_start: "2026-11-10T10:28:00Z", ch_last_status: "failed", ch_last_seconds: 120, ch_max_seconds: 120, ...o,
});
/** The two jobs the section names by name, each with its own timeout, so only the rows under test can fail. */
const BASE = [job("refresh-stats-cache", { ch_timeout: "10min", ch_timeouts: 0 }), job("refresh-explore-cache", { ch_timeout: "15min", ch_timeouts: 0 })];

function run(rows: Row[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd7m-"));
  const json = join(dir, "vd_7m.json");
  writeFileSync(json, JSON.stringify(rows));
  const out = execFileSync(process.execPath, ["-e", body.split("/tmp/vd_7m.json").join(json)], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}
const cancelLine = (lines: string[]) => lines.find((l) => l.includes("was cancelled by a statement timeout in 24h"));

describe("section 7m and the jobs cancelled at the session's two minutes", () => {
  it("cut its script from the file (an empty cut would judge nothing)", () => {
    expect(at).toBeGreaterThan(0);
    expect(body).toContain("get_cron_health");
  });

  it("a one-shot index dropper or builder retrying after a cancel is an INFO line naming it, and no FAIL", () => {
    const lines = run([...BASE,
      job("oneshot-drop-postings-company-token-idx"),
      job("oneshot-closures-absence-basis-idx", { ch_schedule: "44 * * * *", ch_timeouts: 1, ch_failed: 1, ch_runs: 1 })]);
    expect(cancelLine(lines), lines.join("\n")).toMatch(/^PASS {2}/);
    expect(lines.filter((l) => l.startsWith("FAIL")), lines.join("\n")).toEqual([]);
    expect(lines.some((l) => /^INFO {2}oneshot-drop-postings-company-token-idx \(a one-shot index job/.test(l)), lines.join("\n")).toBe(true);
    expect(lines.some((l) => /^INFO {2}oneshot-closures-absence-basis-idx \(a one-shot index job/.test(l)), lines.join("\n")).toBe(true);
  });

  it("any other job with no timeout of its own that was cancelled still FAILs, beside a one-shot that does not", () => {
    const lines = run([...BASE, job("oneshot-drop-postings-company-token-idx"), job("refresh-board-facets")]);
    const l = cancelLine(lines) ?? "";
    expect(l).toMatch(/^FAIL {2}/);
    expect(l).toContain("refresh-board-facets (3 cancels");
    expect(l).not.toContain("oneshot-");
  });
});
