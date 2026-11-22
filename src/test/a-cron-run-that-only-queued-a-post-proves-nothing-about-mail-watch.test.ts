// @vitest-environment node
//
// Node, not jsdom: section 92 runs in bash through child_process.
/**
 * "MAIL-WATCH RAN N TIMES WITH NO FAILED RUN" WAS A PASS NOTHING COULD FAIL
 * (RC-S13-108).
 *
 * Section 92 read get_cron_health and printed PASS when pg_cron's runs of
 * the mail-watch job had not failed. The job's command only queues an HTTP
 * post (pg_net), so pg_cron records succeeded once the post is queued,
 * whatever mail-watch answered: a function that refused every call, or was
 * not deployed, still read "ran 96 times with no failed run".
 *
 * That line is now INFO and says what it is (pg_cron queued N posts, none
 * failed in SQL) and what judges the answers (scan-heartbeat's
 * mail_watch_alive and cron_http_answers). A run that failed in SQL (the
 * vault key read, the command itself) is still a FAIL; that one pg_cron
 * does see.
 */
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const dir = mkdtempSync(join(tmpdir(), "vd92-mail-watch-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * The whole section, with its /tmp files moved into this test's folder and
 * every reader stubbed: curl answers nothing, the probes print nothing, no
 * build is new enough, and R (the anon RPC reader) answers get_cron_health
 * from the fixture. Nothing reaches a network.
 */
function section92(cron: unknown): string[] {
  const fixture = join(dir, "cron.json");
  writeFileSync(fixture, JSON.stringify(cron));
  const body = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/92-w4b-payments-delivery.sh"), "utf8").split("/tmp/").join(`${dir}/`);
  const prelude = [
    "B=http://127.0.0.1:9; K=stub-key",
    "curl() { echo '{}'; }",
    "probe() { :; }",
    "build_ge() { return 1; }",
    `R() { [ "$1" = get_cron_health ] && cat ${JSON.stringify(fixture)}; }`,
  ].join("\n");
  return execFileSync("bash", ["-c", `${prelude}\n${body}`], { cwd: dir, encoding: "utf8", timeout: 30_000 }).split("\n").filter(Boolean);
}
const JOB = { ch_jobname: "mail-watch", ch_schedule: "*/15 * * * *", ch_active: true, ch_runs: 96, ch_failed: 0, ch_last_status: "succeeded" };
const about = (lines: string[]) => lines.filter((l) => /mail-watch (posts|command|ran|has not run)/.test(l));

describe("section 92 never passes mail-watch on pg_cron's word", () => {
  it("96 runs with none failed is INFO, saying it is not what mail-watch answered and naming what judges that", () => {
    const lines = section92([JOB]);
    expect(about(lines), lines.join("\n")).toEqual([
      "INFO  pg_cron queued 96 mail-watch posts in 24 hours and none failed in SQL; that is not what mail-watch answered (a queued post reads succeeded whatever the function says): scan-heartbeat's mail_watch_alive and cron_http_answers judge that, and mail the owner",
    ]);
    expect(lines.some((l) => l.startsWith("PASS") && /no failed run|none failed/.test(l))).toBe(false);
  });

  it("a run that failed in SQL is still a FAIL", () => {
    const lines = section92([{ ...JOB, ch_failed: 4, ch_last_status: "failed" }]);
    expect(about(lines)).toEqual([
      "FAIL  pg_cron ran the mail-watch command 96 times in 24 hours and 4 failed in SQL: read cron.job_run_details for the message (the vault key read, or the command)",
    ]);
  });

  it("the schedule itself is still judged: active is a PASS, inactive or missing a FAIL", () => {
    expect(section92([JOB])).toContain("PASS  mail-watch is scheduled and active (*/15 * * * *)");
    expect(section92([{ ...JOB, ch_active: false }])).toContain("FAIL  the mail-watch job is inactive");
    expect(section92([{ ...JOB, ch_jobname: "other" }]).some((l) => l.startsWith("FAIL  get_cron_health (1 jobs) lists no mail-watch job"))).toBe(true);
  });

  it("no run yet is INFO, as before", () => {
    expect(about(section92([{ ...JOB, ch_runs: 0 }]))).toEqual(["INFO  mail-watch has not run yet in the last 24 hours (it runs every 15 minutes)"]);
  });
});
