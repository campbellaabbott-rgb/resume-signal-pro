// @vitest-environment node
/**
 * A BUDGET THAT CHARGED THE OFFICE FOR ONE VISITOR'S LOOP.
 *
 * WHAT WAS WRONG (audited 2026-09-27). track-ab-event had one counter, keyed
 * on the client address, at 50 events an hour. A homepage visit emits six
 * events at mount and a ten-minute engaged visit sixteen before any
 * interaction; a journey through a scan to checkout is about thirty. So three
 * engaged people behind one shared address spent its hour and the fourth was
 * silently answered "rate_limited" with a 200. Raising that one number is not
 * a fix: high enough for a shared address, it lets one runaway client (a
 * render loop re-firing views) spend the whole address's allowance and starve
 * its neighbours — the shape of the 2026-08-03 budget incident.
 *
 * THE DESIGN, and what this file holds:
 *
 *   TWO TIERS. A per-VISITOR budget through the shared check_rate_limit under
 *   a function name of its own, then the per-ADDRESS ceiling inside the writer.
 *   The Deno test beside the function (budget_test.ts) drives the tiers with a
 *   fake RPC and proves order, keys and refusal behaviour. This file holds the
 *   NUMBERS against the things they must respect, all derived from source:
 *
 *   - the visitor budget admits THREE full journeys an hour, where a journey's
 *     size is read from the client hooks (milestone arrays, funnel stages,
 *     A/B sites, once-per-session events, product kinds), not typed here;
 *   - the address ceiling is at least TEN visitor budgets;
 *   - the visitor budget is under check_rate_limit's own bound, read from the
 *     migration that defines it — above it the RPC raises and the tier fails
 *     open on every call, which is no tier at all;
 *   - neither function name the budget writes under is in the front door's
 *     counted set (check_global_rate_limit's v_budgeted, read from the
 *     migration that defines it): analytics must never spend the request
 *     budget of upload and checkout;
 *   - the entry point calls no RPC of its own, carries no rate number, and
 *     answers every response with its build so a deploy is provable.
 *
 *   THE WINDOW IS AN HOUR IN THE DATABASE, NOT ONLY IN A TYPESCRIPT CONSTANT.
 *   Three reviewers of the first build found that the writer's counter
 *   derived its window start from the minute-of-hour, so it changed every
 *   minute and the counter reset with it: the "1200 an hour" ceiling was
 *   1200 a MINUTE, and a constant pinned to 60 in this file could not see
 *   it. So a real Postgres (pglite) now: reads the window expression out of
 *   the LIVE definition of the writer (last by stamp), evaluates it at fixed
 *   instants inside one hour and across the hour's boundary, and asserts the
 *   bucket property -- one value inside the window, a new one exactly a
 *   window later; drives the writer over a row planted at the window's true
 *   start and asserts the counter increments rather than resets; and drives
 *   check_rate_limit (the visitor tier) the same way. TEETH: the definition
 *   before the window fix must fail the bucket property at two instants one
 *   minute apart.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf, sqlCodeOf } from "./helpers/strip-comments";

// PGLITE BOOTS A POSTGRES, SO ITS HOOK IS NOT A UNIT TEST.
vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const code = (rel: string) => codeOf(read(rel));

const FN_DIR = "supabase/functions/track-ab-event";
const BUDGET = code(`${FN_DIR}/budget.ts`);
const ENTRY = code(`${FN_DIR}/index.ts`);

/** `export const NAME = <number>;` in a comment-stripped module. */
function exportedNumber(src: string, name: string): number {
  const m = new RegExp(`export const ${name} = (\\d+);`).exec(src);
  expect(m, `${name} is not an exported integer constant`).not.toBeNull();
  return Number(m![1]);
}
function exportedString(src: string, name: string): string {
  const m = new RegExp(`export const ${name} = "([^"]+)";`).exec(src);
  expect(m, `${name} is not an exported string constant`).not.toBeNull();
  return m![1];
}

/** The element count of `const NAME = [ ... ]` in a comment-stripped module. */
function arrayLength(src: string, name: string): number {
  const m = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(src);
  expect(m, `${name} is not an array constant`).not.toBeNull();
  return m![1].split(",").map((s) => s.trim()).filter(Boolean).length;
}

/** Distinct quoted literals passed as the first argument of `fn(`. */
function literalArgsOf(src: string, fn: string): Set<string> {
  return new Set([...src.matchAll(new RegExp(`\\b${fn}\\(\\s*['"]([^'"]+)['"]`, "g"))].map((m) => m[1]));
}

/** The last migration whose code defines `public.<fn>` — what the database holds. */
function lastMigrationDefining(fn: string): string {
  const dir = resolve(ROOT, "supabase/migrations");
  const files = readdirSync(dir).filter((n) => n.endsWith(".sql")).sort();
  const hits = files.filter((f) => new RegExp(`FUNCTION\\s+public\\.${fn}\\s*\\(`, "i").test(sqlCodeOf(read(`supabase/migrations/${f}`))));
  expect(hits.length, `no migration defines ${fn}`).toBeGreaterThan(0);
  return sqlCodeOf(read(`supabase/migrations/${hits[hits.length - 1]}`));
}

// ---------------------------------------------------------------------------
// A journey's size, derived from the client.
// ---------------------------------------------------------------------------

/**
 * The most distinct rows one visitor's first-hour journey can produce, by
 * family. Every term is read from the hook that emits the family. (The two
 * A/B sites on the landing hero and the one on the results are counted as
 * sites in the tree; the optimisation events counted are the once-per-session
 * ones a mount can fire.)
 */
function journeySize(): { total: number; terms: Record<string, number> } {
  const terms: Record<string, number> = {
    scroll_milestones: arrayLength(code("src/hooks/use-scroll-depth.ts"), "SCROLL_MILESTONES"),
    time_milestones: arrayLength(code("src/hooks/use-time-on-page.ts"), "TIME_MILESTONES"),
    funnel_stages: arrayLength(code("src/hooks/use-funnel-tracking.ts"), "FUNNEL_STAGES"),
    cohort_events: literalArgsOf(code("src/hooks/use-cohort-tracking.ts"), "trackCohortEvent").size,
    ab_sites: ["src/components", "src/pages"].reduce((n, dir) => n + countInTree(dir, /\buseABTest\(/g), 0),
    optimization_once_events: literalArgsOf(code("src/hooks/use-optimization-tracking.ts"), "trackOnce").size,
    product_event_kinds: (() => {
      const m = /eventType: ((?:'[a-z_]+'\s*\|\s*)+'[a-z_]+')/.exec(code("src/hooks/use-conversion-tracking.ts"));
      expect(m, "the product event kinds union was not found").not.toBeNull();
      return m![1].split("|").length;
    })(),
    // The board's family, which the first build's derivation left out: every
    // literal variant handed to the board's tracker (and the handoff
    // component's `track` prop, which is that tracker), plus every literal
    // variant posted under the job_board test name anywhere in src.
    job_board_variants: boardVariants().size,
  };
  for (const [k, v] of Object.entries(terms)) expect(v, `${k} derived as zero — the derivation is not reading the hook`).toBeGreaterThan(0);
  return { total: Object.values(terms).reduce((a, b) => a + b, 0), terms };
}

/** Distinct variants of the job_board family, derived from every app file under src. */
function boardVariants(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, name.name);
      if (name.isDirectory()) { if (name.name !== "test") walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(name.name) || /\.test\.(ts|tsx)$/.test(name.name)) continue;
      const src = codeOf(readFileSync(p, "utf8"));
      for (const m of src.matchAll(/\btrackBoard\(\s*["']([a-z_]+)["']/g)) out.add(m[1]);
      for (const m of src.matchAll(/\btestName:\s*["']job_board["'],\s*variant:\s*["']([a-z_]+)["']/g)) out.add(m[1]);
      // The handoff component receives the board's tracker as `track`.
      if (/track:\s*\(variant: string/.test(src) || /track=\{trackBoard\}/.test(src)) {
        for (const m of src.matchAll(/\btrack\(\s*["']([a-z_]+)["']/g)) out.add(m[1]);
      }
    }
  };
  walk(resolve(ROOT, "src"));
  return out;
}

function countInTree(relDir: string, re: RegExp): number {
  let n = 0;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, name.name);
      if (name.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(name.name) || /\.test\.(ts|tsx)$/.test(name.name)) continue;
      n += (codeOf(readFileSync(p, "utf8")).match(re) ?? []).length;
    }
  };
  walk(resolve(ROOT, relDir));
  return n;
}

// ---------------------------------------------------------------------------

describe("the two-tier budget's numbers respect what they must", () => {
  const visitorBudget = exportedNumber(BUDGET, "VISITOR_BUDGET_PER_HOUR");
  const addressCeiling = exportedNumber(BUDGET, "ADDRESS_CEILING_PER_HOUR");
  const windowMinutes = exportedNumber(BUDGET, "BUDGET_WINDOW_MINUTES");
  const visitorFunction = exportedString(BUDGET, "VISITOR_BUDGET_FUNCTION");

  it("a real visitor never trips the visitor budget: it admits three full journeys an hour", () => {
    const journey = journeySize();
    // Printed so the number's provenance travels with a failure.
    const why = `journey = ${JSON.stringify(journey.terms)} = ${journey.total}; budget ${visitorBudget}`;
    expect(visitorBudget, why).toBeGreaterThanOrEqual(3 * journey.total);
    expect(windowMinutes).toBe(60);
  });

  it("a shared address admits at least ten visitors' budgets", () => {
    expect(addressCeiling).toBeGreaterThanOrEqual(10 * visitorBudget);
  });

  it("the visitor budget is under check_rate_limit's own bound, or the tier fails open on every call", () => {
    const sql = lastMigrationDefining("check_rate_limit");
    const m = /p_max_requests\s*>\s*(\d+)\s+THEN\s+RAISE/i.exec(sql);
    expect(m, "check_rate_limit's upper bound on p_max_requests was not found").not.toBeNull();
    expect(visitorBudget).toBeLessThanOrEqual(Number(m![1]));
    expect(visitorBudget).toBeGreaterThanOrEqual(1);
  });

  it("neither tier writes under a function name the front door's budget counts", () => {
    const sql = lastMigrationDefining("check_global_rate_limit");
    const marker = "v_budgeted TEXT[] := ARRAY[";
    const start = sql.indexOf(marker);
    expect(start, "the budgeted-set array was renamed or removed").toBeGreaterThan(-1);
    const from = start + marker.length;
    const end = sql.indexOf("]", from);
    const counted = [...sql.slice(from, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(counted.length).toBeGreaterThan(0);
    expect(counted).not.toContain(visitorFunction);
    expect(counted).not.toContain("track-ab-event");
    // The visitor tier's name is its own, not the address tier's, or the two
    // counters would share a row.
    expect(visitorFunction).not.toBe("track-ab-event");
  });
});

describe("the entry point is a parser around the budget, and every answer names its build", () => {
  it("calls no RPC of its own and carries no rate number — the budget cannot be bypassed around budget.ts", () => {
    expect(ENTRY).toMatch(/from "\.\/budget\.ts"/);
    expect(ENTRY).toContain("recordEvent(");
    expect(ENTRY.includes("track_ab_event_optimized"), "the writer is called from the entry point, around the visitor tier").toBe(false);
    expect(ENTRY.includes("check_rate_limit"), "a rate check lives in the entry point, outside the tested budget").toBe(false);
    expect(/RATE_LIMIT\s*=\s*\d+/.test(ENTRY), "a rate number is typed in the entry point").toBe(false);
  });

  it("declares a build version and every response carries it", () => {
    const m = /const BUILD_VERSION = "(\d{4}-\d{2}-\d{2}\.\d+)";/.exec(ENTRY);
    expect(m, "no BUILD_VERSION in the entry point").not.toBeNull();
    expect(m![1] >= "2026-09-27.1").toBe(true);
    // The one response builder spreads the build into every body it makes,
    // and the entry point makes no Response of its own outside it (bar the
    // CORS preflight, which has no body).
    expect(ENTRY).toMatch(/JSON\.stringify\(\{ \.\.\.body, build: BUILD_VERSION \}\)/);
    const bare = ENTRY.match(/new Response\(/g) ?? [];
    expect(bare.length, "a Response is built outside the json helper").toBe(2);
    expect(ENTRY).toMatch(/new Response\(null, \{ headers: corsHeaders \}\)/);
    // And the preflight -- the one answer with no body -- carries it as a
    // header, so a deploy is provable with an OPTIONS that writes no row.
    const cors = /const corsHeaders = \{([\s\S]*?)\};/.exec(ENTRY);
    expect(cors, "corsHeaders not found").not.toBeNull();
    expect(cors![1]).toMatch(/['"]x-fn-build['"]:\s*`track-ab-event\.\$\{BUILD_VERSION\}`/);
  });

  it("keeps success:true for every non-error outcome and adds the status the audit could not see", () => {
    expect(ENTRY).toMatch(/json\(\{ success: true, status: outcome\.status \}\)/);
  });

  it("the Deno test that drives the tiers sits beside the function, where the check:functions gate type-checks it", () => {
    expect(readdirSync(resolve(ROOT, FN_DIR))).toContain("budget_test.ts");
    const t = code(`${FN_DIR}/budget_test.ts`);
    for (const s of ["rate_limited_visitor", "rate_limited_address", "check_rate_limit", "track_ab_event_optimized"]) {
      expect(t, `the Deno test no longer exercises ${s}`).toContain(s);
    }
  });
});

// ---------------------------------------------------------------------------
// The window, in a real Postgres, read from the live definition.
// ---------------------------------------------------------------------------

const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const MIG_FILES = readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort();
const migRead = (n: string) => readFileSync(resolve(MIGRATIONS, n), "utf8");

/** Every terminated definition of `fn` across the migration set, oldest first: file and full statement text. */
function definitionsOf(fn: string): Array<{ file: string; text: string }> {
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?\\)\\s*RETURNS[\\s\\S]*?\\bAS\\s+\\$([A-Za-z_]*)\\$[\\s\\S]*?\\$\\1\\$;`,
    "gi",
  );
  const out: Array<{ file: string; text: string }> = [];
  for (const file of MIG_FILES) {
    const code = sqlCodeOf(migRead(file));
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) out.push({ file, text: m[0] });
  }
  if (!out.length) throw new Error(`no migration holds a terminated definition of ${fn}`);
  return out;
}

/** The expression a definition assigns to v_window_start. */
function windowExpressionOf(text: string): string {
  const m = /v_window_start\s*:=\s*([^;]+);/.exec(text);
  if (!m) throw new Error("no assignment to v_window_start in the definition");
  return m[1].trim();
}

/** The real CREATE TABLE for a table, lifted from the migration that created it. */
function tableDdl(stampPrefix: string, table: string): string {
  const file = MIG_FILES.find((n) => n.startsWith(stampPrefix));
  if (!file) throw new Error(`no migration starts with ${stampPrefix}`);
  const m = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?public\\.${table} \\([\\s\\S]*?\\);`).exec(sqlCodeOf(migRead(file)));
  if (!m) throw new Error(`${file} does not create ${table}`);
  return m[0];
}

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });

/** The window expression evaluated as the writer would, at a fixed instant, for a given window length. */
async function bucketAt(db: PGlite, expr: string, at: string, minutes: number): Promise<number> {
  const sql = expr.replace(/\bNOW\(\)/gi, "$1::timestamptz").replace(/\bp_window_minutes\b/g, "$2::int");
  const r = await db.query<{ e: number }>(`SELECT EXTRACT(EPOCH FROM (${sql}))::float8 AS e`, [at, minutes]);
  return r.rows[0].e;
}

describe("the writer's window is a bucket of BUDGET_WINDOW_MINUTES in the database, not a value that moves every minute", () => {
  const windowMinutes = exportedNumber(BUDGET, "BUDGET_WINDOW_MINUTES");
  const defs = definitionsOf("track_ab_event_optimized");
  const live = defs[defs.length - 1];
  let db: PGlite;
  beforeAll(async () => { db = new PGlite(); OPEN.push(db); });

  const T = (hms: string) => `2026-09-27T${hms}Z`;
  const epoch = (iso: string) => Date.parse(iso) / 1000;

  it("the live definition's expression gives ONE value inside a window and a value exactly one window later across its boundary", async () => {
    const expr = windowExpressionOf(live.text);
    const inside = [T("19:00:00"), T("19:23:13"), T("19:24:00"), T("19:59:59")];
    const values = await Promise.all(inside.map((t) => bucketAt(db, expr, t, windowMinutes)));
    expect(new Set(values).size, `${live.file}: ${inside.join(", ")} -> ${values.join(", ")}`).toBe(1);
    for (let i = 0; i < inside.length; i++) {
      expect(values[i], "the window start is not after the instant").toBeLessThanOrEqual(epoch(inside[i]));
      expect(epoch(inside[i]) - values[i], "the instant is inside its window").toBeLessThan(windowMinutes * 60);
    }
    const next = await bucketAt(db, expr, T("20:00:00"), windowMinutes);
    expect(next - values[0]).toBe(windowMinutes * 60);
  });

  it("holds for a window that is not an hour too (the parameter is honoured, not a constant hour)", async () => {
    const expr = windowExpressionOf(live.text);
    const a = await bucketAt(db, expr, T("19:07:00"), 15);
    const b = await bucketAt(db, expr, T("19:14:59"), 15);
    const c = await bucketAt(db, expr, T("19:15:00"), 15);
    expect(a).toBe(b);
    expect(c - a).toBe(15 * 60);
  });

  it("TEETH: the definition before the window fix fails the bucket property at two instants one minute apart", async () => {
    // Find the newest definition whose expression differs from the live one:
    // the one the window fix replaced.
    const older = [...defs].reverse().find((d) => windowExpressionOf(d.text) !== windowExpressionOf(live.text));
    expect(older, "no earlier definition with a different window expression -- the teeth have nothing to bite").toBeDefined();
    const expr = windowExpressionOf(older!.text);
    const a = await bucketAt(db, expr, T("19:23:13"), windowMinutes);
    const b = await bucketAt(db, expr, T("19:24:00"), windowMinutes);
    expect(a, `${older!.file}: the old expression gives the same value a minute apart -- it was not the minute-keyed one`).not.toBe(b);
  });
});

describe("both tiers, driven over planted rows (pglite)", () => {
  const visitorBudget = exportedNumber(BUDGET, "VISITOR_BUDGET_PER_HOUR");
  const addressCeiling = exportedNumber(BUDGET, "ADDRESS_CEILING_PER_HOUR");
  const windowMinutes = exportedNumber(BUDGET, "BUDGET_WINDOW_MINUTES");
  const visitorFunction = exportedString(BUDGET, "VISITOR_BUDGET_FUNCTION");
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    OPEN.push(db);
    await db.exec(tableDdl("20251216002238", "rate_limits"));
    await db.exec(tableDdl("20251217181914", "ab_test_events"));
    const writer = definitionsOf("track_ab_event_optimized");
    await db.exec(writer[writer.length - 1].text);
    const limiter = definitionsOf("check_rate_limit");
    await db.exec(limiter[limiter.length - 1].text);
  });

  /** One call to the writer as the address tier makes it, inside a transaction so NOW() is one instant. */
  const write = (tx: { query: PGlite["query"] }, ip: string, visitor: string) =>
    tx.query<{ status: string }>(
      "SELECT public.track_ab_event_optimized('conversion_funnel', 'landing_view', 'view', $1, '{}'::jsonb, $2, $3, $4)->>'status' AS status",
      [visitor, ip, addressCeiling, windowMinutes],
    ).then((r) => r.rows[0].status);

  const counter = (tx: { query: PGlite["query"] }, fn: string, ip: string) =>
    tx.query<{ n: number; at_window_start: boolean }>(
      "SELECT request_count AS n, window_start = date_trunc('hour', now()) AS at_window_start FROM public.rate_limits WHERE function_name = $1 AND ip_address = $2",
      [fn, ip],
    ).then((r) => r.rows[0]);

  it("the address tier increments a counter planted at the window's true start instead of resetting it", async () => {
    expect(windowMinutes, "this case plants at the top of the hour").toBe(60);
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO public.rate_limits (function_name, ip_address, window_start, request_count) VALUES ('track-ab-event', '203.0.113.10', date_trunc('hour', now()), 5)");
      expect(await write(tx, "203.0.113.10", "v-inc")).toBe("recorded");
      expect(await counter(tx, "track-ab-event", "203.0.113.10")).toEqual({ n: 6, at_window_start: true });
    });
  });

  it("the address tier refuses at the ceiling within the window and inserts nothing", async () => {
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO public.rate_limits (function_name, ip_address, window_start, request_count) VALUES ('track-ab-event', '203.0.113.11', date_trunc('hour', now()), $1)", [addressCeiling]);
      expect(await write(tx, "203.0.113.11", "v-cap")).toBe("rate_limited");
      const rows = await tx.query("SELECT 1 FROM public.ab_test_events WHERE visitor_id = 'v-cap'");
      expect(rows.rows).toEqual([]);
    });
  });

  it("the address tier resets a counter whose window has passed", async () => {
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO public.rate_limits (function_name, ip_address, window_start, request_count) VALUES ('track-ab-event', '203.0.113.12', date_trunc('hour', now()) - interval '1 hour', $1)", [addressCeiling]);
      expect(await write(tx, "203.0.113.12", "v-reset")).toBe("recorded");
      expect(await counter(tx, "track-ab-event", "203.0.113.12")).toEqual({ n: 1, at_window_start: true });
    });
  });

  it("the visitor tier is an hour too: a counter half an hour old is continued, one over an hour old is reset", async () => {
    const check = (tx: { query: PGlite["query"] }, ip: string) =>
      tx.query<{ ok: boolean }>("SELECT public.check_rate_limit($1, $2, $3, $4) AS ok", [ip, visitorFunction, visitorBudget, windowMinutes]).then((r) => r.rows[0].ok);
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO public.rate_limits (function_name, ip_address, window_start, request_count) VALUES ($1, 'visitor-half-hour', now() - interval '30 minutes', $2)", [visitorFunction, visitorBudget - 1]);
      expect(await check(tx, "visitor-half-hour"), "the last allowed attempt").toBe(true);
      expect(await check(tx, "visitor-half-hour"), "the one past the budget").toBe(false);
      await tx.query("INSERT INTO public.rate_limits (function_name, ip_address, window_start, request_count) VALUES ($1, 'visitor-stale', now() - interval '61 minutes', $2)", [visitorFunction, visitorBudget]);
      expect(await check(tx, "visitor-stale"), "an expired window is reset").toBe(true);
    });
  });
});
