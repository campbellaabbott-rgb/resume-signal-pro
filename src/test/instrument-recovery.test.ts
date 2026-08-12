/**
 * THREE INSTRUMENTS WERE QUIETLY BROKEN, AND ONE OUTAGE HAD NO ALARM.
 *
 * Measured 2026-08-12:
 *   - embedSweep settled on "batch error: statement timeout" every cycle — the
 *     semantic-search vector fill silently not building;
 *   - /pay-transparency ran ~20s of full-table aggregates PER PAGE VIEW
 *     (get_pay_transparency 14.9s, get_transparency_coverage 4.8s and the
 *     first 57014 of the day's incident);
 *   - the board went fully down for the vacuum incident and NOTHING said so —
 *     every instrument this system owns lives inside the database that died.
 *
 * These tests pin the three fixes: the embed queue that rotates instead of
 * re-scanning its dead prefix, the transparency payload moved off the request
 * path, and the external monitor that watches from outside the blast radius.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIG = resolve(__dirname, "../../supabase/migrations");
// Strips BOTH comment forms: a guard satisfied by a /* */-commented-out
// function is a guard that passes while the code is disabled — proven by a
// mutation that block-commented the ghost re-assert and survived.
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

describe("the embed queue rotates instead of re-scanning its dead prefix", () => {
  const sql = strip(readFileSync(
    resolve(MIG, "20260812200000_embed_batch_rotates_instead_of_rescanning.sql"), "utf8"));

  it("bounds the phase-2 probe to a slice the 8s budget can always cover", () => {
    // The failure was unbounded: the walk probed the oldest prefix until it
    // found `lim` hits, the prefix filled with permanent misses, and once it
    // outgrew 8 seconds every call timed out forever.
    //
    // PARSED, NOT PATTERN-MATCHED. A /LIMIT 1000/ regex passed while a
    // mutation raised the bound to 100000, because 1000 is a substring of
    // 100000 — the assertion has to read the number and judge it. The ceiling
    // is the property: any value the budget can always cover is fine, a value
    // that re-creates the unbounded walk is not.
    const at = sql.indexOf("eq.embedded_desc = false AND eq.embedding IS NOT NULL");
    expect(at, "phase-2 predicate not found — the anchor is stale").toBeGreaterThan(-1);
    const phase2 = sql.slice(at);
    const m = /ORDER BY eq\.updated_at ASC\s+LIMIT (\d+)/.exec(phase2);
    expect(m, "the phase-2 slice bound is gone").toBeTruthy();
    const bound = Number(m![1]);
    expect(bound, "slice too small to drain a real queue").toBeGreaterThanOrEqual(200);
    expect(bound, "slice large enough to re-create the timeout").toBeLessThanOrEqual(2000);
  });

  it("requeues misses so the prefix cannot wedge", () => {
    // The rotation IS the fix. Without it the bounded slice just fails
    // politely: the same 1,000 misses are re-probed on every call and the
    // queue never reaches a description-bearing row again.
    expect(sql).toMatch(/UPDATE public\.job_board_embeddings\s+SET updated_at = now\(\)/);
    expect(sql).toMatch(/WHERE public\.job_board_embeddings\.id = ANY\(misses\)/);
  });

  it("is VOLATILE, because the rotation writes", () => {
    // STABLE would make the requeue UPDATE an error at runtime — and a
    // function that silently loses its side effect degrades straight back to
    // the wedge this migration removes.
    expect(sql).toMatch(/VOLATILE/);
    expect(sql, "the old STABLE marking is back").not.toMatch(/\nSTABLE\n/);
  });

  it("treats orphaned embeddings as misses via LEFT JOIN", () => {
    // An inner join never yields a row for an embedding whose posting was
    // pruned, so orphans would neither hit nor rotate — they would wedge the
    // oldest prefix exactly like description-less rows.
    expect(sql).toMatch(/LEFT JOIN public\.job_board_postings p ON p\.id = e\.id/);
    expect(sql).toMatch(/NOT COALESCE\(probe\.ok, false\)/);
  });

  it("leaves phase 1 untouched", () => {
    expect(sql).toMatch(/WHERE e\.embedding IS NULL\s+ORDER BY e\.updated_at DESC/);
  });
});

describe("the transparency payload is computed hourly, not per page view", () => {
  const sql = strip(readFileSync(
    resolve(MIG, "20260812201000_pay_transparency_off_the_request_path.sql"), "utf8"));

  it("caches BOTH heavy payloads under one key", () => {
    expect(sql).toMatch(/'pay',\s+public\.get_pay_transparency\(\)/);
    expect(sql).toMatch(/'coverage',\s+public\.get_transparency_coverage\(\)/);
    expect(sql).toMatch(/'transparency_cache'/);
  });

  it("revokes the heavy functions from anon — they are cron-only now", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_pay_transparency\(\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_transparency_coverage\(\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_transparency_cache\(\) TO anon, authenticated/);
  });

  it("unschedules row-driven, never via a DO block or bare name", () => {
    // Paid for twice in this repo: DO blocks in migrations have caused
    // connection-level aborts that rolled back surrounding DDL, and
    // cron.unschedule(name) THROWS when the job does not exist — the exact
    // state on first apply.
    expect(sql).toMatch(/SELECT cron\.unschedule\(jobid\) FROM cron\.job WHERE jobname = 'transparency-cache-hourly'/);
    expect(sql, "a DO block crept back into a migration").not.toMatch(/DO \$\$/);
  });

  it("primes the row so the page never waits an hour for first paint", () => {
    expect(sql).toMatch(/SELECT public\.refresh_transparency_cache\(\);/);
  });

  it("schedules offset from the explore refresh", () => {
    expect(sql).toMatch(/'37 \* \* \* \*'/);
  });

  it("the outer budget covers both callees' own timeouts", () => {
    // A callee's SET statement_timeout overrides the caller's; the two inner
    // functions carry 25s each, so the refresh needs to cover their sum.
    expect(sql).toMatch(/statement_timeout = '3min'/);
  });
});

describe("the page reads the cache first and falls back only unserved", () => {
  const page = readFileSync(resolve(__dirname, "../pages/PayTransparencyIndex.tsx"), "utf8");
  const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("asks the cache before either aggregate", () => {
    const cacheAt = code.indexOf('rpc("get_transparency_cache")');
    const payAt = code.indexOf('rpc("get_pay_transparency")');
    expect(cacheAt, "the cache read is gone").toBeGreaterThan(-1);
    expect(payAt, "the fallback is gone — the page breaks for the deploy window").toBeGreaterThan(-1);
    expect(cacheAt).toBeLessThan(payAt);
  });

  it("falls back only when the cache served nothing", () => {
    expect(code).toMatch(/if \(served\) return;/);
  });

  it("never trusts null as an object", () => {
    // The cache row is NULL before its first refresh, and typeof null is
    // "object" — the trap that puts null into state and crashes the render.
    expect(code).toMatch(/const isObj = \(v: unknown\) => !!v && typeof v === "object" && !Array\.isArray\(v\);/);
  });
});

describe("the external monitor watches from outside the blast radius", () => {
  const wf = readFileSync(resolve(__dirname, "../../.github/workflows/board-health.yml"), "utf8");

  it("probes the user-facing contract and the pipeline's pulse", () => {
    expect(wf).toMatch(/"limit":1,"page":1/);
    expect(wf).toMatch(/"action":"status"/);
    expect(wf).toMatch(/lastSliceAgeMin/);
  });

  it("runs on a schedule, not only on demand", () => {
    expect(wf).toMatch(/cron: "\*\/10 \* \* \* \*"/);
  });

  it("alarms into a labeled issue and dedupes into one thread", () => {
    expect(wf).toMatch(/issues: write/);
    expect(wf).toMatch(/--label board-health/);
    expect(wf).toMatch(/gh issue comment/);
  });

  it("a missing key is a loud misconfiguration, never a silent pass", () => {
    // The one failure mode a monitor must not have is dying quietly of its own
    // configuration. An unreadable key still routes to the alarm step.
    expect(wf).toMatch(/failed=config/);
    expect(wf).toMatch(/VITE_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("never closes its own issue", () => {
    // "It came back" is a human judgment: recovery at 13:07 today followed
    // three separate false dawns. The monitor raises and updates; people close.
    expect(wf).not.toMatch(/gh issue close/);
  });
});

describe("undated postings state their observation window, honestly", () => {
  const jobs = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
  const code = jobs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("renders first-seen ONLY where no employer date exists", () => {
    // The label is the positive form for the ~89k undated postings — it must
    // never appear beside a company-stated date, where it would read as a
    // second, competing age.
    const sites = [...code.matchAll(/d(?:aysAgo\((?:detailJob|job)\.postedAt\))? === null && daysAgo\((?:job|detailJob)\.lastSeen \?\? null\) !== null/g)];
    expect(sites.length, "expected the guard on both render sites (list card + detail panel)").toBeGreaterThanOrEqual(2);
  });

  it("is never styled as freshness", () => {
    // Discovery time must not borrow the posted badge's fresh-green styling —
    // that substitution is the 2.8-day-median incident in CSS form. Both
    // firstSeen spans must be muted and carry no success color.
    const at = [...code.matchAll(/firstSeenToday/g)].map((m) => m.index ?? 0);
    expect(at.length).toBeGreaterThanOrEqual(2);
    for (const i of at) {
      const span = code.slice(Math.max(0, i - 500), i);
      expect(span, "a firstSeen span carries freshness styling").not.toContain("text-success");
    }
  });

  it("carries its provenance tooltip", () => {
    expect(code).toMatch(/jobsPage\.firstSeenProvenance/);
  });
});

describe("both hourly caches degrade instead of dying", () => {
  const sql = strip(readFileSync(
    resolve(MIG, "20260812210000_both_caches_degrade_instead_of_dying.sql"), "utf8"));
  const stats = sql.slice(sql.indexOf("FUNCTION public.refresh_stats_cache"),
                          sql.indexOf("FUNCTION public.refresh_explore_cache"));
  const explore = sql.slice(sql.indexOf("FUNCTION public.refresh_explore_cache"));

  it("stats: every section is wrapped and the write is unconditional", () => {
    // The deployed body was dying whole on intermittent 57014s while the
    // repo's wrapped version cannot — evidence that a re-stamped migration
    // carried an old body. Re-asserted here; these counts keep it re-asserted.
    const handlers = stats.match(/EXCEPTION WHEN OTHERS THEN/g) ?? [];
    expect(handlers.length, "a stats section lost its wrapper").toBeGreaterThanOrEqual(6);
    expect(stats).toMatch(/'stale_parts', to_jsonb\(stale\)/);
    expect(stats).toMatch(/ON CONFLICT \(k\) DO UPDATE/);
  });

  it("stats: carries its own budget, immune to role-GUC drift", () => {
    // The cron job runs as postgres, whose role timeout was RESET during the
    // vacuum incident — the run must not be governed by whatever the role
    // happens to carry that day.
    expect(stats).toMatch(/SET statement_timeout = '5min'/);
  });

  it("stats: the per-section SET LOCALs are gone, not half-gone", () => {
    // The callees own their budgets (5-20s headers, which override anyway —
    // proven at 25.46s). A surviving SET LOCAL would be a second, weaker copy
    // of a fact that already has one owner.
    expect(stats).not.toMatch(/SET LOCAL statement_timeout/);
  });

  it("explore: the five once-unwrapped sections each degrade to the previous row", () => {
    for (const k of ["trending", "newest", "entry", "salary", "segments"]) {
      expect(explore, `${k} has no stale fallback`).toMatch(
        new RegExp(`stale := stale \\|\\| '${k}'`));
      expect(explore, `${k} does not carry the previous value`).toMatch(
        new RegExp(`COALESCE\\(prev -> '${k}'`));
    }
  });

  it("explore: no collection is built by a bare call inside the payload", () => {
    // The defect shape: a get_*() call sitting directly in jsonb_build_object
    // has no handler, so its failure kills the whole refresh. Every collection
    // must arrive through a wrapped variable.
    const payloadAt = explore.indexOf("payload := jsonb_build_object(");
    expect(payloadAt).toBeGreaterThan(-1);
    const payload = explore.slice(payloadAt, explore.indexOf("INSERT INTO", payloadAt));
    expect(payload, "a bare aggregate call is back inside the payload build")
      .not.toMatch(/FROM public\.get_/);
  });

  it("explore: keeps the same-call denominator slicing intact", () => {
    // The re-assert must not quietly undo this morning's invariant: the twelve
    // cards and their stated pool come from ONE call.
    expect(explore).toMatch(/INTO hiring_rows, hiring_n/);
    expect(explore).toMatch(/INTO repost_rows, repost_pool_n/);
    expect(explore).toMatch(/FILTER \(WHERE r\.rn <= 12\)/);
  });
});

describe("a timeout is what WHEN OTHERS does not catch", () => {
  // Post-migration evidence, 18:12: a statement timeout escaped WHOLE from a
  // section whose handler was confirmed live in pg_proc. Per the PostgreSQL
  // docs, OTHERS matches every error type EXCEPT QUERY_CANCELED and
  // ASSERT_FAILURE — and statement_timeout raises QUERY_CANCELED. The fail-
  // soft wrapping never caught the one error it was built for.
  const sql = strip(readFileSync(
    resolve(MIG, "20260812220000_a_timeout_is_what_when_others_does_not_catch.sql"), "utf8"));

  it("EVERY handler block carries the QUERY_CANCELED arm — parsed, not counted", () => {
    // A count can pass with one block missed; each block is held to it.
    const blocks = [...sql.matchAll(/EXCEPTION[\s\S]*?\n\s*END;/g)].map((m) => m[0]);
    expect(blocks.length, "no handler blocks found — the regex broke").toBeGreaterThanOrEqual(16);
    for (const [i, b] of blocks.entries()) {
      expect(b, `handler block ${i} cannot catch a timeout`).toContain("WHEN QUERY_CANCELED THEN");
      expect(b, `handler block ${i} lost its OTHERS arm`).toContain("WHEN OTHERS THEN");
    }
  });

  it("the arms stay balanced", () => {
    const qc = (sql.match(/WHEN QUERY_CANCELED THEN/g) ?? []).length;
    const wo = (sql.match(/WHEN OTHERS THEN/g) ?? []).length;
    expect(qc).toBe(wo);
    expect(qc).toBeGreaterThanOrEqual(16);
  });

  it("re-asserts refresh_ghost_stats with its own budget", () => {
    // Its 18:05 failure context showed a payload-building body that does not
    // exist in this repo — an older copy deployed. Same re-assert treatment.
    const g = sql.slice(sql.indexOf("FUNCTION public.refresh_ghost_stats"));
    expect(g.length).toBeGreaterThan(100);
    // 15min is the TRUE latest body's own budget (20260809223000). The first
    // draft pinned 10min from an obsolete version found via mtime-ordered
    // search — published-claims caught the regression.
    expect(g).toMatch(/SET statement_timeout = '15min'/);
    // The write must land under the key the reader serves — an INSERT to any
    // other key is a refresh that "succeeds" while the page goes stale forever.
    expect(g).toMatch(/VALUES \('ghost_stats', payload, now\(\)\)/);
    expect(g).toMatch(/ON CONFLICT \(k\) DO UPDATE/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.refresh_ghost_stats\(\) FROM PUBLIC, anon, authenticated/);
  });

  it("both cache refreshers ride in the same file with their budgets intact", () => {
    expect(sql).toMatch(/FUNCTION public\.refresh_stats_cache[\s\S]*?SET statement_timeout = '5min'/);
    expect(sql).toMatch(/FUNCTION public\.refresh_explore_cache[\s\S]*?SET statement_timeout = '15min'/);
  });
});

describe("the labels are cast everywhere, not where it fired", () => {
  // 19:05, the first tick where a handler actually fired: "malformed array
  // literal: counts". An unknown-typed literal on || can resolve toward
  // anyarray || anyarray, so the label parses as an array literal and the
  // HANDLER ITSELF dies — a bug unreachable for three days because handlers
  // could not fire at all, surfaced the moment they could.
  const sql = strip(readFileSync(
    resolve(MIG, "20260812230000_cast_the_labels_everywhere_not_where_it_fired.sql"), "utf8"));

  it("no stale-label concatenation is left uncast", () => {
    // Checked on the comment-stripped file: the header QUOTES the failing
    // line, and an assertion satisfied-or-failed by prose is the trap this
    // suite keeps refusing.
    const uncast = [...sql.matchAll(/stale := stale \|\| '[a-z_]+'(?!::text)/g)];
    expect(uncast.map((m) => m[0]), "these labels can kill their own handler").toEqual([]);
    const cast = (sql.match(/stale := stale \|\| '[a-z_]+'::text/g) ?? []).length;
    expect(cast, "the cast sites vanished — wrong file?").toBeGreaterThanOrEqual(15);
  });

  it("the transparency refresh now degrades like its siblings", () => {
    // Written hours before the QUERY_CANCELED lesson, it shipped with no
    // handlers at all: one slow callee killed the run whole, and the cache
    // sat on its 17:47 prime through the 18:37 tick.
    const t = sql.slice(sql.indexOf("FUNCTION public.refresh_transparency_cache"));
    const blocks = [...t.matchAll(/EXCEPTION[\s\S]*?\n\s*END;/g)];
    expect(blocks.length, "transparency sections lost their handlers").toBeGreaterThanOrEqual(2);
    for (const [i, b] of blocks.entries()) {
      expect(b[0], `transparency block ${i} cannot catch a timeout`).toContain("WHEN QUERY_CANCELED THEN");
    }
    expect(t).toMatch(/'stale_parts', to_jsonb\(stale\)/);
    expect(t).toMatch(/prev -> 'pay'/);
    expect(t).toMatch(/prev -> 'coverage'/);
  });

  it("the re-asserted refreshers keep their own budgets", () => {
    expect(sql).toMatch(/FUNCTION public\.refresh_stats_cache[\s\S]*?SET statement_timeout = '5min'/);
    expect(sql).toMatch(/FUNCTION public\.refresh_explore_cache[\s\S]*?SET statement_timeout = '15min'/);
    expect(sql).toMatch(/FUNCTION public\.refresh_transparency_cache[\s\S]*?SET statement_timeout = '3min'/);
  });
});
