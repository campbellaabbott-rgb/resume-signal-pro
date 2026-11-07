// @vitest-environment node
/**
 * A DEAD CHAIN IS KICKED ON THE DATABASE'S CLOCK, AND THE KICK READS NO KEY
 * (the upkeep hotfix, 2026-11-07; migration 20261107100000).
 *
 * 20261103221000 was to call job-board's upkeep action every five minutes with
 * the scheduler's key, read from the vault. Lovable's agent refused it on
 * 2026-11-06 ("Agent access to secrets is not allowed"), as it refused
 * 20261103120000, so job-board .101 has served with nothing acting on its
 * chain watchdog. The watchdog's only act is the keyless {"action":"refresh"}
 * the :x4/:x9 refresh crons already send, so 20261107100000 sends that same
 * request from SQL, every minute, only once every pulse is past the watchdog's
 * threshold and ingest is not paused.
 *
 * Proved here, in Postgres (PGlite with stand-ins for pg_cron, pg_net and
 * job_board_meta):
 *   (a) the file names nothing Lovable refuses;
 *   (b) it schedules one active job every minute, run twice; it stops when the
 *       job does not come up active or every minute, when its condition does
 *       not evaluate, and when any other part of the stored command would fail
 *       every run (the post, its headers or body), and that check posts
 *       nothing; it passes where pg_cron is absent;
 *   (c) the job's threshold is the watchdog's: it posts exactly when
 *       decideRekick, handed the same three pulses, the same coldEmaMs and
 *       index.ts's SLICE_LOCK_MS, would rekick, so a change to the lock, the
 *       factor of two or the clamp on either side fails here. Two of the
 *       watchdog's rules are deliberately not applied: a stale 'continued'
 *       chain_kick (a hop that died after answering leaves it) and its own
 *       throttle (runRefresh's lock declines a kick a live chain does not
 *       need). It never posts while a pulse is fresh, while ingest is paused,
 *       or before any pulse exists;
 *   (d) no later migration that reads the vault can reach a deploy message;
 *   (e) the ledger says what moved to the kick and what has no caller;
 *   (f) the rollback the notes and the file document keeps the kick out of
 *       the next message: the ledger counts it applied only while its job is
 *       active, so an unscheduled job goes into neverApply in the same change.
 */
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { decideRekick } from "../../supabase/functions/job-board/chain-watchdog.ts";
import * as L from "../../scripts/deploy-ledger.mjs";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const MIG = resolve(ROOT, "supabase/migrations");
const FILES = readdirSync(MIG).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
const fileOf = (stamp: string) => FILES.find((f) => f.startsWith(`${stamp}_`)) as string;
const KICK = readFileSync(resolve(MIG, fileOf("20261107100000")), "utf8");
const LEDGER = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8")) as {
  neverApply: string[]; appliedOutsideDrizzle: string[]; neverApplyWhy: Record<string, string>;
  migrationOrder: Record<string, { why?: string }>; reservations: Record<string, { status?: string }>;
};
// The watchdog's lock, read from the function, never copied: the kick's threshold must move with it.
const IDX = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const LOCK_EXPR = /^const SLICE_LOCK_MS = ([\d_ *]+);/m.exec(IDX)?.[1] ?? "";
const SLICE_LOCK_MS = LOCK_EXPR ? LOCK_EXPR.split("*").map((n) => Number(n.trim().replace(/_/g, ""))).reduce((a, b) => a * b, 1) : NaN;

const CRON = (activeByDefault = true, storedSchedule = "s") => `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT ${activeByDefault});
  CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $f$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, ${storedSchedule}, c) RETURNING jobid::bigint $f$;
  CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $f$ DELETE FROM cron.job WHERE jobname = n RETURNING true $f$;
`;
const NET = `
  CREATE SCHEMA net;
  CREATE TABLE net.calls (id serial, url text, headers jsonb, body jsonb);
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $f$ INSERT INTO net.calls (url, headers, body) VALUES (url, headers, body) RETURNING id::bigint $f$;
`;
const META = "CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());";

async function applied(): Promise<{ db: PGlite; command: string }> {
  const db = new PGlite();
  await db.exec(CRON() + NET + META);
  await db.exec(KICK);
  const { rows } = await db.query<{ command: string }>("SELECT command FROM cron.job WHERE jobname = 'job-board-dead-chain-kick'");
  return { db, command: rows[0].command };
}

type Row = [string, unknown, number];

async function seed(db: PGlite, rows: Row[]): Promise<void> {
  await db.exec("DELETE FROM public.job_board_meta; DELETE FROM net.calls;");
  for (const [k, v, ago] of rows) {
    await db.query("INSERT INTO public.job_board_meta (k, v, updated_at) VALUES ($1, $2::jsonb, now() - make_interval(secs => $3))", [k, JSON.stringify(v), ago]);
  }
}
const calls = async (db: PGlite) => (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM net.calls")).rows[0].n;

/** Each row is [k, v, seconds ago]. Returns how many refreshes one run of the job posted. */
async function posts(db: PGlite, command: string, rows: Row[]): Promise<number> {
  await seed(db, rows);
  await db.exec(command);
  return calls(db);
}

// The live coldEmaMs of 2026-11-07: the watchdog's threshold is 180 s + 2 x 11.27 s = 202.54 s.
const EMA = 11_270;
const pulses = (ago: number, ema: unknown = EMA): Row[] => [
  ["slice_stats", { coldEmaMs: ema }, ago], ["slice_trace", { mark: "loop-done" }, ago], ["refresh_progress", {}, ago],
];

/**
 * What the watchdog decides for the same rows (chain-watchdog.ts decideRekick).
 * slice_stats.updated_at is its workAt or at (each write stamps it), and the
 * kick reads no chain_kick and keeps no throttle row of its own.
 */
const T = Date.parse("2026-11-07T18:00:00Z");
function watchdog(rows: Row[], sliceLockMs = SLICE_LOCK_MS, chain: { outcome: string; ago: number } | null = null) {
  const row = (k: string) => rows.find((r) => r[0] === k);
  const at = (r: Row | undefined) => (r ? new Date(T - r[2] * 1000).toISOString() : null);
  const stats = row("slice_stats");
  return decideRekick({
    now: T, workAt: at(stats), sliceAt: at(stats), traceAt: at(row("slice_trace")), progressAt: at(row("refresh_progress")),
    coldEmaMs: (stats?.[1] as { coldEmaMs?: unknown } | undefined)?.coldEmaMs,
    chainOutcome: chain?.outcome ?? null, chainAt: chain ? new Date(T - chain.ago * 1000).toISOString() : null,
    watchdogAt: null, sliceLockMs,
  });
}

/** The cases, placed around the threshold of a given lock (seconds), 5 s either side. */
function casesAround(lockMs: number): Array<[string, Row[]]> {
  const lock = lockMs / 1000, two = (ema: number) => lock + (2 * Math.max(ema, 0)) / 1000;
  return [
    ["5 s past the threshold", pulses(two(EMA) + 5)],
    ["5 s inside the threshold", pulses(two(EMA) - 5)],
    ["one and a half EMAs past the lock", pulses(lock + (1.5 * EMA) / 1000)],
    ["2 s past one EMA", pulses(lock + EMA / 1000 + 2)],
    ["a negative EMA, 5 s inside the lock", pulses(lock - 5, -5_000)],
    ["a negative EMA, 5 s past the lock", pulses(lock + 5, -5_000)],
    ["an EMA that is not a number, 5 s past the lock", pulses(lock + 5, "x")],
    ["a null EMA, 5 s inside the lock", pulses(lock - 5, null)],
    ["a 600 s EMA, 5 s inside its threshold", pulses(two(600_000) - 5, 600_000)],
    ["a 600 s EMA, 5 s past its threshold", pulses(two(600_000) + 5, 600_000)],
    ["no slice_stats row: the lock alone, 5 s past it", [["slice_trace", {}, lock + 5], ["refresh_progress", {}, lock + 5]]],
    ["one pulse inside the threshold, two long past it", [["slice_stats", { coldEmaMs: EMA }, 600], ["slice_trace", {}, two(EMA) - 5], ["refresh_progress", {}, 600]]],
    ["no pulse at all", []],
  ];
}

/** Every case where the job and the watchdog (at lockMs) disagree, with what each did. */
async function disagreements(db: PGlite, command: string, lockMs: number): Promise<string[]> {
  const out: string[] = [];
  for (const [name, rows] of casesAround(lockMs)) {
    const sql = await posts(db, command, rows);
    const kicks = watchdog(rows, lockMs).decision === "rekick" ? 1 : 0;
    if (sql !== kicks) out.push(`${name}: the job posted ${sql}, the watchdog ${kicks ? "rekicks" : "does not"}`);
  }
  return out;
}

describe("(a) the file names nothing Lovable refuses", () => {
  it("its raw text, comments included, never names the vault, a secret or a decrypted value", () => {
    expect(KICK).not.toMatch(/vault|secret|decrypted/i);
  });
});

describe("(b) it schedules one active job every minute, and checks itself", () => {
  it("run twice, it leaves one active job every minute", async () => {
    const { db } = await applied();
    await db.exec(KICK);
    const { rows } = await db.query<{ jobname: string; schedule: string; active: boolean }>("SELECT jobname, schedule, active FROM cron.job");
    expect(rows).toEqual([{ jobname: "job-board-dead-chain-kick", schedule: "* * * * *", active: true }]);
  });

  it("stops the apply when the job does not come up active", async () => {
    const db = new PGlite();
    await db.exec(CRON(false) + NET + META);
    await expect(db.exec(KICK)).rejects.toThrow(/job-board-dead-chain-kick is not an active cron job every minute/);
  });

  it("stops the apply when the job comes up on another schedule than every minute", async () => {
    const db = new PGlite();
    await db.exec(CRON(true, "'*/5 * * * *'") + NET + META);
    await expect(db.exec(KICK)).rejects.toThrow(/job-board-dead-chain-kick is not an active cron job every minute/);
  });

  it("stops the apply when its condition does not evaluate, so a typo never reaches the minute job", async () => {
    const db = new PGlite();
    await db.exec(CRON() + NET + META);
    const typo = KICK.replace("p.v -> 'paused' = 'true'::jsonb", "p.v -> 'paused' = 'true'::jsonbb");
    expect(typo).not.toBe(KICK);
    await expect(db.exec(typo)).rejects.toThrow(/jsonbb/);
    expect((await db.query("SELECT 1 FROM cron.job")).rows).toEqual([]);
  });

  it("stops the apply when a slip outside the condition would fail every run: the post's headers, its body or its arguments", async () => {
    const slips: Array<[string, string, string]> = [
      ["a headers literal retyped without its colon", `'{"Content-Type": "application/json"}'::jsonb`, `'{"Content-Type" "application/json"}'::jsonb`],
      ["a body literal retyped without its closing brace", `'{"action":"refresh"}'::jsonb`, `'{"action":"refresh"'::jsonb`],
      ["a comma dropped between the arguments", `'::jsonb,\n      body :=`, `'::jsonb\n      body :=`],
    ];
    for (const [name, from, to] of slips) {
      const db = new PGlite();
      await db.exec(CRON() + NET + META);
      await seed(db, pulses(600));
      const slipped = KICK.replace(from, to);
      expect(slipped, name).not.toBe(KICK);
      // The command as retyped fails when it runs, so applying it must fail too.
      await expect(db.exec(slipped), name).rejects.toThrow();
      expect((await db.query("SELECT 1 FROM cron.job")).rows, name).toEqual([]);
      expect(await calls(db), name).toBe(0);
    }
  });

  it("checks the stored command without running it: an apply over a dead chain posts nothing, and the job it leaves runs", async () => {
    const db = new PGlite();
    await db.exec(CRON() + NET + META);
    await seed(db, pulses(600));
    await db.exec(KICK);
    expect(await calls(db), "the apply's own check sent a refresh").toBe(0);
    const { rows } = await db.query<{ command: string }>("SELECT command FROM cron.job");
    await db.exec(rows[0].command);
    expect(await calls(db)).toBe(1);
  });

  it("passes on a database without pg_cron, and on one without the board's table", async () => {
    await expect(new PGlite().exec(KICK)).resolves.toBeDefined();
    const db = new PGlite();
    await db.exec(CRON() + NET);
    await expect(db.exec(KICK)).resolves.toBeDefined();
  });
});

describe("(c) the job's threshold is the watchdog's; its 'continued' rule and throttle are deliberately not applied", () => {
  it("reads the lock from index.ts, not from a copy", () => {
    expect(LOCK_EXPR, "index.ts no longer declares SLICE_LOCK_MS as a product of numbers").not.toBe("");
    expect(SLICE_LOCK_MS).toBeGreaterThan(0);
  });

  it("posts exactly when decideRekick, handed the same pulses, coldEmaMs and SLICE_LOCK_MS, rekicks", async () => {
    const { db, command } = await applied();
    expect(await disagreements(db, command, SLICE_LOCK_MS)).toEqual([]);
    // Not vacuous: the cases straddle the threshold, so some post and some do not.
    const kicked = casesAround(SLICE_LOCK_MS).map(([, rows]) => watchdog(rows).decision === "rekick");
    expect(kicked).toContain(true);
    expect(kicked).toContain(false);
  });

  it("positive control: a lock a minute longer or shorter than the job's would disagree at the threshold", async () => {
    const { db, command } = await applied();
    expect((await disagreements(db, command, SLICE_LOCK_MS + 60_000)).length).toBeGreaterThan(0);
    expect((await disagreements(db, command, SLICE_LOCK_MS - 60_000)).length).toBeGreaterThan(0);
  });

  it("posts one keyless refresh, byte for byte the refresh crons' request, once every pulse is past the threshold", async () => {
    const { db, command } = await applied();
    expect(await posts(db, command, pulses(210))).toBe(1);
    const { rows } = await db.query<{ url: string; headers: unknown; body: unknown }>("SELECT url, headers, body FROM net.calls");
    expect(rows).toEqual([{ url: "https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/job-board", headers: { "Content-Type": "application/json" }, body: { action: "refresh" } }]);
  });

  it("never posts while any one pulse is fresh, while ingest is paused, or before any pulse exists", async () => {
    const { db, command } = await applied();
    expect(await posts(db, command, [["slice_stats", { coldEmaMs: EMA }, 600], ["slice_trace", {}, 30], ["refresh_progress", {}, 600]]), "a hop still breadcrumbing").toBe(0);
    expect(await posts(db, command, [["slice_stats", { coldEmaMs: EMA }, 30], ["slice_trace", {}, 600], ["refresh_progress", {}, 600]]), "a slice just stamped").toBe(0);
    expect(await posts(db, command, [["slice_stats", { coldEmaMs: EMA }, 600], ["slice_trace", {}, 600], ["refresh_progress", {}, 30]]), "a hop just admitted").toBe(0);
    expect(await posts(db, command, [...pulses(400), ["ingest_paused", { paused: true }, 1000]]), "paused").toBe(0);
    expect(await posts(db, command, [...pulses(400), ["ingest_paused", { paused: false }, 1000]]), "unpaused").toBe(1);
    expect(await posts(db, command, []), "no pulse at all").toBe(0);
  });

  it("does not apply the watchdog's 'continued' rule: a chain that died between hops is kicked where the watchdog reads it alive", async () => {
    const { db, command } = await applied();
    const rows: Row[] = [...pulses(400), ["chain_kick", { outcome: "continued", fromHop: 16 }, 399]];
    expect(watchdog(rows, SLICE_LOCK_MS, { outcome: "continued", ago: 399 }).decision).toBe("chain_alive");
    expect(await posts(db, command, rows)).toBe(1);
  });
});

describe("(d) no migration Lovable refuses can reach a deploy message", () => {
  const onLedger = (file: string, policy: { neverApply?: string[]; appliedOutsideDrizzle?: string[] }) =>
    [...(policy.neverApply ?? []), ...(policy.appliedOutsideDrizzle ?? [])].some((s) => file.startsWith(String(s)));
  /** Files stamped after `after` that read the vault and that the ledger would still list. */
  const unrefusable = (after: string, policy: { neverApply?: string[]; appliedOutsideDrizzle?: string[] }) =>
    FILES.filter((f) => f.slice(0, 14) > after)
      .filter((f) => /vault|decrypted_secret/i.test(readFileSync(resolve(MIG, f), "utf8")))
      .filter((f) => !onLedger(f, policy));

  it("every migration after 20261103240000 that reads the vault is neverApply or appliedOutsideDrizzle", () => {
    expect(unrefusable("20261103240000", LEDGER)).toEqual([]);
  });

  it("the two files Lovable refused on 2026-11-06 are never applied, each with its own reason", () => {
    expect(unrefusable("20261103000000", LEDGER)).toEqual([]);
    expect(LEDGER.neverApplyWhy["20261103120000"]).toMatch(/reads the vault .*refused it 2026-11-06/);
    expect(LEDGER.neverApplyWhy["20261103221000"]).toMatch(/^superseded by 20261107100000: /);
  });

  it("positive control: without them on the ledger, the guard names both", () => {
    expect(unrefusable("20261103000000", { neverApply: ["20260928003117"], appliedOutsideDrizzle: LEDGER.appliedOutsideDrizzle }).map((f) => f.slice(0, 14)))
      .toEqual(["20261103120000", "20261103221000"]);
  });
});

describe("(e) the ledger says what moved to the kick and what has no caller", () => {
  /** Files the ledger would still apply, or has applied, that post job-board's upkeep action. */
  const upkeepCallers = () => FILES.filter((f) => !LEDGER.neverApply.some((s) => f.startsWith(s)))
    .filter((f) => /["']action["']\s*:\s*["']upkeep["']/.test(readFileSync(resolve(MIG, f), "utf8")));

  it("no schedule calls upkeep, so the ledger says the coverage refresh has no caller and never that the whole scheduled half moved", () => {
    expect(upkeepCallers()).toEqual([]);
    const status = LEDGER.reservations["audit-rest"]?.status ?? "";
    expect(status).not.toMatch(/scheduled half moved/);
    expect(status).toMatch(/its dead-chain restart moved to 20261107100000, and its coverage refresh has no caller until job-board \.102/);
    expect(LEDGER.migrationOrder["20261107100000"]?.why ?? "").not.toMatch(/scheduled half/);
    expect(LEDGER.migrationOrder["20261107100000"]?.why ?? "").toMatch(/S13-114's dead-chain restart without the vault/);
  });

  it("positive control: 20261103221000, the file that would have called upkeep, is the one the guard would name", () => {
    expect(FILES.filter((f) => /["']action["']\s*:\s*["']upkeep["']/.test(readFileSync(resolve(MIG, f), "utf8"))).map((f) => f.slice(0, 14))).toEqual(["20261103221000"]);
  });
});

describe("(f) the documented rollback keeps the kick out of the next message", () => {
  const F = fileOf("20261107100000");
  const NOTES = readFileSync(resolve(ROOT, "docs/job-board-deploy-notes.md"), "utf8");
  const at = NOTES.indexOf("## UPKEEP HOTFIX");
  const HOTFIX = NOTES.slice(at, NOTES.indexOf("\n## ", at + 10));

  it("an unscheduled or paused kick reads as not applied, so without a neverApply entry the next message applies it again", () => {
    for (const rows of [[], [{ ch_jobname: "job-board-dead-chain-kick", ch_active: false }]]) {
      const b = L.behaviourApplied([F], LEDGER, rows);
      expect(b.pending).toEqual([F]);
      expect(L.migrationPhases(b.pending, LEDGER, [], null).pre.map((m: { file: string }) => m.file)).toEqual([F]);
    }
  });

  it("the notes and the file say to unschedule it and add it to neverApply with a reason in the same change", () => {
    const rollback = HOTFIX.split("\n").find((l) => l.startsWith("ROLLBACK.")) ?? "";
    expect(rollback).toMatch(/cron\.unschedule\('job-board-dead-chain-kick'\)/);
    expect(rollback).toMatch(/in the same change add 20261107100000 to neverApply in docs\/deploy-ledger\.json with its reason in neverApplyWhy/);
    expect(rollback).toMatch(/pausing the job \(active false\) needs the same entry/);
    expect(KICK).toMatch(/-- Undo: SELECT cron\.unschedule\('job-board-dead-chain-kick'\), and in the same\n-- change add 20261107100000 to neverApply in docs\/deploy-ledger\.json with its\n-- reason/);
  });

  it("done that way, no message carries it except to say never apply it, with the owner's reason", () => {
    const rolled = { ...LEDGER, neverApply: [...LEDGER.neverApply, "20261107100000"], neverApplyWhy: { ...LEDGER.neverApplyWhy, "20261107100000": "unscheduled by the owner on 2026-11-20: a test" } };
    const m = L.migrations(rolled);
    expect(m.pending).not.toContain(F);
    expect(m.neverApplyPresent).toContain(F);
    const message = L.lovableMessage({ head: "abc", phases: L.migrationPhases(m.pending, rolled, [], null), neverApply: m.neverApplyPresent, neverApplyWhy: m.neverApplyWhy });
    const naming = message.filter((l: string) => l.includes(F));
    expect(naming).toHaveLength(1);
    expect(naming[0]).toMatch(/^\s*NEVER apply: .*20261107100000_a_dead_chain_is_kicked_on_the_databases_clock_once_every_pulse_is_stale\.sql \(unscheduled by the owner on 2026-11-20: a test\)/);
  });
});
