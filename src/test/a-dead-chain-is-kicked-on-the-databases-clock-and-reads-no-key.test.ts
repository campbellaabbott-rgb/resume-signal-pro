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
 *       job does not come up active, or when its condition does not evaluate;
 *       it passes where pg_cron is absent;
 *   (c) the job posts exactly when the watchdog would kick, and never while a
 *       pulse is fresh, while ingest is paused, or before any pulse exists; a
 *       stale 'continued' chain_kick does not hold it back;
 *   (d) no later migration that reads the vault can reach a deploy message.
 */
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const MIG = resolve(ROOT, "supabase/migrations");
const FILES = readdirSync(MIG).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
const fileOf = (stamp: string) => FILES.find((f) => f.startsWith(`${stamp}_`)) as string;
const KICK = readFileSync(resolve(MIG, fileOf("20261107100000")), "utf8");
const LEDGER = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8")) as {
  neverApply: string[]; appliedOutsideDrizzle: string[]; neverApplyWhy: Record<string, string>;
};

const CRON = (activeByDefault = true) => `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT ${activeByDefault});
  CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $f$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) RETURNING jobid::bigint $f$;
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

/** Each row is [k, v, seconds ago]. Returns how many refreshes one run of the job posted. */
async function posts(db: PGlite, command: string, rows: Array<[string, unknown, number]>): Promise<number> {
  await db.exec("DELETE FROM public.job_board_meta; DELETE FROM net.calls;");
  for (const [k, v, ago] of rows) {
    await db.query("INSERT INTO public.job_board_meta (k, v, updated_at) VALUES ($1, $2::jsonb, now() - make_interval(secs => $3))", [k, JSON.stringify(v), ago]);
  }
  await db.exec(command);
  return (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM net.calls")).rows[0].n;
}

// The live coldEmaMs of 2026-11-07: the watchdog's threshold is 180 s + 2 x 11.27 s = 202.54 s.
const EMA = 11_270;
const pulses = (ago: number, ema: unknown = EMA): Array<[string, unknown, number]> => [
  ["slice_stats", { coldEmaMs: ema }, ago], ["slice_trace", { mark: "loop-done" }, ago], ["refresh_progress", {}, ago],
];

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

  it("stops the apply when its condition does not evaluate, so a typo never reaches the minute job", async () => {
    const db = new PGlite();
    await db.exec(CRON() + NET + META);
    const typo = KICK.replace("p.v -> 'paused' = 'true'::jsonb", "p.v -> 'paused' = 'true'::jsonbb");
    expect(typo).not.toBe(KICK);
    await expect(db.exec(typo)).rejects.toThrow(/jsonbb/);
    expect((await db.query("SELECT 1 FROM cron.job")).rows).toEqual([]);
  });

  it("passes on a database without pg_cron, and on one without the board's table", async () => {
    await expect(new PGlite().exec(KICK)).resolves.toBeDefined();
    const db = new PGlite();
    await db.exec(CRON() + NET);
    await expect(db.exec(KICK)).resolves.toBeDefined();
  });
});

describe("(c) the job posts exactly when the watchdog would kick", () => {
  it("posts one keyless refresh, byte for byte the refresh crons' request, once every pulse is past the threshold", async () => {
    const { db, command } = await applied();
    expect(await posts(db, command, pulses(210))).toBe(1);
    const { rows } = await db.query<{ url: string; headers: unknown; body: unknown }>("SELECT url, headers, body FROM net.calls");
    expect(rows).toEqual([{ url: "https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/job-board", headers: { "Content-Type": "application/json" }, body: { action: "refresh" } }]);
  });

  it("never posts inside the threshold, while any one pulse is fresh, while ingest is paused, or before any pulse exists", async () => {
    const { db, command } = await applied();
    expect(await posts(db, command, pulses(190)), "190 s is inside 202.5 s").toBe(0);
    expect(await posts(db, command, [["slice_stats", { coldEmaMs: EMA }, 600], ["slice_trace", {}, 30], ["refresh_progress", {}, 600]]), "a hop still breadcrumbing").toBe(0);
    expect(await posts(db, command, [["slice_stats", { coldEmaMs: EMA }, 30], ["slice_trace", {}, 600], ["refresh_progress", {}, 600]]), "a slice just stamped").toBe(0);
    expect(await posts(db, command, [["slice_stats", { coldEmaMs: EMA }, 600], ["slice_trace", {}, 600], ["refresh_progress", {}, 30]]), "a hop just admitted").toBe(0);
    expect(await posts(db, command, [...pulses(400), ["ingest_paused", { paused: true }, 1000]]), "paused").toBe(0);
    expect(await posts(db, command, [...pulses(400), ["ingest_paused", { paused: false }, 1000]]), "unpaused").toBe(1);
    expect(await posts(db, command, []), "no pulse at all").toBe(0);
  });

  it("a stale 'continued' chain_kick does not hold it back: a chain that died between hops is kicked", async () => {
    const { db, command } = await applied();
    expect(await posts(db, command, [...pulses(400), ["chain_kick", { outcome: "continued", fromHop: 16 }, 399]])).toBe(1);
  });

  it("reads the threshold from slice_stats.coldEmaMs: a large one waits longer, and one that is not a number reads as 0", async () => {
    const { db, command } = await applied();
    expect(await posts(db, command, pulses(600, 600_000)), "a 23-minute threshold").toBe(0);
    expect(await posts(db, command, pulses(185, "x")), "three minutes alone").toBe(1);
    expect(await posts(db, command, pulses(175, null))).toBe(0);
    expect(await posts(db, command, pulses(185, -5_000)), "a negative EMA is 0").toBe(1);
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
