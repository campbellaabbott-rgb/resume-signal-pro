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
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

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
        const inRange = ROWS.filter((r) => r.created_at >= st.gte && r.created_at <= st.lte);
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

afterEach(() => { vi.restoreAllMocks(); queries = 0; });

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
