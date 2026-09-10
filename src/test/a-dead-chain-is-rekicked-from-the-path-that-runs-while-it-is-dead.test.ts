import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decideRekick, type RekickInput } from "../../supabase/functions/job-board/chain-watchdog.ts";

/**
 * A DEAD CHAIN IS RE-KICKED FROM THE PATH THAT RUNS WHILE IT IS DEAD.
 *
 * Migration 20260909219000 moved the backup cron into the gap, bounding a
 * dead chain's wait at ~5 minutes. Its header also designed the other half:
 * a watchdog inside the function that judges the chain on its OWN pulse and
 * kicks hop 0 non-forced, falling through, never consuming the exclusive
 * maintenance ladder's stamp. .69 built it; the review of .69 found four
 * things about it that this file now pins as behaviour:
 *
 *   1. THE PULSE. slice_stats.workAt is stamped at LOOP END, so a live hot
 *      slice (341s measured) was silent for longer than the window at the
 *      cold EMA (~4 min) and read as dead. index.ts already stamps per board
 *      (slice_trace), per hop start (refresh_progress) and per hop end
 *      (slice_stats.at); the freshest of the four is the pulse.
 *   2. THE STAMP IS ONE HOP BEHIND. chain_kick's 'continued' is the
 *      grandparent's verdict, stamped while the child runs; a child that dies
 *      with its parent leaves it 'continued' forever. So 'continued' proves
 *      life only until a later pulse supersedes it.
 *   3. A HOP IS ITS OWN PULSE. maybeKickMaintenance runs inside a hop, at
 *      pass end after a tail that can outlast the window; it must observe
 *      and never send.
 *   4. ADMISSION RACES. runRefresh's lock is read-then-write with six round
 *      trips in the gap, and the watchdog's own throttle was read-then-write
 *      across two. Both are compare-and-set now, and a lost race reads as
 *      "skipped"/"throttled", never as a second chain.
 *
 * The never-fires are asserted as BEHAVIOUR of the pure decision
 * (chain-watchdog.ts) with every input the runtime could hand it, then as
 * the wiring's shape in comment-stripped index.ts.
 */
const ROOT = resolve(__dirname, "../..");
const IDX = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8")
  .replace(/(^|[^:\w])\/\/[^\n]*/g, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");

const LOCK = 3 * 60_000;
const NOW = Date.parse("2026-09-10T03:05:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const base = (over: Partial<RekickInput> = {}): RekickInput => ({
  now: NOW,
  workAt: iso(60 * 60_000),      // an hour of silence on every pulse
  sliceAt: iso(60 * 60_000),
  traceAt: iso(60 * 60_000),
  progressAt: iso(60 * 60_000),
  coldEmaMs: 28_876,             // the live sample of 2026-09-10 02:53Z
  chainOutcome: "http_error",
  chainAt: iso(60 * 60_000),
  watchdogAt: null,
  sliceLockMs: LOCK,
  ...over,
});
const OUTCOMES = ["kicked", "declined", "http_error", "threw", "paused", null, undefined, 42];

describe("decideRekick — the never-fires, as behaviour", () => {
  it("NEVER fires on a 'continued' stamp nothing has superseded, however old the pulse", () => {
    for (const ageMs of [0, LOCK, 10 * 60_000, 60 * 60_000, 24 * 3_600_000, 30 * 86_400_000]) {
      // The stamp is newer than every pulse: the last hop returned to a live parent and nothing started since.
      const all = iso(ageMs);
      const v = decideRekick(base({ workAt: all, sliceAt: all, traceAt: all, progressAt: all, chainOutcome: "continued", chainAt: iso(Math.max(0, ageMs - 1_000)) }));
      expect(v.decision, `age ${ageMs}`).toBe("chain_alive");
      expect(v.stampSuperseded).toBe(false);
    }
    // 'continued' beats every other input while unsuperseded: no EMA, no watchdog stamp, a garbage EMA.
    for (const coldEmaMs of [undefined, null, NaN, -5, "x"]) {
      expect(decideRekick(base({ chainOutcome: "continued", chainAt: iso(0), coldEmaMs })).decision).toBe("chain_alive");
    }
    // A stamp whose time cannot be read is read conservatively: not superseded.
    for (const chainAt of [null, undefined, "", "garbage"]) {
      expect(decideRekick(base({ chainOutcome: "continued", chainAt })).decision).toBe("chain_alive");
    }
  });

  it("a 'continued' stamp that a later pulse superseded is one hop behind — the pulse decides, and the verdict says so", () => {
    const threshold = 2 * 28_876 + LOCK;
    // The grandparent stamped 'continued' ten minutes ago; a hop started (progress) and fetched boards (trace) since.
    const alive = decideRekick(base({ chainOutcome: "continued", chainAt: iso(10 * 60_000), progressAt: iso(5 * 60_000), traceAt: iso(20_000) }));
    expect(alive.decision).toBe("within_window");
    expect(alive.stampSuperseded).toBe(true);
    expect(alive.pulse).toBe("trace");
    // The same row, but every pulse older than the window: the child and its parent both died.
    const dead = decideRekick(base({ chainOutcome: "continued", chainAt: iso(60 * 60_000), progressAt: iso(threshold + 1), traceAt: iso(threshold + 1), workAt: iso(threshold + 1), sliceAt: iso(threshold + 1) }));
    expect(dead.decision).toBe("rekick");
    expect(dead.stampSuperseded).toBe(true);
    // Supersession is strictly "a pulse AFTER the stamp": the same instant is not after.
    const same = iso(threshold + 1);
    expect(decideRekick(base({ chainOutcome: "continued", chainAt: same, workAt: same, sliceAt: same, traceAt: same, progressAt: same })).decision).toBe("chain_alive");
  });

  it("NEVER fires inside 2 x coldEmaMs + SLICE_LOCK_MS of the FRESHEST pulse, and the threshold is exactly that", () => {
    const coldEmaMs = 28_876;
    const threshold = 2 * coldEmaMs + LOCK;
    for (const outcome of OUTCOMES) {
      for (const ageMs of [0, LOCK - 1, LOCK, threshold - 1, threshold]) {
        const v = decideRekick(base({ workAt: iso(ageMs), coldEmaMs, chainOutcome: outcome }));
        expect(v.decision, `outcome ${String(outcome)} age ${ageMs}`).toBe("within_window");
        expect(v.thresholdMs).toBe(threshold);
      }
      const all = iso(threshold + 1);
      expect(decideRekick(base({ workAt: all, sliceAt: all, traceAt: all, progressAt: all, coldEmaMs, chainOutcome: outcome })).decision).toBe("rekick");
    }
  });

  it("the pulse is the freshest of four stamps, whichever row holds it; an unreadable stamp is no pulse", () => {
    const old = iso(60 * 60_000);
    const fresh = iso(10_000);
    for (const [src, over] of [
      ["work", { workAt: fresh }],
      ["slice", { sliceAt: fresh }],
      ["trace", { traceAt: fresh }],
      ["progress", { progressAt: fresh }],
    ] as Array<[string, Partial<RekickInput>]>) {
      const v = decideRekick(base({ workAt: old, sliceAt: old, traceAt: old, progressAt: old, ...over }));
      expect(v.decision, src).toBe("within_window");
      expect(v.pulse).toBe(src);
      expect(v.pulseAgeMs).toBe(10_000);
    }
    // Garbage on three rows and one real stamp: the real stamp is the pulse.
    const v = decideRekick(base({ workAt: "x", sliceAt: null, traceAt: undefined, progressAt: iso(30_000) }));
    expect(v.pulse).toBe("progress");
    expect(v.pulseAgeMs).toBe(30_000);
  });

  it("THE .69 REVIEW'S TWO LIVE-CHAIN SHAPES read as alive: a hot loop mid-slice, and a pass-end tail mid-sweep", () => {
    // A live hot slice: loop-end stamp from the previous hop 6 min ago, this hop
    // started 5 min ago, the last board landed 15 s ago, chain_kick reads
    // 'kicked' because the grandparent died before the parent returned.
    const hot = decideRekick(base({ workAt: iso(6 * 60_000), sliceAt: iso(6 * 60_000), progressAt: iso(5 * 60_000), traceAt: iso(15_000), chainOutcome: "kicked" }));
    expect(hot.decision).toBe("within_window");
    expect(hot.pulse).toBe("trace");
    // The pass-end tail: loop-done 5 min ago, the sweep's coarse mark 40 s ago.
    const tail = decideRekick(base({ workAt: iso(5 * 60_000), sliceAt: iso(9 * 60_000), progressAt: iso(5 * 60_000), traceAt: iso(40_000), chainOutcome: "continued", chainAt: iso(9 * 60_000) }));
    expect(tail.decision).toBe("within_window");
    expect(tail.stampSuperseded).toBe(true);
  });

  it("the window can never fall BELOW SLICE_LOCK_MS: a missing, zero or garbage EMA floors the threshold at the lock", () => {
    for (const coldEmaMs of [undefined, null, 0, -1, NaN, "x", {}]) {
      const at = iso(LOCK);
      const v = decideRekick(base({ coldEmaMs, workAt: at, sliceAt: at, traceAt: at, progressAt: at }));
      expect(v.thresholdMs, String(coldEmaMs)).toBe(LOCK);
      expect(v.decision).toBe("within_window");
      const past = iso(LOCK + 1);
      expect(decideRekick(base({ coldEmaMs, workAt: past, sliceAt: past, traceAt: past, progressAt: past })).decision).toBe("rekick");
    }
  });

  it("no pulse at all is 'no_pulse', never a kick — the cron owns first light", () => {
    for (const none of [null, undefined, "", "not a date"]) {
      const v = decideRekick(base({ workAt: none, sliceAt: none, traceAt: none, progressAt: none }));
      expect(v.decision).toBe("no_pulse");
      expect(v.pulseAgeMs).toBeNull();
      expect(v.pulse).toBeNull();
    }
  });

  it("throttles on its own stamp for SLICE_LOCK_MS — a second kick inside the lock would be declined by the child anyway", () => {
    expect(decideRekick(base({ watchdogAt: iso(LOCK - 1) })).decision).toBe("throttled");
    expect(decideRekick(base({ watchdogAt: iso(LOCK) })).decision).toBe("rekick");
    expect(decideRekick(base({ watchdogAt: iso(60 * 60_000) })).decision).toBe("rekick");
    expect(decideRekick(base({ watchdogAt: "garbage" })).decision).toBe("rekick");
  });

  it("the verdict carries what it judged: the pulse and its age, the threshold, the outcome, and whether the stamp was set aside", () => {
    const at = iso(600_000);
    const v = decideRekick(base({ workAt: at, sliceAt: at, traceAt: at, progressAt: at, chainOutcome: "declined" }));
    expect(v).toEqual({ decision: "rekick", pulseAgeMs: 600_000, pulse: "work", thresholdMs: 2 * 28_876 + LOCK, chainOutcome: "declined", stampSuperseded: false });
    // Pure: same inputs, same verdict; the input is untouched.
    const input = base();
    const snapshot = JSON.stringify(input);
    expect(decideRekick(input)).toEqual(decideRekick(input));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("the wiring in index.ts", () => {
  const FN = IDX.slice(IDX.indexOf("async function maybeRekickDeadChain("), IDX.indexOf("async function maybeKickMaintenance("));

  it("exists, reads its FIVE rows in one query, and hands every pulse, the stamp time and SLICE_LOCK_MS to the decision", () => {
    expect(FN.length).toBeGreaterThan(500);
    expect(FN).toMatch(/\.select\("k, v, updated_at"\)\.in\("k", \["slice_stats", "chain_kick", "chain_watchdog", "slice_trace", "refresh_progress"\]\)/);
    expect(FN).toMatch(/decideRekick\(\{/);
    expect(FN).toMatch(/sliceLockMs: SLICE_LOCK_MS,/);
    expect(FN).toMatch(/workAt: ss\.workAt,/);
    expect(FN).toMatch(/sliceAt: ss\.at,/);
    expect(FN).toMatch(/traceAt: byKey\.get\("slice_trace"\)\?\.updated_at \?\? null,/);
    expect(FN).toMatch(/progressAt: byKey\.get\("refresh_progress"\)\?\.updated_at \?\? null,/);
    expect(FN).toMatch(/coldEmaMs: ss\.coldEmaMs,/);
    expect(FN).toMatch(/chainOutcome: ck\.outcome,/);
    expect(FN).toMatch(/chainAt: ckRow\?\.updated_at \?\? null,/);
    expect(FN).toMatch(/watchdogAt: wd\?\.updated_at \?\? null,/);
  });

  it("sends nothing on any verdict but 'rekick'", () => {
    const kickAt = FN.indexOf("waitUntil(fetch(url");
    expect(kickAt).toBeGreaterThan(-1);
    const gate = FN.indexOf('if (verdict.decision !== "rekick") return report;');
    expect(gate, "the non-rekick return is missing").toBeGreaterThan(-1);
    expect(gate).toBeLessThan(kickAt);
    expect((FN.match(/fetch\(/g) ?? []).length, "exactly one request").toBe(1);
    // A deliberately paused ingest is silent on purpose: no kick, said so.
    const paused = FN.indexOf('if (await isIngestPaused(client)) return { ...report, decision: "paused" };');
    expect(paused).toBeGreaterThan(gate);
    expect(paused).toBeLessThan(kickAt);
  });

  it("NEVER sends from inside a hop: the in-hop path returns 'in_hop' before the pause read, the stamp and the kick", () => {
    const inHop = FN.indexOf("if (opts.inHop) {");
    const gate = FN.indexOf('if (verdict.decision !== "rekick") return report;');
    const paused = FN.indexOf("if (await isIngestPaused(client))");
    expect(inHop).toBeGreaterThan(gate);
    expect(inHop).toBeLessThan(paused);
    expect(FN.slice(inHop, paused)).toMatch(/return \{ \.\.\.report, decision: "in_hop" \};/);
    expect(FN).toMatch(/^async function maybeRekickDeadChain\(client: SupabaseClient, opts: \{ inHop\?: boolean \} = \{\}\)/);
    // maybeKickMaintenance is the in-hop caller and says so; status is not.
    const MK = IDX.slice(IDX.indexOf("async function maybeKickMaintenance("), IDX.indexOf("maintenance kick skipped", IDX.indexOf("async function maybeKickMaintenance(")));
    expect(MK).toMatch(/await maybeRekickDeadChain\(client, \{ inHop: true \}\);/);
    const STATUS = IDX.slice(IDX.indexOf('if (action === "status") {'), IDX.indexOf('if (action === "vendor-health") {'));
    expect(STATUS).toMatch(/const chainWatchdog = await maybeRekickDeadChain\(client\);/);
    expect(STATUS).not.toMatch(/inHop/);
  });

  it("the kick is the cron's own body: {action:'refresh'}, non-forced, no chainKey, no boards, no hop", () => {
    expect(FN).toMatch(/body: JSON\.stringify\(\{ action: "refresh" \}\),/);
    expect(FN).not.toMatch(/force|chainKey|boards:|chain:/);
    expect(FN).toMatch(/\.then\(\(r\) => discardBody\(r\)\)/);
  });

  it("stamps chain_watchdog BEFORE the kick with a CONDITIONAL write — update where older than the lock, else insert — and a lost race sends nothing", () => {
    const kickAt = FN.indexOf("waitUntil(fetch(url");
    const upd = FN.indexOf(".update({ v: stampV, updated_at: report.at })");
    expect(upd).toBeGreaterThan(-1);
    expect(upd).toBeLessThan(kickAt);
    expect(FN).toMatch(/\.update\(\{ v: stampV, updated_at: report\.at \}\)\s*\.eq\("k", "chain_watchdog"\)\s*\.lt\("updated_at", new Date\(now - SLICE_LOCK_MS\)\.toISOString\(\)\)\s*\.select\("k"\)/);
    expect(FN).toMatch(/let stamped = Array\.isArray\(taken\) && taken\.length === 1;/);
    expect(FN).toMatch(/\.insert\(\{ k: "chain_watchdog", v: stampV, updated_at: report\.at \}\)/);
    expect(FN).toMatch(/stamped = !insErr;/);
    const lost = FN.indexOf('if (!stamped) return { ...report, decision: "throttled"');
    expect(lost).toBeGreaterThan(upd);
    expect(lost).toBeLessThan(kickAt);
    // One writer of the key, and never an unconditional upsert of it.
    expect((IDX.match(/k: "chain_watchdog"/g) ?? []).length).toBe(1);
    expect(FN).not.toMatch(/upsert\(/);
    // Never the maintenance ladder's stamp, never its floor.
    expect(FN).not.toMatch(/maintenance_kick|MAINTENANCE_ANY_GAP_MS/);
  });

  it("is evaluated from maybeKickMaintenance FIRST and falls through — no return, ahead of the ten-minute gap", () => {
    const MK = IDX.slice(IDX.indexOf("async function maybeKickMaintenance("), IDX.indexOf("maintenance kick skipped", IDX.indexOf("async function maybeKickMaintenance(")));
    const call = MK.indexOf("await maybeRekickDeadChain(client, { inHop: true });");
    const gap = MK.indexOf("if (lastAge < MAINTENANCE_ANY_GAP_MS) return;");
    expect(call).toBeGreaterThan(-1);
    expect(gap).toBeGreaterThan(-1);
    expect(call, "the watchdog must run before the maintenance gap, or the gap throttles it").toBeLessThan(gap);
    expect(MK.slice(call, gap)).not.toMatch(/\breturn\b/);
  });

  it("is evaluated from the status action too — the path that runs while the chain is dead — and its decision is published", () => {
    const STATUS = IDX.slice(IDX.indexOf('if (action === "status") {'), IDX.indexOf('if (action === "vendor-health") {'));
    expect(STATUS).toMatch(/const chainWatchdog = await maybeRekickDeadChain\(client\);/);
    expect(STATUS).toMatch(/\n\s+chainWatchdog,\n/);
    // The verdict's fields and the last kick both reach the payload.
    expect(FN).toMatch(/const report = \{ at: new Date\(now\)\.toISOString\(\), \.\.\.verdict, kicked: false, lastKick \};/);
    expect(FN).toMatch(/return \{ \.\.\.report, kicked: true \};/);
  });

  it("instrumentation can never be the thing that breaks a slice or a status call", () => {
    expect(FN).toMatch(/^async function maybeRekickDeadChain\([^)]*\): Promise<Record<string, unknown> \| null> \{\s*try \{/);
    expect(FN).toMatch(/\} catch \(e\) \{\s*console\.warn\("\[JOB-BOARD\] chain watchdog failed \(non-fatal\):"/);
    expect(FN).toMatch(/return null;/);
  });

  it("no throughput constant moved for it", () => {
    expect(IDX).toMatch(/const SLICE_LOCK_MS = 3 \* 60_000;/);
    expect(IDX).toMatch(/const MAINTENANCE_ANY_GAP_MS = 10 \* 60_000;/);
    expect(IDX).toMatch(/const COLD_SLICE = 80;/);
    expect(IDX).toMatch(/const CONCURRENCY = 5;/);
    expect(IDX).toMatch(/const DEEP_PER_SLICE = 2;/);
    expect(IDX).toMatch(/const RETRY_PER_SLICE = 5;/);
    expect(IDX).toMatch(/const BOOTSTRAP_PER_SLICE = 25;/);
    expect(IDX).toMatch(/const SLICE_POSTING_BUDGET = 1_500;/);
  });
});

describe("hop-0 admission is compare-and-set, so two non-forced kicks in the lock's gap cannot both run", () => {
  const RR = IDX.slice(IDX.indexOf("async function runRefresh("), IDX.indexOf("const queue = [...slice];"));
  const ADMIT = IDX.slice(IDX.indexOf("async function admitSlice("), IDX.indexOf("async function runRefresh("));

  it("the optimistic pre-loop advance goes through admitSlice, and a loser answers the word the parent already reads as declined", () => {
    expect(RR).toMatch(/const \{ next \} = advanceProgress\(\{ prev: progressBefore, \.\.\.advanceArgs \}\);/);
    expect(RR).toMatch(/if \(!\(await admitSlice\(client, next, \{ force, prog: \(prog as \{ updated_at: string \} \| null\) \?\? null \}\)\)\) \{\s*return \{ ok: true, detail: "skipped — a slice was admitted moments ago" \};/);
    // The chain's declined-regex and the cron both read "skipped".
    expect(IDX).toMatch(/const declined = \/skipped\|paused\|unknown action\|chainkey\|not authori\/i\.test\(body\)/);
    // The pre-loop block writes refresh_progress nowhere else now.
    expect(RR).not.toMatch(/k: "refresh_progress"/);
  });

  it("a forced hop writes unconditionally; a non-forced one takes the row only on the stamp the lock read, or inserts when there was none", () => {
    expect(ADMIT).toMatch(/if \(ctx\.force\) \{\s*await client\.from\("job_board_meta"\)\.upsert\(\{ k: "refresh_progress", v: next, updated_at \}, \{ onConflict: "k" \}\);\s*return true;/);
    expect(ADMIT).toMatch(/if \(!ctx\.prog\) \{\s*const \{ error \} = await client\.from\("job_board_meta"\)\.insert\(\{ k: "refresh_progress", v: next, updated_at \}\);\s*return !\(error && error\.code === "23505"\);/);
    expect(ADMIT).toMatch(/\.update\(\{ v: next, updated_at \}\)\s*\.eq\("k", "refresh_progress"\)\s*\.eq\("updated_at", ctx\.prog\.updated_at\)\s*\.select\("k"\)/);
    expect(ADMIT).toMatch(/if \(!error && Array\.isArray\(data\) && data\.length === 1\) return true;/);
  });

  it("can never stall the rotation: an unchanged stamp that the filter still missed degrades to the old unconditional write, with a warning", () => {
    expect(ADMIT).toMatch(/const \{ data: again \} = await client\.from\("job_board_meta"\)\.select\("updated_at"\)\.eq\("k", "refresh_progress"\)\.maybeSingle\(\);/);
    expect(ADMIT).toMatch(/if \(again && again\.updated_at !== ctx\.prog\.updated_at\) return false;/);
    expect(ADMIT).toMatch(/console\.warn\(`\[JOB-BOARD\] slice admission: conditional write matched no row though the stamp is unchanged/);
    const warn = ADMIT.indexOf("slice admission: conditional write matched no row");
    const fallback = ADMIT.indexOf('.upsert({ k: "refresh_progress", v: next, updated_at }, { onConflict: "k" });', warn);
    expect(fallback).toBeGreaterThan(warn);
    expect(ADMIT.slice(fallback)).toMatch(/return true;\s*\}\s*$/);
  });
});

describe("the tail pulses, and the stale note is per slice", () => {
  it("the pass-end block stamps three coarse breadcrumbs — per pass, never inside a paging loop", () => {
    const passEnd = IDX.indexOf("if (passDone) {");
    expect(passEnd).toBeGreaterThan(-1);
    for (const mark of ["pass-end", "pass-end-pruned", "pass-end-swept"]) {
      const at = IDX.indexOf(`breadcrumb(client, "${mark}"`);
      expect(at, mark).toBeGreaterThan(passEnd);
      expect((IDX.match(new RegExp(`breadcrumb\\(client, "${mark}"`, "g")) ?? []).length, `${mark} once`).toBe(1);
    }
    // Bounded: the four loop marks plus these three, and no other caller.
    expect((IDX.match(/breadcrumb\(client, "/g) ?? []).length).toBe(7);
    // The first tail mark precedes the facets/prune/sweep work, the others follow their blocks.
    expect(IDX.indexOf('breadcrumb(client, "pass-end"')).toBeLessThan(IDX.indexOf("orphanTokens", passEnd));
    expect(IDX.indexOf('breadcrumb(client, "pass-end-pruned"')).toBeGreaterThan(IDX.indexOf("orphan-pruned ${orphanTokens.length}"));
    expect(IDX.indexOf('breadcrumb(client, "pass-end-swept"')).toBeGreaterThan(IDX.indexOf("freshness sweep delete error"));
  });

  it("sliceStaleNote is reset at slice start, beside the wall clock, so a hot hop never carries a cold hop's staleTries", () => {
    const RR = IDX.slice(IDX.indexOf("async function runRefresh("), IDX.indexOf("const queue = [...slice];"));
    const wall = RR.indexOf("const sliceWallStart = Date.now();");
    const reset = RR.indexOf("sliceStaleNote = null;");
    const tiers = RR.indexOf("await tierLists(client);");
    expect(wall).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(wall);
    expect(reset).toBeLessThan(tiers);
  });
});
