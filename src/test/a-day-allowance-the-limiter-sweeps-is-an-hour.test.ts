// @vitest-environment node
/**
 * A DAY ALLOWANCE THE LIMITER SWEEPS IS AN HOUR (job-board .88, review of its
 * first build).
 *
 * WHAT WAS WRONG. The first .88 build gave verify, report, click and fit-batch
 * per-address "daily" allowances (400, 30, 1,000, 120) through
 * check_rate_limit with p_window_minutes 1440. The live definition of
 * check_rate_limit (20251219200654, nothing later redefines it) sweeps, on one
 * call in a hundred, every rate_limits row whose window began before the
 * CALLING function's window -- not the row's own, and whatever function wrote
 * it. Every caller passes 60 minutes or more, and track-ab-event calls it on
 * every analytics event with a key the client picks. So a 1,440-minute row is
 * deleted about an hour after it starts, the "daily" allowance is full again,
 * and a caller can hurry that along by posting analytics events: each "per
 * day" figure was really per hour, about 24 times what the notes promised.
 *
 * WHAT .88 DOES. Every per-address allowance is HOURLY (abuse-guards.ts
 * ALLOWANCE_WINDOW_MINUTES = 60), the longest window the sweep keeps, with
 * hourly caps chosen as such (verify 120, report 10, click 300, fit-batch
 * 60). A true day counter needs a table of its own or a change to the sweep,
 * which is a migration; this release ships none.
 *
 * WHAT THIS FILE HOLDS, in a real Postgres (pglite) running the LIVE
 * definition with only its dice loaded -- `random() < 0.01` replaced by
 * `true`, so the sweep runs on every call, which is what an attacker who
 * posts a hundred analytics events gets:
 *   - TEETH: a 1,440-minute row with its day spent is deleted by ONE
 *     60-minute caller's sweep, and the spent allowance answers true again;
 *   - each hourly allowance, spent and 59 minutes old, survives that sweep
 *     and keeps refusing;
 *   - no caller of check_rate_limit in supabase/functions passes a window
 *     shorter than ALLOWANCE_WINDOW_MINUTES (a shorter one would sweep the
 *     hourly rows too);
 *   - LIMITER_MAX_REQUESTS is the live definition's own bound (above it the
 *     RPC raises, and an allowance answers an error as allowed).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { codeOf, sqlCodeOf } from "./helpers/strip-comments";
import {
  ALLOWANCE_WINDOW_MINUTES, CLICK_PER_ADDRESS_HOUR, FIT_PER_ADDRESS_HOUR, LIMITER_MAX_REQUESTS, REPORT_PER_ADDRESS_HOUR, VERIFY_PER_ADDRESS_HOUR,
} from "../../supabase/functions/job-board/abuse-guards";

// PGLITE BOOTS A POSTGRES, SO ITS HOOK IS NOT A UNIT TEST.
vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const MIG_FILES = readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort();
const migCode = (n: string) => sqlCodeOf(readFileSync(resolve(MIGRATIONS, n), "utf8"));

/** Every terminated CREATE of public.check_rate_limit, oldest first, whatever its dollar tag. */
function limiterDefinitions(): Array<{ file: string; text: string }> {
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.check_rate_limit\s*\([\s\S]*?\)\s*RETURNS[\s\S]*?\bAS\s+\$([A-Za-z_]*)\$[\s\S]*?\$\1\$;/gi;
  const out: Array<{ file: string; text: string }> = [];
  for (const file of MIG_FILES) {
    const code = migCode(file);
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) out.push({ file, text: m[0] });
  }
  return out;
}

const DEFS = limiterDefinitions();
const LIVE = DEFS[DEFS.length - 1];
const DICE = "random() < 0.01";

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });

describe("check_rate_limit's sweep, in a real Postgres, with the dice loaded", () => {
  let db: PGlite;
  beforeAll(async () => {
    expect(LIVE, "no migration defines check_rate_limit").toBeDefined();
    expect(LIVE.text.split(DICE).length - 1, `${LIVE.file}: the sweep's one-in-a-hundred test moved -- re-read the sweep before trusting this file`).toBe(1);
    expect(LIVE.text, `${LIVE.file}: the sweep is not filtered by the caller's window any more -- this file's premise changed`).toMatch(/DELETE FROM public\.rate_limits WHERE window_start < v_window_cutoff;/);
    db = new PGlite();
    OPEN.push(db);
    const ddl = /CREATE TABLE public\.rate_limits \([\s\S]*?\);/.exec(migCode(MIG_FILES.find((f) => f.startsWith("20251216002238"))!));
    expect(ddl, "the rate_limits CREATE TABLE was not found").not.toBeNull();
    await db.exec(ddl![0]);
    await db.exec(LIVE.text.replace(DICE, "true"));
  });

  const check = (tx: { query: PGlite["query"] }, ip: string, fn: string, max: number, minutes: number) =>
    tx.query<{ ok: boolean }>("SELECT public.check_rate_limit($1, $2, $3, $4) AS ok", [ip, fn, max, minutes]).then((r) => r.rows[0].ok);
  const plant = (tx: { query: PGlite["query"] }, ip: string, fn: string, minutesAgo: number, count: number) =>
    tx.query("INSERT INTO public.rate_limits (ip_address, function_name, window_start, request_count) VALUES ($1, $2, now() - make_interval(mins => $3), $4)", [ip, fn, minutesAgo, count]);
  const exists = (tx: { query: PGlite["query"] }, ip: string, fn: string) =>
    tx.query("SELECT 1 FROM public.rate_limits WHERE ip_address = $1 AND function_name = $2", [ip, fn]).then((r) => r.rows.length === 1);
  /** One call from an ordinary 60-minute caller -- track-ab-event's visitor tier, keyed on a visitor id the client picks. */
  const anyHourlyCaller = (tx: { query: PGlite["query"] }, visitor: string) => check(tx, visitor, "track-ab-event-visitor", 50, 60);

  it("TEETH: a 1,440-minute row with its day spent is deleted by one 60-minute caller's sweep, and the day is full again", async () => {
    await db.transaction(async (tx) => {
      await plant(tx, "198.51.100.1", "job-board-verify", 61, 400);
      expect(await check(tx, "198.51.100.1", "job-board-verify", 400, 1440), "spent: the old daily cap refuses").toBe(false);
      await anyHourlyCaller(tx, "visitor-a");
      expect(await exists(tx, "198.51.100.1", "job-board-verify"), "the day row was swept an hour in").toBe(false);
      expect(await check(tx, "198.51.100.1", "job-board-verify", 400, 1440), "and the spent 'daily' allowance answers true").toBe(true);
    });
  });

  it("every hourly allowance, spent 59 minutes ago, survives the sweep and keeps refusing", async () => {
    const caps: Array<[string, number]> = [
      ["job-board-verify", VERIFY_PER_ADDRESS_HOUR],
      ["job-board-report", REPORT_PER_ADDRESS_HOUR],
      ["job-board-click", CLICK_PER_ADDRESS_HOUR],
      ["job-board-fit", FIT_PER_ADDRESS_HOUR],
    ];
    expect(ALLOWANCE_WINDOW_MINUTES).toBe(60);
    await db.transaction(async (tx) => {
      for (const [fn, cap] of caps) {
        await plant(tx, "198.51.100.2", fn, 59, cap);
        await anyHourlyCaller(tx, `visitor-${fn}`);
        expect(await exists(tx, "198.51.100.2", fn), `${fn}: swept inside its own hour`).toBe(true);
        expect(await check(tx, "198.51.100.2", fn, cap, ALLOWANCE_WINDOW_MINUTES), `${fn}: spent, so refused`).toBe(false);
      }
    });
  });

  it("an hourly allowance is a fresh hour only once its own hour has passed", async () => {
    await db.transaction(async (tx) => {
      await plant(tx, "198.51.100.3", "job-board-report", 61, REPORT_PER_ADDRESS_HOUR);
      expect(await check(tx, "198.51.100.3", "job-board-report", REPORT_PER_ADDRESS_HOUR, ALLOWANCE_WINDOW_MINUTES)).toBe(true);
    });
  });
});

describe("what the hourly window depends on, read from source", () => {
  it("no caller of check_rate_limit passes a window shorter than the allowance's (it would sweep the hourly rows)", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ts$/.test(e.name) && !/_test\.ts$|\.test\.ts$/.test(e.name)) files.push(p);
      }
    };
    walk(resolve(ROOT, "supabase/functions"));
    const windows: Array<{ file: string; minutes: number }> = [];
    const unresolved: string[] = [];
    const evalTerm = (t: string) => t.split("*").map((x) => Number(x.trim())).reduce((a, b) => a * b, 1);
    for (const f of files) {
      const src = codeOf(readFileSync(f, "utf8"));
      if (!src.includes("check_rate_limit")) continue;
      for (const m of src.matchAll(/p_window_minutes:\s*([A-Za-z_][A-Za-z0-9_]*|\d+(?:\s*\*\s*\d+)?)/g)) {
        const term = m[1];
        if (/^\d/.test(term)) { windows.push({ file: relative(ROOT, f), minutes: evalTerm(term) }); continue; }
        const c = new RegExp(`const ${term}\\s*(?::\\s*number)?\\s*=\\s*(\\d+(?:\\s*\\*\\s*\\d+)?)`).exec(src);
        if (c) windows.push({ file: relative(ROOT, f), minutes: evalTerm(c[1]) });
        else unresolved.push(`${relative(ROOT, f)}: ${term}`);
      }
    }
    expect(unresolved, "a window this guard cannot read is a window it cannot vouch for").toEqual([]);
    expect(windows.length, "the scan found the callers").toBeGreaterThan(20);
    expect(windows.some((w) => w.file.endsWith("job-board/abuse-guards.ts")), "the allowance itself is one of them").toBe(true);
    const short = windows.filter((w) => w.minutes < ALLOWANCE_WINDOW_MINUTES);
    expect(short, "a caller with a shorter window sweeps every hourly allowance before its hour is up").toEqual([]);
  });

  it("LIMITER_MAX_REQUESTS is the live definition's own bound", () => {
    const m = /p_max_requests\s*<\s*1\s+OR\s+p_max_requests\s*>\s*(\d+)/i.exec(LIVE.text);
    expect(m, `${LIVE.file}: the p_max_requests bound was not found`).not.toBeNull();
    expect(LIMITER_MAX_REQUESTS).toBe(Number(m![1]));
    for (const n of [VERIFY_PER_ADDRESS_HOUR, REPORT_PER_ADDRESS_HOUR, CLICK_PER_ADDRESS_HOUR, FIT_PER_ADDRESS_HOUR]) expect(n).toBeLessThanOrEqual(LIMITER_MAX_REQUESTS);
  });
});
