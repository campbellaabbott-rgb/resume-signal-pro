// @vitest-environment node
//
// Node, not jsdom: the handler half bundles job-board with esbuild, which
// refuses jsdom's TextEncoder (see helpers/edge-harness.ts).
/**
 * AN ANONYMOUS CALLER CANNOT STEER THE INGEST, FORGE ITS RECORDS, OR PULL MORE
 * THAN A PAGE (job-board .88; defect-sweep 2026-10-02 items 2.12 and 2.24).
 *
 * WHAT WAS WRONG.
 *   2.12  `verify` queued the board of every id it was handed -- before
 *         probing, for ids that were never postings -- and the refresh put up
 *         to five queued boards at the head of EVERY cold slice for twenty
 *         minutes and never removed one. One anonymous request every twenty
 *         minutes could spend most of each slice's 1,500-posting budget on
 *         boards it chose, cutting the cold rotation by ~80% or more.
 *   2.24  a company token with a literal quote reached the list through
 *         supabase-js's .in() as a different token than the count's text[],
 *         so the page served one employer's rows under total 0, the
 *         filter-integrity sensor fired, and ONE overwritable meta row -- the
 *         board's only record of its last real incident -- was replaced with
 *         the caller's own filters. Live, a real workMode incident was lost.
 *   AND   every caller could ask list for 200 rows a call; audit and
 *         vendor-health took `force` from anyone (100 live probes / 35 vendor
 *         fetches a request); verify fanned out to 12 vendors a call;
 *         fit-batch's allowance keyed on the first forwarded hop, which the
 *         caller writes.
 *   REVIEW of the first .88 build, each finding held here:
 *         - the "daily" allowances were hourly: check_rate_limit's sweep
 *           deletes rows older than the CALLER's window, every caller passes
 *           60, so a 1,440-minute row died an hour in (proven in pglite in
 *           a-day-allowance-the-limiter-sweeps-is-an-hour.test.ts); they are
 *           hourly now, honestly;
 *         - the public x-rb-budget header lifted the page ceiling to 200;
 *           only a secret does now;
 *         - postedAfter was bound as the caller's string while the sensor
 *           read Date.parse of it, and V8 and Postgres read 'GMT-12' a day
 *           apart: an incident on demand. One canonical instant now, and an
 *           incident row is rewritten at most once per interval;
 *         - verify and the refresh both wrote the demand row whole, so a
 *           verify landing between a slice's read and write erased a served
 *           stamp. Two rows, one writer each;
 *         - searchQuality handed anon an aggregate the database revoked from
 *           it; status read the 1.5MB refresh row per call, uncounted.
 *   AND IN THE SAME PASS: host_sweep's only lock was 5 minutes and a read
 *         then a write, so a loop ran 200 outbound probes every 5 minutes and
 *         callers arriving together each ran a sweep; company-suggest, an
 *         autocomplete, re-read the whole refresh row per keystroke.
 *
 * WHAT THIS HOLDS, by running the shipped handler with only its network
 * faked (helpers/edge-harness.ts, helpers/proxy-db.ts) and by exercising the
 * pure rules in abuse-guards.ts.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, argOf, eqs, type Answer, type Query } from "./helpers/proxy-db";
import { codeOf } from "./helpers/strip-comments";
import { CATALOG } from "./helpers/catalog";
import {
  addressAllowance, admitDemand, ALLOWANCE_WINDOW_MINUTES, CLICK_PER_ADDRESS_HOUR, demandLaneStatus, DEMAND_COOLDOWN_MS, DEMAND_PER_HOUR,
  DEMAND_PER_SLICE, DEMAND_QUEUE_KEY, DEMAND_QUEUE_MAX, DEMAND_SERVED_KEY, DEMAND_TTL_MS, FIT_PER_ADDRESS_HOUR, INCIDENT_REWRITE_MS, incidentRows,
  LIMITER_MAX_REQUESTS, readDemand, recordServed, REPORT_PER_ADDRESS_HOUR, stampDemandServed, summariseIncidents, takeDemand,
  VERIFY_PER_ADDRESS_HOUR, writeIncidents, type DemandQueue, type DemandServed, type MetaDb,
} from "../../supabase/functions/job-board/abuse-guards";
import { BROWSER_PAGE_ROWS, pageCeiling, SERVER_PAGE_ROWS } from "../../supabase/functions/job-board/anon-budget";
import { canonicalInstant, COMPANY_TOKEN_SHAPE, filterViolations, normalizeFilters } from "../../supabase/functions/job-board/filters";
import { boardReaderHeader } from "../../supabase/functions/_shared/board-reader-key";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const INDEX = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
const H = (o: Record<string, string>) => new Headers(o);
const MIN = 60_000;

// ── 2.12: the demand lane, as rules ─────────────────────────────────────────

describe("2.12 the demand lane: one board a slice, a capped number an hour, each once a cooldown", () => {
  const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
  /** One lane, the way production holds it: two rows, verify writing one, the refresh the other. */
  type Lane = { queue: DemandQueue | null; served: DemandServed | null };
  const verifyAsks = (lane: Lane, tokens: string[], now: number) => { lane.queue = admitDemand(lane.queue, lane.served, tokens, now) ?? lane.queue; };
  const sliceTakes = (lane: Lane, now: number, eligible: (t: string) => boolean = () => true) => {
    const pick = takeDemand(lane.queue, lane.served, now, eligible);
    if (pick.served) lane.served = pick.served;
    return pick.take;
  };

  it("verify queues new boards, keeps a queued board's place, and refuses one still cooling", () => {
    const first = admitDemand(null, null, ["a", "b", "a"], T0)!;
    expect(first).toEqual({ tokens: [{ t: "a", at: T0 }, { t: "b", at: T0 }] });
    expect(admitDemand(first, null, ["a"], T0 + MIN), "a repeat cannot keep a board fresh forever").toBeNull();
    const cooled: DemandServed = { served: [{ t: "a", at: T0 }] };
    expect(admitDemand(null, cooled, ["a"], T0 + DEMAND_COOLDOWN_MS - MIN), "served inside the cooldown").toBeNull();
    expect(admitDemand(null, cooled, ["a"], T0 + DEMAND_COOLDOWN_MS + MIN)?.tokens?.map((e) => e.t), "and askable again after it").toEqual(["a"]);
    const stale = admitDemand({ tokens: [{ t: "old", at: T0 - DEMAND_TTL_MS - 1 }] }, null, ["n"], T0)!;
    expect(stale.tokens!.map((e) => e.t), "an expired request is dropped").toEqual(["n"]);
    const many = admitDemand(null, null, Array.from({ length: 100 }, (_, i) => `t${i}`), T0)!;
    expect(many.tokens).toHaveLength(DEMAND_QUEUE_MAX);
    expect(admitDemand({ tokens: "junk" } as unknown as DemandQueue, null, ["x"], T0)?.tokens, "an unreadable row is an empty queue").toEqual([{ t: "x", at: T0 }]);
    expect(Object.keys(admitDemand({ tokens: [], served: [{ t: "z", at: T0 }] } as DemandQueue, null, ["x"], T0)!), "verify's row is a queue and nothing else").toEqual(["tokens"]);
  });

  it("a cold slice takes at most one, only what it may take, and the taken board starts cooling in the served row", () => {
    const queue: DemandQueue = { tokens: ["hot", "b", "c"].map((t) => ({ t, at: T0 })) };
    const pick = takeDemand(queue, null, T0 + MIN, (t) => t !== "hot");
    expect(DEMAND_PER_SLICE).toBe(1);
    expect(pick.take).toEqual(["b"]);
    expect(pick.served).toEqual({ served: [{ t: "b", at: T0 + MIN }] });
    expect(takeDemand(queue, pick.served, T0 + 2 * MIN, () => true).take, "the next slice takes the next board, never b again").toEqual(["hot"]);
    expect(takeDemand(queue, null, T0 + MIN, () => false), "nothing eligible: nothing taken, nothing written").toEqual({ take: [], served: null });
    expect(recordServed({ served: [{ t: "b", at: T0 }] }, ["b", "c"], T0 + MIN), "a board already cooling keeps its stamp").toEqual({ served: [{ t: "b", at: T0 }, { t: "c", at: T0 + MIN }] });
  });

  it("THE REGISTER'S ATTACK: five large boards re-asked every minute for an hour of ~300 slices gets at most DEMAND_PER_HOUR boards, not five a slice", () => {
    const lane: Lane = { queue: null, served: null };
    let injected = 0;
    let slicesWithDemand = 0;
    for (let s = 0; s < 300; s++) {
      const now = T0 + s * 12_000;
      // Every minute the attacker re-sends five boards, rotating names so the cooldown cannot help.
      if (s % 5 === 0) verifyAsks(lane, [0, 1, 2, 3, 4].map((i) => `big${(s / 5) * 5 + i}`), now);
      const take = sliceTakes(lane, now);
      expect(take.length).toBeLessThanOrEqual(1);
      injected += take.length;
      if (take.length) slicesWithDemand++;
    }
    expect(DEMAND_PER_HOUR).toBe(12);
    expect(injected, "the lane's whole hour").toBe(DEMAND_PER_HOUR);
    // Before .88: five boards at the head of all 300 slices.
    expect(slicesWithDemand / 300).toBeLessThanOrEqual(0.04);
  });

  it("THE RACE THE REVIEW FOUND: a verify that read before a slice's write and writes after it cannot erase the served stamp or re-serve the board", () => {
    // Production order, interleaved: the slice reads both rows; a verify reads
    // both rows; the slice writes the served row; the verify writes the queue
    // from its stale read. With one shared row the verify's write carried the
    // stale `served` back and the board was taken again by the next slice.
    let queue: DemandQueue | null = admitDemand(null, null, ["a", "b"], T0);
    let served: DemandServed | null = null;
    let lanePerHour = 0;
    for (let s = 0; s < 300; s++) {
      const now = T0 + MIN + s * 12_000;
      const sliceRead = { queue, served };
      const verifyRead = { queue, served };
      const pick = takeDemand(sliceRead.queue, sliceRead.served, now, () => true);
      if (pick.served) served = pick.served;      // the refresh's write (its own row)
      lanePerHour += pick.take.length;
      // The verify asks for a fresh board every slice, and writes from its stale read.
      queue = admitDemand(verifyRead.queue, verifyRead.served, [`fresh${s}`, "a"], now) ?? queue;
      expect(Object.keys(queue ?? {}), "verify never writes a served stamp").toEqual(["tokens"]);
    }
    expect(served!.served!.filter((e) => e.t === "a"), "a was served once, and its stamp survived every verify write").toHaveLength(1);
    expect(lanePerHour, "the hour's cap holds under the interleaving").toBe(DEMAND_PER_HOUR);
  });

  it("status reports the lane as counts and its rules, never a board token", () => {
    const s = demandLaneStatus(
      { tokens: [{ t: "secret-board", at: T0 }, { t: "x", at: T0 - 5 * MIN }] },
      { served: [{ t: "x", at: T0 - 30 * MIN }, { t: "y", at: T0 - 2 * 3_600_000 }] },
      T0,
    );
    expect(s, "x is queued but cooling, so it is not waiting").toEqual({ queued: 1, servedLastHour: 1, cooling: 2, perSlice: 1, perHour: 12, cooldownMin: 180 });
    expect(JSON.stringify(s)).not.toMatch(/secret-board/);
    expect(INDEX).toMatch(/demandLane: demandLaneStatus\(demandRow\.queue, demandRow\.served, now\)/);
    expect(DEMAND_COOLDOWN_MS, "a re-queued taken board lapses before it could ever be taken again").toBeGreaterThan(DEMAND_TTL_MS);
  });

  it("the same five boards, re-asked forever, are each served once per cooldown", () => {
    const lane: Lane = { queue: null, served: null };
    const served: string[] = [];
    for (let s = 0; s < 900; s++) {
      const now = T0 + s * 12_000; // three hours
      verifyAsks(lane, ["w1", "w2", "w3", "w4", "w5"], now);
      served.push(...sliceTakes(lane, now));
    }
    expect(served.sort()).toEqual(["w1", "w2", "w3", "w4", "w5"]);
  });
});

// ── 2.24: the company token and the incident record, as rules ───────────────

describe("2.24 a company token is the catalogue's spelling, and the incident record holds nothing the caller wrote", () => {
  it("a token with a quote, a backslash, a comma or a bracket is refused and named, never bound", () => {
    for (const bad of ['"dominos"', 'x","dominos', "a,b", "a(b)", "a)", "a\\b", "", "has space", "x".repeat(129)]) {
      const n = normalizeFilters({ companies: [bad] }, 50_000);
      expect(n.applied.companies, JSON.stringify(bad)).toEqual([]);
      expect(n.ignored, JSON.stringify(bad)).toContain("companies");
    }
    const mixed = normalizeFilters({ companies: ['"dominos"', "acme"] }, 50_000);
    expect(mixed.applied.companies).toEqual(["acme"]);
    expect(mixed.ignored).toContain("companies");
    expect(normalizeFilters({ companies: ["no-such-company"] }, 50_000).ignored, "an unknown but well-formed token is a real question").not.toContain("companies");
  });

  it("every catalogued token passes the shape (so no real employer filter is refused)", () => {
    expect(CATALOG.length).toBeGreaterThan(40_000);
    const refused = CATALOG.filter((e) => !COMPANY_TOKEN_SHAPE.test(e.token)).map((e) => e.token);
    expect(refused).toEqual([]);
    for (const t of ["edel~us2~CX_1", "eu~acme", "binance.us", "Preference-Model"]) expect(COMPANY_TOKEN_SHAPE.test(t), t).toBe(true);
  });

  it("an incident is one row per field, keyed by the field, carrying only the served rows' own values", () => {
    const stamp = "2026-10-04T12:00:00.000Z";
    const rows = incidentRows([
      { field: "workMode", want: "remote", got: "onsite" },
      { field: "workMode", want: "remote", got: "hybrid" },
      { field: "department", want: "CALLER TEXT", got: "Sales" },
      { field: "bad field!", want: "x", got: "y" },
    ] as Array<{ field: string; want: string; got: string }>, 25, stamp);
    expect(rows.map((r) => r.k).sort()).toEqual(["filter_integrity_incident.department", "filter_integrity_incident.workMode"]);
    const wm = rows.find((r) => r.k.endsWith("workMode"))!;
    expect(wm).toEqual({ k: "filter_integrity_incident.workMode", v: { at: stamp, field: "workMode", violations: 2, rows: 25, sample: ["onsite", "hybrid"] }, updated_at: stamp });
    expect(JSON.stringify(rows), "the caller's text is not stored").not.toMatch(/CALLER TEXT|want|filters/);
  });

  it("status reads the newest stamp across fields; a page tripping one field cannot erase another's record", () => {
    const now = Date.parse("2026-10-04T13:00:00.000Z");
    const s = summariseIncidents([
      { k: "filter_integrity_incident.workMode", v: { at: "2026-10-04T10:00:00.000Z", violations: 7, rows: 60 } },
      { k: "filter_integrity_incident.companies", v: { at: "2026-10-04T12:00:00.000Z", violations: 3, rows: 3 } },
      { k: "filter_integrity_incident.country", v: { at: "2026-10-04T12:00:00.000Z", violations: 1, rows: 3 } },
      { k: "filter_integrity_incident", v: { at: "2026-10-04T12:30:00.000Z", fields: ["companies"] } },
    ], now);
    expect(s.lastIncidentAt).toBe("2026-10-04T12:00:00.000Z");
    expect(s.lastIncidentFields, "the fields one page wrote share its stamp").toEqual(["companies", "country"]);
    expect(s.lastIncidentViolations).toBe(4);
    expect(s.lastIncidentAgeMin).toBe(60);
    expect(s.incidents.workMode, "the older real incident is still there").toEqual({ at: "2026-10-04T10:00:00.000Z", ageMin: 180, violations: 7, rows: 60 });
    expect(Object.keys(s.incidents), "the legacy single row is not read").not.toContain("");
    expect(summariseIncidents(null, now)).toMatchObject({ lastIncidentAt: null, lastIncidentFields: null, incidents: {} });
  });

  it("the handler writes incidents through the per-field rows, and status reads them by prefix", () => {
    const honesty = INDEX.slice(INDEX.indexOf("const honesty = (jobs"), INDEX.indexOf("const unfiltered = isUnfiltered(applied);"));
    expect(honesty).toMatch(/writeIncidents\(client, incidentRows\(v, jobs\.length, new Date\(\)\.toISOString\(\)\)\)/);
    expect(honesty, "the caller's filters never reach the record").not.toMatch(/filters: applied/);
    expect(honesty).not.toMatch(/k: v\.length \? "filter_integrity_incident"/);
    expect(INDEX).toMatch(/\.like\("k", "filter_integrity_incident\.%"\)/);
    expect(INDEX).toMatch(/summariseIncidents\(Array\.isArray\(fiBad\.data\) \? fiBad\.data : null, Date\.now\(\)\)/);
  });
});

describe("postedAfter is one instant for the database and the sensor (review of .88)", () => {
  it("'GMT-12' and every other non-ISO spelling is refused and named, never bound", () => {
    for (const bad of ["2026-10-04 12:00 GMT-12", "2026-10-04 12:00 UTC-12", "2026-10-04 12:00 GMT-1", "Oct 4 2026", "2026-10-04T12:00:00+00", "1791115200000", "not-a-date", "2026-10-04T12:00:00 PST"]) {
      const n = normalizeFilters({ postedAfter: bad }, 50_000);
      expect(n.applied.postedAfter, bad).toBeNull();
      expect(n.ignored, bad).toContain("postedAfter");
    }
  });

  it("what is bound is the canonical instant, whatever ISO spelling arrived, and a time with no zone is UTC", () => {
    const cases: Array<[string, string]> = [
      ["2026-10-04", "2026-10-04T00:00:00.000Z"],
      ["2026-07-01T00:00:00Z", "2026-07-01T00:00:00.000Z"],
      ["2026-09-26T00:00:00+00:00", "2026-09-26T00:00:00.000Z"],
      ["2026-10-01T12:34:56.789123+00:00", "2026-10-01T12:34:56.789Z"],
      ["2026-10-04 12:00:00+00:00", "2026-10-04T12:00:00.000Z"],
      ["2026-10-04T12:00:00+0530", "2026-10-04T06:30:00.000Z"],
      ["2026-10-04T12:00:00-05:00", "2026-10-04T17:00:00.000Z"],
      ["2026-10-04T12:00", "2026-10-04T12:00:00.000Z"],
      [" 2026-10-04T12:00:00Z ", "2026-10-04T12:00:00.000Z"],
    ];
    for (const [raw, want] of cases) {
      expect(canonicalInstant(raw), raw).toBe(want);
      expect(normalizeFilters({ postedAfter: raw }, 50_000).applied.postedAfter, raw).toBe(want);
    }
  });

  it("THE REVIEW'S FORGERY: a row the database would admit under the bound value is never flagged by the sensor", () => {
    // The bound value IS the sensor's floor, so a row posted after it passes
    // both; before, Postgres admitted 06:00Z under 'GMT-12' and V8 flagged it.
    const bound = canonicalInstant("2026-10-04T12:00:00-12:00")!;
    expect(bound).toBe("2026-10-05T00:00:00.000Z");
    const applied = normalizeFilters({ postedAfter: "2026-10-04T12:00:00-12:00" }, 50_000).applied;
    expect(filterViolations([{ postedAt: "2026-10-05T06:00:00.000Z" }], applied)).toEqual([]);
    expect(filterViolations([{ postedAt: "2026-10-04T06:00:00.000Z" }], applied).map((x) => x.field), "and a row before it is still a violation").toEqual(["postedAfter"]);
  });
});

// ── the two meta writers, against a table that keeps its rows ───────────────

type MetaRow = { k: string; v: unknown; updated_at: string };
/**
 * job_board_meta as PostgREST answers the subset these writers use: select /
 * eq / in / lt filters, update (returning with .select), insert (23505 on an
 * existing key), upsert, maybeSingle. `beforeWrite` runs just before a write
 * lands, which is where a test puts the OTHER writer that read the same row.
 */
class MetaTable {
  rows = new Map<string, MetaRow>();
  beforeWrite: ((op: string, k: string) => void) | null = null;
  failSelect = false;
  log: string[] = [];
  put(k: string, v: unknown, updated_at: string) { this.rows.set(k, { k, v: structuredClone(v), updated_at }); }
  from(_table: string) {
    const st = { op: "select", patch: null as Partial<MetaRow> | null, filters: [] as Array<[string, string, unknown]>, returning: false };
    const matches = (r: MetaRow) => st.filters.every(([m, c, want]) => {
      const got = (r as Record<string, unknown>)[c];
      if (m === "eq") return got === want;
      if (m === "in") return (want as unknown[]).includes(got);
      if (m === "lt") return Date.parse(String(got)) < Date.parse(String(want));
      return true;
    });
    const keyOf = () => String((st.patch as MetaRow | null)?.k ?? st.filters.find(([m, c]) => m === "eq" && c === "k")?.[2] ?? "");
    const run = (): { data: unknown; error: { code?: string; message: string } | null } => {
      if (st.op === "select") {
        if (this.failSelect) return { data: null, error: { message: "read failed" } };
        return { data: [...this.rows.values()].filter(matches).map((r) => structuredClone(r)), error: null };
      }
      this.beforeWrite?.(st.op, keyOf());
      this.log.push(`${st.op}:${keyOf()}`);
      if (st.op === "update") {
        const hit = [...this.rows.values()].filter(matches);
        for (const r of hit) Object.assign(r, structuredClone(st.patch));
        return { data: st.returning ? hit.map((r) => ({ k: r.k })) : null, error: null };
      }
      const row = st.patch as MetaRow;
      if (st.op === "insert" && this.rows.has(row.k)) return { data: null, error: { code: "23505", message: "duplicate key" } };
      this.put(row.k, row.v, row.updated_at);
      return { data: null, error: null };
    };
    // deno-lint-ignore no-explicit-any
    const b: any = {
      select: () => { if (st.op === "select") return b; st.returning = true; return b; },
      eq: (c: string, v: unknown) => { st.filters.push(["eq", c, v]); return b; },
      in: (c: string, v: unknown[]) => { st.filters.push(["in", c, v]); return b; },
      lt: (c: string, v: unknown) => { st.filters.push(["lt", c, v]); return b; },
      update: (p: Partial<MetaRow>) => { st.op = "update"; st.patch = p; return b; },
      insert: (p: MetaRow) => { st.op = "insert"; st.patch = p; return b; },
      upsert: (p: MetaRow) => { st.op = "upsert"; st.patch = p; return b; },
      maybeSingle: () => Promise.resolve().then(() => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; }),
      then: (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, no),
    };
    return b;
  }
}
const servedOf = (t: MetaTable) => ((t.rows.get(DEMAND_SERVED_KEY)?.v ?? {}) as DemandServed).served?.map((e) => e.t).sort() ?? [];

describe("the served row has one writer and a stamp always lands (stampDemandServed, review of .88)", () => {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  it("the first stamp creates the row; the next merges onto it, keeping a board already cooling", async () => {
    const t = new MetaTable();
    await stampDemandServed(t as unknown as MetaDb, ["a"], now);
    expect(servedOf(t)).toEqual(["a"]);
    await stampDemandServed(t as unknown as MetaDb, ["b", "a"], now + MIN);
    expect(servedOf(t)).toEqual(["a", "b"]);
    const a = ((t.rows.get(DEMAND_SERVED_KEY)!.v as DemandServed).served ?? []).find((e) => e.t === "a")!;
    expect(a.at, "a's first stamp is kept, so its cooldown is not extended or reset").toBe(now);
  });

  it("THE INTERLEAVING: another slice writes between this slice's read and write; both stamps survive", async () => {
    const t = new MetaTable();
    t.put(DEMAND_SERVED_KEY, { served: [{ t: "x", at: now - MIN }] }, iso(now - MIN));
    let raced = false;
    t.beforeWrite = (op) => {
      if (raced || op !== "update") return;
      raced = true;
      t.put(DEMAND_SERVED_KEY, { served: [{ t: "x", at: now - MIN }, { t: "y", at: now }] }, iso(now + 1));
    };
    await stampDemandServed(t as unknown as MetaDb, ["a"], now);
    expect(raced).toBe(true);
    expect(servedOf(t), "the conditional write lost, re-read, and merged").toEqual(["a", "x", "y"]);
  });

  it("a verify writing the queue row between the read and the write cannot touch a served stamp", async () => {
    const t = new MetaTable();
    t.put(DEMAND_SERVED_KEY, { served: [{ t: "x", at: now - MIN }] }, iso(now - MIN));
    t.beforeWrite = (op, k) => {
      if (k === DEMAND_SERVED_KEY) t.put(DEMAND_QUEUE_KEY, { tokens: [{ t: "x", at: now }, { t: "a", at: now }] }, iso(now));
    };
    await stampDemandServed(t as unknown as MetaDb, ["a"], now);
    expect(servedOf(t)).toEqual(["a", "x"]);
    const lane = await readDemand(t as unknown as MetaDb);
    expect(takeDemand(lane.queue, lane.served, now + MIN, () => true).take, "both queued boards are cooling: nothing is taken twice").toEqual([]);
  });

  it("a writer that loses every race still lands its stamp, merged onto the last row it read", async () => {
    const t = new MetaTable();
    t.put(DEMAND_SERVED_KEY, { served: [{ t: "x", at: now - MIN }] }, iso(now - MIN));
    let n = 0;
    t.beforeWrite = (op) => { if (op === "update") t.put(DEMAND_SERVED_KEY, { served: [{ t: "x", at: now - MIN }, { t: `z${n}`, at: now }] }, iso(now + ++n)); };
    await stampDemandServed(t as unknown as MetaDb, ["a"], now);
    expect(t.log.filter((l) => l.startsWith("update")), "three conditional tries").toHaveLength(3);
    expect(t.log.at(-1)).toBe(`upsert:${DEMAND_SERVED_KEY}`);
    expect(servedOf(t)).toContain("a");
    expect(servedOf(t)).toContain("x");
  });

  it("a row that cannot be read is never overwritten blind", async () => {
    const t = new MetaTable();
    t.put(DEMAND_SERVED_KEY, { served: [{ t: "x", at: now - MIN }] }, iso(now - MIN));
    t.failSelect = true;
    await stampDemandServed(t as unknown as MetaDb, ["a"], now);
    expect(t.log).toEqual([]);
    expect(servedOf(t)).toEqual(["x"]);
  });
});

describe("an incident row is rewritten at most once per INCIDENT_REWRITE_MS (writeIncidents, review of .88)", () => {
  const rowsAt = (stamp: string) => incidentRows([{ field: "postedAfter", got: "2026-10-04T06:00:00Z" }], 3, stamp);

  it("a field with no row gets one; a loop of requests inside the interval writes nothing more", async () => {
    const t = new MetaTable();
    const first = new Date().toISOString();
    await writeIncidents(t as unknown as MetaDb, rowsAt(first));
    expect(t.rows.get("filter_integrity_incident.postedAfter")?.updated_at).toBe(first);
    for (let i = 0; i < 100; i++) await writeIncidents(t as unknown as MetaDb, rowsAt(new Date(Date.now() + i).toISOString()));
    expect(t.rows.get("filter_integrity_incident.postedAfter")?.updated_at, "the first stamp stands: a loop cannot keep it looking current").toBe(first);
  });

  it("a row older than the interval is rewritten, and only the field the page violated", async () => {
    const t = new MetaTable();
    const old = new Date(Date.now() - INCIDENT_REWRITE_MS - MIN).toISOString();
    t.put("filter_integrity_incident.postedAfter", { at: old }, old);
    t.put("filter_integrity_incident.workMode", { at: old, violations: 7 }, old);
    const stamp = new Date().toISOString();
    await writeIncidents(t as unknown as MetaDb, rowsAt(stamp));
    expect(t.rows.get("filter_integrity_incident.postedAfter")?.updated_at).toBe(stamp);
    expect(t.rows.get("filter_integrity_incident.workMode")?.v, "another field's record is untouched").toEqual({ at: old, violations: 7 });
    expect(INCIDENT_REWRITE_MS).toBe(10 * MIN);
  });
});

// ── the page ceiling and the per-address allowance, as rules ────────────────

describe("no call carries more rows than the caller's page, and allowances key on the platform's address", () => {
  it("the ceiling is the page's 60 for anyone without a secret -- the public tooling header included; our servers keep 200", async () => {
    expect(BROWSER_PAGE_ROWS).toBe(60);
    expect(SERVER_PAGE_ROWS).toBe(200);
    expect(await pageCeiling(H({}), "svc")).toBe(60);
    expect(await pageCeiling(H({ "x-rsp-caller": "mcp" }), "svc"), "a declaration is not a proof").toBe(60);
    // The header's value is in this repository (prerender-seo.mjs, the probes,
    // the botwall sweep): a scraper copying it used to read 200 a call.
    expect(await pageCeiling(H({ "x-rb-budget": "build" }), "svc"), "the bake's public header is not a secret").toBe(60);
    expect(await pageCeiling(H({ "x-rb-budget": "probe" }), "svc")).toBe(60);
    expect(await pageCeiling(H({ authorization: "Bearer svc" }), "svc")).toBe(200);
    expect(await pageCeiling(H({ ...(await boardReaderHeader("svc")) }), "svc")).toBe(200);
    expect(await pageCeiling(H({ authorization: "Bearer " }), ""), "an empty key matches nothing").toBe(60);
  });

  it("the allowance keys on the last hop's normalised address, exempts our servers, and never refuses on an error", async () => {
    const calls: Record<string, unknown>[] = [];
    const rpc = (verdict: unknown) => async (_n: string, a: Record<string, unknown>) => { calls.push(a); return { data: verdict, error: null }; };
    expect(await addressAllowance(rpc(false), H({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), "svc", "job-board-verify", VERIFY_PER_ADDRESS_HOUR)).toBe(false);
    expect(calls[0]).toEqual({ p_function: "job-board-verify", p_ip: "203.0.113.9", p_max_requests: 120, p_window_minutes: 60 });
    await addressAllowance(rpc(true), H({ "cf-connecting-ip": "2001:db8:1:2::77" }), "svc", "f", 1);
    expect(calls[1].p_ip, "an IPv6 host is its /64").toBe("2001:db8:1:2::/64");
    calls.length = 0;
    expect(await addressAllowance(rpc(false), H({ authorization: "Bearer svc", "cf-connecting-ip": "203.0.113.9" }), "svc", "f", 1)).toBe(true);
    expect(await addressAllowance(rpc(false), H({ ...(await boardReaderHeader("svc")), "cf-connecting-ip": "203.0.113.9" }), "svc", "f", 1)).toBe(true);
    expect(await addressAllowance(rpc(false), H({ "x-forwarded-for": "10.0.0.7" }), "svc", "f", 1), "a gateway hop is no shared wall").toBe(true);
    expect(await addressAllowance(rpc(false), H({}), "svc", "f", 1)).toBe(true);
    expect(calls, "none of those asked the limiter").toEqual([]);
    expect(await addressAllowance(async () => ({ data: null, error: { message: "boom" } }), H({ "cf-connecting-ip": "203.0.113.9" }), "svc", "f", 1)).toBe(true);
    expect(await addressAllowance(async () => { throw new Error("socket"); }, H({ "cf-connecting-ip": "203.0.113.9" }), "svc", "f", 1)).toBe(true);
  });

  it("every allowance is hourly -- the longest window the limiter's sweep keeps -- and inside the limiter's bound", async () => {
    expect(ALLOWANCE_WINDOW_MINUTES, "a longer window is deleted by any 60-minute caller's sweep").toBe(60);
    for (const [name, n] of Object.entries({ VERIFY_PER_ADDRESS_HOUR, REPORT_PER_ADDRESS_HOUR, CLICK_PER_ADDRESS_HOUR, FIT_PER_ADDRESS_HOUR })) {
      expect(n, `${name}: above the limiter's bound it raises, and an error is answered as allowed`).toBeLessThanOrEqual(LIMITER_MAX_REQUESTS);
      expect(n, name).toBeGreaterThanOrEqual(1);
    }
    expect([VERIFY_PER_ADDRESS_HOUR, REPORT_PER_ADDRESS_HOUR, CLICK_PER_ADDRESS_HOUR, FIT_PER_ADDRESS_HOUR]).toEqual([120, 10, 300, 60]);
    // A constant raised past the bound stays a cap: it is sent clamped, never as an error.
    const sent: Record<string, unknown>[] = [];
    await addressAllowance(async (_n, a) => { sent.push(a); return { data: true, error: null }; }, H({ "cf-connecting-ip": "203.0.113.9" }), "svc", "f", 50_000);
    expect(sent[0]).toMatchObject({ p_max_requests: LIMITER_MAX_REQUESTS, p_window_minutes: 60 });
  });
});

// ── the handler ─────────────────────────────────────────────────────────────

const SVC = "svc_harness_key";
const GH = CATALOG.find((e) => e.source === "greenhouse" && /^[a-z0-9]+$/.test(e.token))!;
const GH2 = CATALOG.filter((e) => e.source === "greenhouse" && /^[a-z0-9]+$/.test(e.token))[1]!;

describe("the handler, run with only its network faked", () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SVC };
  let handler: EdgeHandler;
  let db: ProxyDb;
  let answers: Array<(q: Query) => Answer | undefined>;
  let pending: Promise<unknown>[];
  const fetched: string[] = [];
  beforeAll(async () => {
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
    globalThis.fetch = (async (u: unknown) => { fetched.push(String(u)); return new Response("no network in tests", { status: 503 }); }) as typeof fetch;
    handler = await loadEdgeHandler("job-board", {
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__jbDb; }",
    });
  });
  beforeEach(() => {
    db = new ProxyDb();
    answers = [];
    pending = [];
    fetched.length = 0;
    db.answer = (q) => {
      for (const a of answers) { const r = a(q); if (r) return r; }
      if (q.table === "job_board_meta" && eqs(q, "k", "refresh_head")) {
        return { data: { v: { companiesCount: 10, total: 1000, coverage: { open: 1000 } }, updated_at: new Date().toISOString() }, error: null };
      }
      return undefined;
    };
    g.__jbDb = db;
  });
  const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    handler(new Request("https://h.supabase.co/functions/v1/job-board", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", origin: "https://resumebooster.work", ...headers },
      body: JSON.stringify(body),
    }));
  const limiterSays = (fn: string, verdict: boolean) => answers.push((q) => (q.rpc === "check_rate_limit" && (q.calls[0][1][0] as Record<string, unknown>).p_function === fn ? { data: verdict, error: null } : undefined));
  /** The distinct last row index every posting read asked for (one read unfiltered, two with a count). */
  const listRange = () => [...new Set(db.on("job_board_postings", "range").map((q) => argOf(q, "range", 1) as number))];

  it("the preflight names the deployed build", async () => {
    const res = await handler(new Request("https://h.supabase.co/functions/v1/job-board", { method: "OPTIONS" }));
    // Whatever BUILD_VERSION the bundle carries (build-version-guard pins the
    // value); .88 introduced the header, and a later bump must not break it.
    const v = /const BUILD_VERSION = "([^"]+)"/.exec(codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8")))?.[1];
    expect(v, "BUILD_VERSION not found").toMatch(/^2026-09-09\.(8[89]|9\d|\d{3,})$/);
    expect(res.headers.get("x-fn-build")).toBe(`job-board.${v}`);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("a browser asking list for 1000 rows reads one page of 60, and so does the public tooling header; only a secret reads 200", async () => {
    const page = { action: "list", limit: 1000, groupSimilar: false };
    expect((await post(page)).status).toBe(200);
    expect(listRange(), "rows 0..59").toEqual([59]);
    db.queries = [];
    await post({ ...page, limit: 60 });
    expect(listRange(), "the page's own ask is unchanged").toEqual([59]);
    db.queries = [];
    await post({ ...page, limit: 20 });
    expect(listRange(), "a smaller ask is honoured").toEqual([19]);
    for (const h of [{ "x-rb-budget": "probe" }, { "x-rb-budget": "build" }]) {
      db.queries = [];
      await post(page, h);
      expect(listRange(), JSON.stringify(h)).toEqual([59]);
    }
    for (const h of [{ authorization: `Bearer ${SVC}` }, await boardReaderHeader(SVC)]) {
      db.queries = [];
      await post(page, h);
      expect(listRange(), JSON.stringify(Object.keys(h))).toEqual([199]);
    }
    db.queries = [];
    await post({ action: "list", limit: 1000 });
    expect(listRange(), "grouped: three rows read per row shown, still one page's worth").toEqual([179]);
  });

  it("a quoted company token is refused and named; it never reaches .in() as another employer", async () => {
    const res = await post({ action: "list", companies: ['"dominos"', 'x","dominos'], groupSimilar: false });
    const body = await res.json();
    expect(body.ignoredFilters).toContain("companies");
    const bound = db.on("job_board_postings", "in").map((q) => argOf(q, "in", 1));
    expect(JSON.stringify(bound)).not.toMatch(/dominos/);
    expect(JSON.stringify(db.rpcArgs("count_jobs_capped"))).not.toMatch(/dominos/);
  });

  it("verify probes five ids at most, and queues a board only for a posting the board holds", async () => {
    const held = `greenhouse:${GH.token}:111`;
    answers.push((q) => (q.table === "job_board_postings" && q.calls.some(([m]) => m === "in") && argOf(q, "select") === "id, apply_url"
      ? { data: [{ id: held, apply_url: null }], error: null } : undefined));
    const ids = [held, ...Array.from({ length: 11 }, (_, i) => `greenhouse:${GH2.token}:${900 + i}`)];
    const res = await post({ action: "verify", ids });
    expect(res.status).toBe(200);
    const live = (await res.json()).live as Record<string, unknown>;
    expect(Object.keys(live)).toHaveLength(5);
    expect(fetched.filter((u) => u.includes("greenhouse")).length, "one vendor probe per id, five ids").toBe(5);
    const demand = db.on("job_board_meta", "upsert").map((q) => argOf(q, "upsert") as { k: string; v: DemandQueue }).filter((u) => u.k === "demand");
    expect(demand).toHaveLength(1);
    expect(demand[0].v.tokens!.map((e) => e.t), "the held posting's board, and not the board of ids it never stored").toEqual([GH.token]);
    expect(Object.keys(demand[0].v), "verify writes the queue, never a served stamp").toEqual(["tokens"]);
    const writes = db.queries.filter((q) => q.table === "job_board_meta" && q.calls.some(([m]) => m === "upsert" || m === "update" || m === "insert"));
    expect(writes.map((q) => JSON.stringify(q.calls)).join(" "), "verify never touches the served row").not.toMatch(/demand_served/);
  });

  it("verify of ids the board never stored queues nothing", async () => {
    await post({ action: "verify", ids: [`greenhouse:${GH.token}:404404`] });
    expect(db.on("job_board_meta", "upsert").map((q) => (argOf(q, "upsert") as { k: string }).k)).not.toContain("demand");
  });

  it("verify past its per-address allowance is a 429 the page does not mistake for the board budget, and probes nothing", async () => {
    limiterSays("job-board-verify", false);
    const res = await post({ action: "verify", ids: [`greenhouse:${GH.token}:1`] }, { "x-forwarded-for": "6.6.6.6, 198.51.100.4", "cf-connecting-ip": "" });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ rateLimited: true });
    expect(body.error, "board_budget latches a standing refusal of the whole board in the page").not.toBe("board_budget");
    expect(db.rpcArgs("check_rate_limit")[0]).toMatchObject({ p_function: "job-board-verify", p_ip: "198.51.100.4", p_max_requests: 120, p_window_minutes: 60 });
    expect(fetched).toEqual([]);
    expect(db.on("job_board_postings")).toEqual([]);
  });

  it("the service key never meets the verify allowance", async () => {
    limiterSays("job-board-verify", false);
    const res = await post({ action: "verify", ids: [`greenhouse:${GH.token}:1`] }, { authorization: `Bearer ${SVC}` });
    expect(res.status).toBe(200);
    expect(db.rpcArgs("check_rate_limit")).toEqual([]);
  });

  it("report past its allowance records nothing; click past its allowance answers and records nothing", async () => {
    limiterSays("job-board-report", false);
    limiterSays("job-board-click", false);
    const rep = await post({ action: "report", id: `greenhouse:${GH.token}:1`, reason: "gone" });
    expect(rep.status).toBe(429);
    expect((await rep.json()).error).not.toBe("board_budget");
    expect(db.on("job_board_posting_reports")).toEqual([]);
    const click = await post({ action: "click", postingId: `greenhouse:${GH.token}:1` });
    expect(click.status).toBe(200);
    await Promise.all(pending);
    expect(db.on("job_board_search_clicks")).toEqual([]);
    expect(db.rpcArgs("check_rate_limit").map((a) => [a.p_function, a.p_max_requests, a.p_window_minutes])).toEqual([["job-board-report", 10, 60], ["job-board-click", 300, 60]]);
  });

  it("within the allowance a report and a click are recorded as before", async () => {
    const rep = await post({ action: "report", id: `greenhouse:${GH.token}:1`, reason: "other" });
    expect(rep.status).toBe(200);
    expect(db.on("job_board_posting_reports", "insert")).toHaveLength(1);
    await post({ action: "click", postingId: `greenhouse:${GH.token}:1` });
    await Promise.all(pending);
    expect(db.on("job_board_search_clicks", "insert")).toHaveLength(1);
  });

  it("fit-batch's allowance keys on the platform's address, never the first forwarded hop", async () => {
    await post({ action: "fit-batch", resumeText: "x ".repeat(80), ids: ["greenhouse:a:1"] }, { "cf-connecting-ip": "", "x-forwarded-for": "6.6.6.6, 203.0.113.50" });
    expect(db.rpcArgs("check_rate_limit")).toEqual([{ p_function: "job-board-fit", p_ip: "203.0.113.50", p_max_requests: 60, p_window_minutes: 60 }]);
  });

  it("audit and vendor-health take force only from maintenance, and an expired cache starts one run", async () => {
    const fresh = new Date().toISOString();
    answers.push((q) => (q.table === "job_board_meta" && (eqs(q, "k", "audit") || eqs(q, "k", "vendor_health")) && q.mode === "maybe"
      ? { data: { v: { at: fresh, note: "cached" }, updated_at: fresh }, error: null } : undefined));
    for (const action of ["audit", "vendor-health"]) {
      const res = await post({ action, force: true });
      expect(await res.json(), action).toMatchObject({ cached: true });
    }
    expect(fetched, "no vendor was probed").toEqual([]);
    expect(db.on("job_board_postings"), "no audit sample was drawn").toEqual([]);
  });

  it("with the cache expired and a run already claimed, a caller gets the old result, not a second run", async () => {
    const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
    answers.push((q) => (q.table === "job_board_meta" && (eqs(q, "k", "audit") || eqs(q, "k", "vendor_health")) && q.mode === "maybe"
      ? { data: { v: { at: old }, updated_at: old }, error: null } : undefined));
    // The claim: the conditional update matches no row, and the insert meets the row another caller holds.
    answers.push((q) => (q.table === "job_board_meta" && q.calls.some(([m]) => m === "lt") ? { data: [], error: null } : undefined));
    answers.push((q) => (q.table === "job_board_meta" && q.calls.some(([m]) => m === "insert") ? { data: null, error: { code: "23505", message: "duplicate key" } } : undefined));
    for (const action of ["audit", "vendor-health"]) {
      const res = await post({ action });
      expect(await res.json(), action).toMatchObject({ cached: true, running: true });
    }
    expect(fetched).toEqual([]);
    expect(db.on("job_board_postings")).toEqual([]);
  });

  it("searchQuality is maintenance only: anon gets 403 and the aggregate is never computed", async () => {
    for (const h of [{}, { "x-rb-budget": "probe" }, await boardReaderHeader(SVC)]) {
      const res = await post({ action: "searchQuality", days: 90 }, h);
      expect(res.status, JSON.stringify(Object.keys(h))).toBe(403);
    }
    expect((await post({ action: "searchQuality", days: 90, chainKey: "guess" })).status).toBe(403);
    expect(db.rpcArgs("get_search_quality"), "no anonymous call reached the RPC migration 20260821133259 revoked from anon").toEqual([]);
    const ok = await post({ action: "searchQuality", days: 90 }, { authorization: `Bearer ${SVC}` });
    expect(ok.status).not.toBe(403);
    expect(db.rpcArgs("get_search_quality")).toEqual([{ p_days: 90 }]);
  });

  it("status reads one field of the refresh row, and an anonymous loop is answered from the isolate's last answer", async () => {
    const first = await post({ action: "status" }, { authorization: `Bearer ${SVC}` });
    expect(first.status).toBe(200);
    const fat = db.on("job_board_meta").filter((q) => eqs(q, "k", "refresh"));
    expect(fat.map((q) => argOf(q, "select")), "never the whole 1.3-1.6MB row").toEqual(["total:v->total, updated_at"]);
    const version = (await first.json()).version;
    db.queries = [];
    for (let i = 0; i < 5; i++) {
      const res = await post({ action: "status" });
      expect(res.status).toBe(200);
      expect((await res.json()).version).toBe(version);
      expect(Number(res.headers.get("x-status-age-ms"))).toBeLessThan(30_000);
    }
    expect(db.queries, "five anonymous status calls, zero database reads").toEqual([]);
    await post({ action: "status" }, { authorization: `Bearer ${SVC}` });
    expect(db.queries.length, "the service key always reads fresh").toBeGreaterThan(0);
  });

  it("host_sweep: anon gets one sweep per arrival gap, the cron's hour still passes, and two callers together run one sweep", async () => {
    const meta = (arrivedMinAgo: number, writtenMinAgo: number) => {
      const written = new Date(Date.now() - writtenMinAgo * MIN).toISOString();
      return { data: { v: { cursor: 1, list: [{ host: "a.example", postings: 1 }, { host: "b.example", postings: 1 }], hosts: {}, lastArrivedAt: new Date(Date.now() - arrivedMinAgo * MIN).toISOString() }, updated_at: written }, error: null };
    };
    let row = meta(10, 8);
    let claim: Answer = { data: [], error: null };
    answers.push((q) => (q.table === "job_board_meta" && eqs(q, "k", "host_sweep") && q.mode === "maybe" ? row : undefined));
    answers.push((q) => (q.table === "job_board_meta" && eqs(q, "k", "host_sweep") && q.calls.some(([m]) => m === "update") ? claim : undefined));
    const claims = () => db.on("job_board_meta", "update").filter((q) => eqs(q, "k", "host_sweep"));

    expect(await (await post({ action: "host_sweep" })).json(), "ten minutes after the last arrival").toMatchObject({ skipped: "a sweep ran moments ago" });
    expect(claims()).toEqual([]);

    // The cron's case: arrived an hour ago, a slow sweep finished 47 minutes ago.
    row = meta(60, 47);
    expect(await (await post({ action: "host_sweep" })).json(), "the claim lost to another caller").toMatchObject({ skipped: "another caller took this sweep" });
    expect(claims()).toHaveLength(1);
    expect(eqs(claims()[0], "updated_at", row.data.updated_at), "the claim is conditional on the stamp it read").toBe(true);
    expect(fetched, "a lost claim probes nothing").toEqual([]);

    claim = { data: [{ k: "host_sweep" }], error: null };
    const won = await (await post({ action: "host_sweep" })).json();
    expect(won).toMatchObject({ swept: 1 });
    expect(fetched).toEqual(["https://b.example/"]);

    // Maintenance keeps only the 5-minute overlap guard.
    fetched.length = 0;
    row = meta(10, 8);
    claim = { data: [], error: null };
    expect(await (await post({ action: "host_sweep" }, { authorization: `Bearer ${SVC}` })).json()).toMatchObject({ skipped: "another caller took this sweep" });
    row = meta(3, 3);
    expect(await (await post({ action: "host_sweep" }, { authorization: `Bearer ${SVC}` })).json()).toMatchObject({ skipped: "a sweep ran moments ago" });
  });

  it("postedAfter reaches the database as the canonical instant, and 'GMT-12' does not reach it at all", async () => {
    const postedGt = () => db.on("job_board_postings", "gt").flatMap((q) => q.calls.filter(([m, a]) => m === "gt" && a[0] === "posted_at").map(([, a]) => a[1]));
    const bad = await (await post({ action: "list", postedAfter: "2026-10-04 12:00 GMT-12", groupSimilar: false })).json();
    expect(bad.ignoredFilters).toContain("postedAfter");
    expect(postedGt()).toEqual([]);
    expect(bad.filterIntegrity).toBeUndefined();
    db.queries = [];
    await post({ action: "list", postedAfter: "2026-10-04T12:00:00-12:00", groupSimilar: false });
    expect([...new Set(postedGt())]).toEqual(["2026-10-05T00:00:00.000Z"]);
  });

  it("company-suggest reads two keys of the refresh row, once a minute per isolate, not once a keystroke", async () => {
    const suggestReads = () => db.on("job_board_meta").filter((q) => eqs(q, "k", "refresh"));
    answers.push((q) => (q.table === "job_board_meta" && eqs(q, "k", "refresh") && q.mode === "maybe"
      ? { data: { companiesFacet: [{ token: GH.token, name: "Acme Robotics", count: 4 }], companiesOpen: { [GH.token]: 3 } }, error: null } : undefined));
    const first = await (await post({ action: "company-suggest", q: "acme" })).json();
    expect(first.companies).toEqual([{ token: GH.token, name: "Acme Robotics", open: 3 }]);
    expect(suggestReads().map((q) => argOf(q, "select"))).toEqual(["companiesFacet:v->companiesFacet, companiesOpen:v->companiesOpen"]);
    db.queries = [];
    for (const q of ["ac", "acm", "acme r", "acme ro"]) {
      const r = await (await post({ action: "company-suggest", q })).json();
      expect(r.companies.map((c: { name: string }) => c.name), q).toEqual(["Acme Robotics"]);
    }
    expect(suggestReads(), "four keystrokes, no further read of the row").toEqual([]);
  });
});

// ── the refresh's half of the lane, in the code that ships ──────────────────

describe("the refresh takes from the lane through takeDemand and stamps only what an admitted slice took, in its own row", () => {
  const RR = INDEX.slice(INDEX.indexOf("async function runRefresh("), INDEX.indexOf("const queue = [...slice];"));

  it("one cold board, catalogued, not hot, not already in the slice", () => {
    expect(RR).toMatch(/takeDemand\(demand\.queue, demand\.served, Date\.now\(\), \(t\) => CATALOGUE_TOKENS\.has\(t\) && !sliceTokens\.has\(t\) && !hotTokens\.has\(t\)\)/);
    expect(RR, "the old five-a-slice take is gone").not.toMatch(/\.slice\(0, 5\)/);
    expect(RR).not.toMatch(/20 \* 60_000 && !sliceTokens\.has/);
  });

  it("the served stamp is written after the slice is admitted, and the refresh never writes the queue row", () => {
    const admit = RR.indexOf("await admitSlice(client, next,");
    const write = RR.indexOf("await stampDemandServed(client, demandTaken, Date.now())");
    expect(admit).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(admit);
    expect(RR, "the queue is verify's row").not.toMatch(/k: DEMAND_QUEUE_KEY|k: "demand"/);
  });

  it("verify admits through admitDemand and writes the queue row only", () => {
    const verify = INDEX.slice(INDEX.indexOf('if (action === "verify")'), INDEX.indexOf('if (action === "audit")'));
    expect(verify).toMatch(/admitDemand\(demand\.queue, demand\.served, \[\.\.\.demandTokens\], Date\.now\(\)\)/);
    expect(verify).toMatch(/upsert\(\{ k: DEMAND_QUEUE_KEY, v: next,/);
    expect(verify).not.toMatch(/DEMAND_SERVED_KEY|stampDemandServed/);
    expect(verify).toMatch(/if \(applyBy\.has\(id\)\) demandTokens\.add\(src\.token\);/);
    expect(verify).not.toMatch(/\.slice\(-60\)/);
  });
});
