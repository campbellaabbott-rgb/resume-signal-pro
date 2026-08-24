import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * NO ONE CHECKED THAT AN APPLY LINK RESOLVES — NOW SOMETHING DOES, AND THE
 * GUARDS PIN WHAT IT MUST NEVER BECOME.
 *
 * 23,347 servable postings (4.06%) carry an apply_url on a host the EMPLOYER
 * owns, invisible to feed-membership liveness: when the vanity domain lapses,
 * the feed keeps listing the job and the button cannot load (the 233-posting
 * Recruitee incident, as a standing class). The host sweep probes those hosts
 * hourly in bounded slices and publishes an aggregate reachability figure.
 *
 * The measured verdict traps make the shape of the sweep the thing to defend:
 * Workday answers HTTP 200 with a 136-byte stub, vendors ship "no longer
 * available" strings in i18n bundles on LIVE pages, 403/429 is a CDN. So the
 * sweep is DETECTION ONLY, an HTTP response of any kind means ALIVE, and only
 * thrown network errors count. These tests pin each of those properties
 * structurally, on comment-stripped code — the eighth outing of the rule that
 * a negative assertion must never read its own justification.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const HB = readFileSync(resolve(ROOT, "supabase/functions/scan-heartbeat/index.ts"), "utf8");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const MIG = readFileSync(
  resolve(MIG_DIR, readdirSync(MIG_DIR).find((f) => f.includes("no_one_checks_that_an_apply_link_resolves"))!),
  "utf8",
);

const stripTs = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const stripSql = (code: string) =>
  code.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

// The action block, from its dispatch arm to the next one.
const start = FN.indexOf('if (action === "host_sweep") {');
const end = FN.indexOf('if (action === "status") {', start);
const ACTION = FN.slice(start, end);
const ACTION_CODE = stripTs(ACTION);

describe("no one checks that an apply link resolves — now the sweep does", () => {
  it("the action exists and the block extraction found it", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it("detection only: the sweep never writes a posting row or the absence machinery", () => {
    expect(ACTION_CODE).not.toMatch(/job_board_postings/);
    expect(ACTION_CODE).not.toMatch(/missing_since/i);
    expect(ACTION_CODE).not.toMatch(/job_board_closures/i);
  });

  it("any HTTP response is life — fails increment only on a thrown error", () => {
    // The reset lives in the try, the increment in the catch; there is no
    // status-code check anywhere in the verdict.
    expect(ACTION_CODE).toMatch(/prev\.fails = 0;/);
    expect(ACTION_CODE).toMatch(/catch \(e\) \{[\s\S]*?prev\.fails = \(Number\(prev\.fails\) \|\| 0\) \+ 1;/);
    expect(ACTION_CODE).not.toMatch(/\.status\b/);
    expect(ACTION_CODE).not.toMatch(/\.ok\b/);
  });

  it("the probe is bounded: 6s abort, no retry helper, bounded slice, stampede lock", () => {
    expect(ACTION_CODE).toMatch(/setTimeout\(\(\) => ctrl\.abort\(\), 6_000\)/);
    expect(ACTION_CODE).not.toMatch(/fetchWithTimeout/);
    expect(ACTION_CODE).toMatch(/const SLICE = 200;/);
    // The census must PAGE. The 1,000-row ceiling is PostgREST's own
    // max-rows, applied to every response including RPCs, so a single
    // wider range() cannot lift it — that was shipped as a fix and
    // measured to change nothing (a 570k-row table still returns 1,000
    // when asked for 2,000). Pin the loop, not a range literal.
    expect(ACTION_CODE).toMatch(/for \(let from = 0; from < 20_000; from \+= 1_000\)/);
    expect(ACTION_CODE).toMatch(/rpc\("get_apply_hosts"\)\.range\(from, from \+ 999\)/);
    expect(ACTION_CODE).toMatch(/if \(page\.length < 1_000\) break;/);
    expect(ACTION_CODE).not.toMatch(/range\(0, 4999\)/);
    expect(ACTION_CODE).toMatch(/lockAge < 5 \* 60_000/);
  });

  it("the world-readable rollup carries aggregates, never host names", () => {
    const up = ACTION_CODE.indexOf('from("job_board_stats_rollup")');
    expect(up).toBeGreaterThan(-1);
    const call = ACTION_CODE.slice(up, ACTION_CODE.indexOf(");", up));
    expect(call).toMatch(/upsert/);
    expect(call).toMatch(/onConflict: "k"/);
    expect(call).toMatch(/hosts_checked/);
    expect(call).toMatch(/postings_on_failing/);
    expect(call).not.toMatch(/worst/);
    expect(call).not.toMatch(/\bhost\b(?!s_)/);
  });

  it("the census RPC is revoked from anon and PUBLIC — a host list is recon surface", () => {
    const sql = stripSql(MIG);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_apply_hosts\(\) FROM PUBLIC;/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_apply_hosts\(\) FROM anon;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_apply_hosts\(\) TO service_role;/);
  });

  it("the census orders totally, so a paged read cannot skip a host", () => {
    // Ordering by posting count alone leaves the long tail (a wall of 1s and
    // 2s) free to reorder between calls, which under paging puts a host on
    // two pages or on none. The tiebreak makes page N+1 start where page N
    // ended; the caller dedupes too, because a duplicate probe costs one
    // HEAD and a skipped host costs a dead apply button nobody notices.
    const dir = readdirSync(MIG_DIR).filter((f) => f.includes("get_apply_hosts") || f.includes("apply_link_resolves") || f.includes("paged_census"));
    const newest = dir.sort().pop()!;
    const sql = stripSql(readFileSync(resolve(MIG_DIR, newest), "utf8"));
    expect(newest, "the newest get_apply_hosts definition should be the paged-census one").toContain("paged_census");
    expect(sql).toMatch(/ORDER BY 2 DESC, 1 ASC;/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_apply_hosts\(\) FROM anon;/);
  });

  it("the census excludes vendor-canonical hosts — their uptime is the vendor's", () => {
    const sql = stripSql(MIG);
    for (const v of ["greenhouse.io", "myworkdayjobs.com", "recruitee.com", "teamtailor.com", "lever.co"]) {
      expect(sql).toContain(`NOT LIKE '%.${v}'`);
    }
  });

  it("the cron is idempotent and hourly", () => {
    const sql = stripSql(MIG);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM cron\.job WHERE jobname = 'job-board-host-sweep'\)/);
    expect(sql).toMatch(/'7 \* \* \* \*'/);
    expect(sql).toMatch(/"action":"host_sweep"/);
  });

  it("a tick leaves a trace whether it lives or dies", () => {
    // Overnight 2026-08-23→24 the cursor advanced once in ten-plus cron
    // ticks, and arrivals-that-died were indistinguishable from ticks-that-
    // never-fired. Arrival is stamped before probing; the completion persist
    // is CHECKED (an unchecked upsert is a tick that silently never
    // happened — the response reports the computed cursor either way); and
    // status exposes both maintenance chains.
    expect(ACTION_CODE).toMatch(/lastArrivedAt: new Date\(\)\.toISOString\(\)/);
    expect(ACTION_CODE).toMatch(/const \{ error: persistErr \} = await client\.from\("job_board_meta"\)\.upsert\(/);
    expect(ACTION_CODE).toMatch(/persisted: !persistErr/);
    const statusBlock = FN.slice(FN.indexOf('if (action === "status")'), FN.indexOf("structuredSweep: {"));
    expect(statusBlock).toMatch(/hostSweep: \{/);
    expect(statusBlock).toMatch(/recategorize: \{/);
  });

  it("the other-pile keyset scan has its partial index — a sweep must not die at a wall", () => {
    const mig = readFileSync(
      resolve(MIG_DIR, readdirSync(MIG_DIR).find((f) => f.includes("a_sweep_must_not_die_at_a_wall"))!),
      "utf8",
    );
    const sql = stripSql(mig);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_job_board_postings_other_by_id/);
    expect(sql).toMatch(/ON public\.job_board_postings \(id\)/);
    expect(sql).toMatch(/WHERE category = 'other'/);
  });

  it("the heartbeat watches the rollup, and skips (not fails) before the first cycle", () => {
    const hb = stripTs(HB);
    expect(hb).toMatch(/job_board_host_reachability/);
    expect(hb).toMatch(/skip\('job_board_host_reachability', 'no reachability rollup yet/);
    expect(hb).toMatch(/postings_on_failing \?\? 0\) >= 500/);
  });
});
