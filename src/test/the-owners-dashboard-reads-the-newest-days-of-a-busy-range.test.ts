// @vitest-environment node
/**
 * THE OWNER'S DASHBOARD READS THE NEWEST DAYS OF A BUSY RANGE (S13-070).
 *
 * WHAT WAS WRONG. get-analytics read ab_test_events oldest first and stopped
 * at 50,000 rows. The site logs about 130,000 events a month, so on a 30-day
 * range the read ended part-way through the month: the newest days were never
 * read, the daily trend fell to nothing at the end, and the funnels and A/B
 * counts described only the start of the range.
 *
 * WHAT HOLDS NOW: the shipped handler is run against a range of 60,000
 * events over 30 days. Every event is counted and the newest day is in the
 * trend. When the run's time budget ends the read early, the newest days are
 * the ones that were read, and the answer says from when (coveredFrom).
 *
 * S14X-189. The time milestones were sorted by their digits, so 30s (30) came
 * after 10m (10): the Time on Page funnel read 0s, 1m, 2m, 5m, 10m, 30s and
 * its drop-offs were measured between the wrong steps. They are ordered by
 * their value with units now (30s = 30, 1m = 60), from the import-free
 * rollup, which the page uses too.
 *
 * S14X-190. Days were the UTC date of each event while the page asked for
 * local-midnight bounds, so "Today" could draw two days and an American
 * evening visit counted as coming back on another day. The page sends its
 * time zone; days are that zone's calendar days, and a missing or unknown
 * zone keeps UTC.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { createRollup, orderMilestones } from "../../supabase/functions/get-analytics/rollup";

type Ev = {
  id: string; test_name: string; variant: string; event_type: string;
  created_at: string; visitor_id: string; metadata: { page: string }; page: string;
};

const DAYS = 30;
const PER_DAY = 2_000;
const FIRST_DAY = Date.UTC(2026, 9, 1);
const dayOf = (d: number) => new Date(FIRST_DAY + d * 86_400_000).toISOString().slice(0, 10);
const NEWEST_DAY = dayOf(DAYS - 1);

/** 60,000 events: each day has 2,000, spread over its hours, 400 visitors a day. */
const ROWS: Ev[] = (() => {
  const out: Ev[] = [];
  let n = 0;
  for (let d = 0; d < DAYS; d++) {
    for (let i = 0; i < PER_DAY; i++) {
      const at = new Date(FIRST_DAY + d * 86_400_000 + Math.floor((i / PER_DAY) * 86_000_000)).toISOString();
      const scroll = i % 4 === 0;
      out.push({
        id: String(n++).padStart(8, "0"),
        test_name: scroll ? "scroll_depth" : "product_conversion",
        variant: scroll ? "home:50%" : "free_scan",
        event_type: i % 10 === 0 ? "conversion" : "view",
        created_at: at,
        visitor_id: `v-${d}-${i % 400}`,
        metadata: { page: "home" },
        page: "home",
      });
    }
  }
  return out;
})();

/** A fake ab_test_events read that honours the order, range, keyset and limit it is given. */
let queries = 0;
/** The rows the fake table holds: the busy month, or a case's own few. */
let TABLE: Ev[] = ROWS;
const fakeDb = {
  from(table: string) {
    if (table !== "ab_test_events") throw new Error(`unexpected table ${table}`);
    const st = { gte: "", lte: "", asc: true, limit: 1000, after: null as null | { op: "gt" | "lt"; at: string; id: string } };
    const q = {
      select: () => q,
      gte: (_c: string, v: string) => { st.gte = v; return q; },
      lte: (_c: string, v: string) => { st.lte = v; return q; },
      order: (c: string, o: { ascending: boolean }) => { if (c === "created_at") st.asc = o.ascending; return q; },
      limit: (n: number) => { st.limit = n; return q; },
      or: (f: string) => {
        const m = /^created_at\.(gt|lt)\."?([^",]+)"?,and\(created_at\.eq\."?([^",]+)"?,id\.(gt|lt)\.([^)]+)\)$/.exec(f);
        if (!m) throw new Error(`unparsed keyset ${f}`);
        st.after = { op: m[1] as "gt" | "lt", at: m[2], id: m[5] };
        return q;
      },
      then: (resolve: (r: { data: Ev[]; error: null }) => unknown) => {
        queries++;
        const inRange = TABLE.filter((r) => r.created_at >= st.gte && r.created_at <= st.lte);
        const sorted = st.asc ? inRange : [...inRange].reverse();
        const a = st.after;
        const rest = a
          ? sorted.filter((r) => a.op === "gt"
            ? r.created_at > a.at || (r.created_at === a.at && r.id > a.id)
            : r.created_at < a.at || (r.created_at === a.at && r.id < a.id))
          : sorted;
        return resolve({ data: rest.slice(0, st.limit), error: null });
      },
    };
    return q;
  },
};

const ADMIN = "admin-key-harness-0123456789";
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => ({ SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", ADMIN_API_KEY: ADMIN } as Record<string, string>)[k] } };
  g.__analyticsDb = fakeDb;
  handler = await loadEdgeHandler("get-analytics", {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__analyticsDb; }",
  });
}, 120_000);

afterEach(() => { vi.restoreAllMocks(); queries = 0; TABLE = ROWS; });

const ask = async () => {
  const res = await handler(new Request("https://h.supabase.co/functions/v1/get-analytics", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": ADMIN },
    body: JSON.stringify({ startDate: `${dayOf(0)}T00:00:00.000Z`, endDate: `${NEWEST_DAY}T23:59:59.999Z`, pageFilter: "all" }),
  }));
  expect(res.status).toBe(200);
  return (await res.json()) as {
    audience: { totalEvents: number; truncated: boolean; coveredFrom?: string | null; daily: Array<{ day: string; events: number }> };
    conversions: Array<{ variant: string; views: number; conversions: number }>;
  };
};

describe("a 30-day range holding 60,000 events", () => {
  it("counts every event and its trend reaches the newest day", async () => {
    const body = await ask();
    expect(body.audience.totalEvents).toBe(DAYS * PER_DAY);
    expect(body.audience.truncated).toBe(false);
    expect(body.audience.daily).toHaveLength(DAYS);
    expect(body.audience.daily.at(-1)).toEqual(expect.objectContaining({ day: NEWEST_DAY, events: PER_DAY }));
    const free = body.conversions.find((c) => c.variant === "free_scan");
    expect((free?.views ?? 0) + (free?.conversions ?? 0)).toBe(DAYS * PER_DAY * 0.75);
  }, 60_000);

  it("a read that runs out of time keeps the newest days and names where it stopped", async () => {
    // Each page of 1,000 takes "30 seconds": the budget runs out after a few pages.
    const start = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => start + queries * 30_000);
    const body = await ask();
    expect(body.audience.truncated).toBe(true);
    expect(body.audience.totalEvents).toBeGreaterThan(0);
    expect(body.audience.totalEvents).toBeLessThan(DAYS * PER_DAY);
    expect(body.audience.daily.at(-1)?.day).toBe(NEWEST_DAY);
    expect(body.audience.daily.at(-1)?.events).toBe(PER_DAY);
    // Four pages of 1,000 were read: the newest two days, back to the start of the second.
    expect(String(body.audience.coveredFrom ?? "").slice(0, 10)).toBe(dayOf(DAYS - 2));
  }, 60_000);
});

const ev = (n: number, at: string, test_name: string, variant: string, visitor = `v${n}`): Ev => ({
  id: String(n).padStart(8, "0"), test_name, variant, event_type: "view", created_at: at, visitor_id: visitor, metadata: { page: "home" }, page: "home",
});

const askWith = async (body: Record<string, unknown>) => {
  const res = await handler(new Request("https://h.supabase.co/functions/v1/get-analytics", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": ADMIN },
    body: JSON.stringify(body),
  }));
  expect(res.status).toBe(200);
  return (await res.json()) as {
    timeOnPage: Array<{ variant: string }>;
    scrollDepth: Array<{ variant: string }>;
    pageMetrics: Record<string, { timeOnPage: Array<{ variant: string }> }>;
    audience: { daily: Array<{ day: string }>; returningVisitors: number; dayZone?: string };
  };
};

describe("the time milestones (S14X-189)", () => {
  it("are ordered by their value with units, not by their digits", () => {
    const rows = ["10m", "30s", "1m", "0s", "5m", "2m"].map((variant) => ({ variant }));
    expect(orderMilestones(rows).map((r) => r.variant)).toEqual(["0s", "30s", "1m", "2m", "5m", "10m"]);
    expect(orderMilestones(["100%", "25%", "90%", "50%"].map((variant) => ({ variant }))).map((r) => r.variant)).toEqual(["25%", "50%", "90%", "100%"]);
  });

  it("come back from the handler as the page draws its funnel: 30s second, 10m last", async () => {
    TABLE = ["10m", "30s", "1m", "0s", "5m", "2m"].map((m, i) => ev(i, `2026-10-05T10:0${i}:00.000Z`, "time_on_page", `home:${m}`));
    const body = await askWith({ startDate: "2026-10-05T00:00:00.000Z", endDate: "2026-10-05T23:59:59.999Z", pageFilter: "all" });
    expect(body.timeOnPage.map((m) => m.variant)).toEqual(["0s", "30s", "1m", "2m", "5m", "10m"]);
    expect(body.pageMetrics.home.timeOnPage.map((m) => m.variant)).toEqual(["0s", "30s", "1m", "2m", "5m", "10m"]);
  });
});

describe("the owner's days (S14X-190)", () => {
  // A Los Angeles evening: 12:00 and 19:00 local on 2026-11-09, which are two UTC dates.
  const EVENING = ["2026-11-09T20:00:00.000Z", "2026-11-10T03:00:00.000Z"];

  it("an evening's visit in Los Angeles is one day there, and nobody came back", () => {
    const r = createRollup("all", "America/Los_Angeles");
    for (const at of EVENING) r.add({ test_name: "product_conversion", variant: "a", event_type: "view", created_at: at, visitor_id: "v1" });
    const a = r.audience(false, null);
    expect(a.daily.map((d) => d.day)).toEqual(["2026-11-09"]);
    expect(a.returningVisitors).toBe(0);
    expect(a.dayZone).toBe("America/Los_Angeles");
  });

  it("with no zone, or one that is not a zone, days stay UTC dates", () => {
    for (const zone of [undefined, null, "", "Mars/Olympus_Mons"]) {
      const r = createRollup("all", zone as string | null | undefined);
      for (const at of EVENING) r.add({ test_name: "product_conversion", variant: "a", event_type: "view", created_at: at, visitor_id: "v1" });
      const a = r.audience(false, null);
      expect(a.daily.map((d) => d.day), String(zone)).toEqual(["2026-11-09", "2026-11-10"]);
      expect(a.returningVisitors).toBe(1);
      expect(a.dayZone).toBe("UTC");
    }
  });

  it("a half-hour zone is honoured to the minute", () => {
    // 18:29Z is 23:59 in Kolkata (+05:30), 18:31Z is 00:01 the next day.
    const r = createRollup("all", "Asia/Kolkata");
    r.add({ test_name: "x", variant: "a", event_type: "view", created_at: "2026-11-09T18:29:00Z", visitor_id: "v1" });
    r.add({ test_name: "x", variant: "a", event_type: "view", created_at: "2026-11-09T18:31:00Z", visitor_id: "v2" });
    expect(r.audience(false, null).daily.map((d) => d.day)).toEqual(["2026-11-09", "2026-11-10"]);
  });

  it("the handler buckets by the zone the page sends", async () => {
    TABLE = EVENING.map((at, i) => ev(i, at, "product_conversion", "free_scan", "same-visitor"));
    const body = await askWith({ startDate: "2026-11-09T08:00:00.000Z", endDate: "2026-11-10T07:59:59.999Z", pageFilter: "all", timeZone: "America/Los_Angeles" });
    expect(body.audience.daily.map((d) => d.day)).toEqual(["2026-11-09"]);
    expect(body.audience.returningVisitors).toBe(0);
    expect(body.audience.dayZone).toBe("America/Los_Angeles");
  });

  it("days in a 30-day range of 60,000 events cost little more in a zone than in UTC", () => {
    const time = (zone: string | null) => {
      const r = createRollup("all", zone);
      const t0 = performance.now();
      for (const e of ROWS) r.add(e);
      return performance.now() - t0;
    };
    time("America/Los_Angeles");
    const utc = time(null);
    const zoned = time("America/Los_Angeles");
    // The zone's formatter runs once per distinct minute, not once per event.
    expect(zoned).toBeLessThan(Math.max(utc * 20, 2_000));
  });
});
