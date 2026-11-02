// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { normalizeCloseTitle } from "../../supabase/functions/job-board/normalize";

/**
 * A LAPPED BOARD CHECKED A CLOSED TITLE AGAINST ONE WINDOW OF ITS LAP (S10-002).
 *
 * The biggest employers (CVS, Marriott, O'Reilly, Dollar Tree, Domino's) are
 * read in 250-row windows that together make a lap, and only the visit that
 * proves the lap may close a posting. The closure's `superseded` bit (is the
 * same title still live on the board?) was computed from that one visit's rows
 * alone, so a requisition re-listed under a new id that an EARLIER window of
 * the lap served was written to the ledger as a fill. Live on .96, 2026-11-01:
 * get_company_hiring_health gave superseded_90d = 0 on all five against 1,291
 * to 46,214 closures, where ten whole-read Greenhouse boards log 3-27% of
 * theirs superseded (a floor: one per title per day).
 *
 * This runs the SHIPPED code: the liveTitles statement of the refresh worker
 * and closeVanishedChunk, lifted from index.ts and transpiled, over a fake
 * client, and reads the superseded bit off the closure rows it inserts.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

function lifted(name: string, kind: "async function" | "function" = "async function"): string {
  const at = FN.indexOf(`\n${kind} ${name}(`);
  expect(at, `${name} not found in job-board/index.ts`).toBeGreaterThan(-1);
  const src = FN.slice(at + 1, FN.indexOf("\n}\n", at) + 2);
  return ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
const liveTitlesSpan = (() => {
  const a = FN.indexOf("const liveTitles = new Set(");
  expect(a, "the liveTitles statement moved; re-point this test").toBeGreaterThan(-1);
  const b = FN.indexOf("\n          );\n", a);
  expect(b).toBeGreaterThan(a);
  return ts.transpileModule(FN.slice(a, b + "\n          );\n".length), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
})();
const liveTitlesOf = new Function(
  "rowsById", "existingById", "lapMode", "lapMark", "agedOutIds", "normalizeCloseTitle",
  `${liveTitlesSpan}\nreturn liveTitles;`,
) as (rowsById: Map<string, Record<string, unknown>>, existingById: Map<string, Ex>, lapMode: boolean, lapMark: number, agedOutIds: Set<string>, n: typeof normalizeCloseTitle) => Set<string>;

type Ex = { id: string; title: string; lap_epoch: number | null; missing_since: string | null; location?: string };
type Q = { table: string; op: string; rows?: unknown; filters: Array<[string, string, unknown]> };

const NOW = Date.parse("2026-11-01T06:00:00Z");
const fresh = new Date(NOW - 5 * 86_400_000).toISOString();
const T = "oreillyauto~wd1~oreilly";
const id = (n: string) => `workday:${T}:${n}`;
const posting = (n: string, title: string, location = "") => ({ id: id(n), source: "workday", company_token: T, title, location, category: "other", posted_at: fresh, first_seen: fresh });

/** One lap-proving visit: what it served, what the board stores, what vanished. */
async function closeOnLapEnd(o: {
  served: Array<{ n: string; title: string; location?: string }>;
  stored: Ex[];
  vanished: Array<{ n: string; title: string; location?: string }>;
  lapMode?: boolean;
  recentSuperseded?: string[];
  agedOut?: string[];
}) {
  const lapMark = 7;
  const lapMode = o.lapMode ?? true;
  const rowsById = new Map(o.served.map((r) => [id(r.n), { id: id(r.n), title: r.title, location: r.location ?? "" }]));
  const existingById = new Map(o.stored.map((r) => [r.id, r]));
  const agedOutIds = new Set(o.agedOut ?? []);
  const liveTitles = liveTitlesOf(rowsById, existingById, lapMode, lapMark, agedOutIds, normalizeCloseTitle);
  const calls: Q[] = [];
  const from = (table: string) => {
    const q: Q = { table, op: "", filters: [] };
    const b: Record<string, unknown> = {
      select() { if (!q.op) q.op = "select"; return b; },
      insert(rows: unknown) { q.op = "insert"; q.rows = rows; return b; },
      delete() { q.op = "delete"; return b; },
      in(c: string, v: unknown) { q.filters.push(["in", c, v]); return b; },
      eq() { return b; }, is() { return b; }, gt() { return b; }, order() { return b; }, limit() { return b; },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        calls.push(q);
        const data = table === "job_board_postings" && q.op === "select" ? o.vanished.map((v) => posting(v.n, v.title, v.location)) : null;
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return b;
  };
  const background: Promise<unknown>[] = [];
  const keys = {
    LIFECYCLE_SELECT: "*", EXIT_OPTIONAL_COLS: [], CLOSURE_OPTIONAL_COLS: [],
    tenureDays: () => ({ days: 5, basis: "stated" }), exitReasonFor: () => "aged_out", lifecycleFacets: () => ({}),
    normalizeCloseTitle, waitUntil: (p: Promise<unknown>) => { background.push(p); }, console: { warn: () => {}, log: () => {} },
  };
  const close = new Function(...Object.keys(keys),
    `${[lifted("settleInsertError"), lifted("insertExits"), lifted("closeVanishedChunk"), lifted("dropTombstones", "function")].join("\n")}\nreturn closeVanishedChunk;`,
  )(...Object.values(keys)) as (c: unknown, s: unknown, chunk: string[], ctx: unknown) => Promise<string[]>;
  const gone = await close({ from }, { source: "workday", token: T }, o.vanished.map((v) => id(v.n)), {
    closedAt: new Date(NOW).toISOString(), agedOutIds, freshCutoffMs: NOW - 30 * 86_400_000,
    liveTitles, recentSuperseded: new Set((o.recentSuperseded ?? []).map((t) => normalizeCloseTitle(t))), batchSuspect: false,
    absentInPass: o.vanished.length, removableBefore: 3_400, lapMode, lapBackfillUntil: "", missingSinceById: new Map(), startIso: new Date(NOW).toISOString(),
  });
  await Promise.allSettled(background);
  const closures = (calls.find((c) => c.table === "job_board_closures" && c.op === "insert")?.rows ?? []) as Array<{ posting_id: string; superseded: boolean; absence_basis: string }>;
  const exits = calls.filter((c) => c.table === "job_board_exits" && c.op === "insert").flatMap((c) => c.rows as Array<{ posting_id: string }>);
  return { gone, closures, exits, bit: (n: string) => closures.find((c) => c.posting_id === id(n))?.superseded };
}

/** The final window of the lap: what the lap-proving visit itself served. */
const TAIL = [{ n: "R900", title: "Parts Delivery Specialist" }, { n: "R901", title: "Distribution Center Night Shift" }];

describe("a lap-proving visit reads superseded from the whole lap, not its own window (S10-002)", () => {
  it("a closed requisition whose same-title sibling an EARLIER window of this lap served logs superseded=true", async () => {
    const r = await closeOnLapEnd({
      served: TAIL,
      stored: [{ id: id("R201237"), title: "Retail Service Specialist", lap_epoch: 7, missing_since: null }],
      vanished: [{ n: "R118000", title: "Retail Service Specialist" }],
    });
    expect(r.bit("R118000"), "a re-listed requisition was written to the ledger as a fill").toBe(true);
    expect(r.closures[0].absence_basis).toBe("lap");
  });

  it("a real fill still logs false: no same-title posting anywhere in the lap", async () => {
    const r = await closeOnLapEnd({
      served: TAIL,
      stored: [{ id: id("R201237"), title: "Retail Service Specialist", lap_epoch: 7, missing_since: null }],
      vanished: [{ n: "R118001", title: "Store Manager (Store 05627)" }],
    });
    expect(r.bit("R118001")).toBe(false);
  });

  it("a sibling the lap did NOT serve (an older lap stamped it) is no evidence: the closure stays a fill", async () => {
    const r = await closeOnLapEnd({
      served: TAIL,
      stored: [
        { id: id("R118002"), title: "Hub Driver", lap_epoch: 6, missing_since: null },
        { id: id("R118003"), title: "Hub Driver", lap_epoch: 7, missing_since: "2026-11-01T01:00:00Z" },
      ],
      vanished: [{ n: "R118004", title: "Hub Driver" }],
    });
    expect(r.bit("R118004")).toBe(false);
  });

  it("a sibling the freshness cap aged out this visit is no evidence either", async () => {
    const r = await closeOnLapEnd({
      served: TAIL,
      stored: [{ id: id("R118005"), title: "Commercial Specialist", lap_epoch: 7, missing_since: null }],
      vanished: [{ n: "R118006", title: "Commercial Specialist" }],
      agedOut: [id("R118005")],
    });
    expect(r.bit("R118006")).toBe(false);
  });

  it("a fill at one store is no relist because another store lists the same title: the lap matches title AND place", async () => {
    const r = await closeOnLapEnd({
      served: TAIL,
      stored: [{ id: id("R201237"), title: "Retail Service Specialist", lap_epoch: 7, missing_since: null, location: "Store 05627 Grove City OH" }],
      vanished: [
        { n: "R118010", title: "Retail Service Specialist", location: "Store 05812 Abilene TX" },
        { n: "R118011", title: "Retail Service Specialist (R118011)", location: "Store 05627, Grove City, OH" },
      ],
    });
    expect(r.bit("R118010"), "a closure at Abilene was written as a relist of Grove City's posting").toBe(false);
    expect(r.bit("R118011"), "the same title at the same store is the relist").toBe(true);
  });

  it("on a lap every closure is written, a repeat inside 24h included: no posting leaves with neither a closure nor an exit", async () => {
    const r = await closeOnLapEnd({
      served: TAIL,
      stored: [{ id: id("R201237"), title: "Retail Service Specialist", lap_epoch: 7, missing_since: null }],
      vanished: [{ n: "R118007", title: "Retail Service Specialist" }],
      recentSuperseded: ["Retail Service Specialist"],
    });
    expect(r.closures.map((c) => [c.posting_id, c.superseded])).toEqual([[id("R118007"), true]]);
    expect(r.exits.map((e) => e.posting_id)).toEqual([id("R118007")]);
    expect(r.gone).toEqual([id("R118007")]);
  });

  it("a whole read keeps main's 24h dedupe of a relisting board's repeats (n621)", async () => {
    const r = await closeOnLapEnd({
      served: [...TAIL, { n: "R201237", title: "Retail Service Specialist" }],
      stored: [],
      vanished: [{ n: "R118012", title: "Retail Service Specialist" }],
      recentSuperseded: ["Retail Service Specialist"],
      lapMode: false,
    });
    expect(r.closures).toEqual([]);
  });

  it("a whole read is unchanged: its own rows are the live set, stored lap stamps are not read", async () => {
    const stored = [{ id: id("R201237"), title: "Retail Service Specialist", lap_epoch: 7, missing_since: null }];
    const off = await closeOnLapEnd({ served: TAIL, stored, vanished: [{ n: "R118008", title: "Retail Service Specialist" }], lapMode: false });
    expect(off.bit("R118008")).toBe(false);
    expect(off.closures[0].absence_basis).toBe("full_read");
    const on = await closeOnLapEnd({ served: [...TAIL, { n: "R201237", title: "Retail Service Specialist" }], stored, vanished: [{ n: "R118009", title: "Retail Service Specialist" }], lapMode: false });
    expect(on.bit("R118009")).toBe(true);
  });
});
