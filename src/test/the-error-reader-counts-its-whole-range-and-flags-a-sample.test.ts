// @vitest-environment node
/**
 * THE ERROR READER COUNTS ITS WHOLE RANGE AND FLAGS A SAMPLE (S14X-157).
 *
 * WHAT WAS WRONG. get-error-telemetry answered the newest 1,000 rows of the
 * range and nothing else: no count, no flag. /errors then printed
 * errors.length as the range's "Total Errors", so a week holding 2,500 errors
 * read as 1,000, and the 5xx and last-hour cards counted only that sample.
 *
 * WHAT HOLDS NOW: the shipped handler is run against a fake table of 2,500
 * rows in range. It still answers the newest 1,000 rows, and beside them exact
 * counts over the whole range (total, last hour, the hour before, 5xx) and
 * truncated: true. A range that fits answers truncated: false. A count the
 * database refuses leaves counts null and the rows still answer, so the page
 * falls back to the sample rather than failing.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

type Row = { id: string; created_at: string; http_status: number | null; error_type: string; error_code: string };

const NOW = Date.now();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

/** 2,500 rows over the last 7 days: 40 in the last hour, 25 in the hour before, every tenth a 5xx. */
const ROWS: Row[] = (() => {
  const out: Row[] = [];
  const at = (i: number) => (i < 40 ? 1 + i : i < 65 ? 61 + (i - 40) : 125 + ((i - 65) * 9_900) / 2_435);
  for (let i = 0; i < 2_500; i++) {
    out.push({ id: `e${String(i).padStart(5, "0")}`, created_at: minutesAgo(at(i)), http_status: i % 10 === 0 ? 502 : 400, error_type: "api", error_code: "X" });
  }
  return out;
})();

/** An error_telemetry read that honours select(count, head), gte, lt, order and limit. */
let refuseCounts = false;
const reads: string[] = [];
const fakeDb = {
  from(table: string) {
    if (table !== "error_telemetry") throw new Error(`unexpected table ${table}`);
    const st = { head: false, count: false, preds: [] as Array<(r: Row) => boolean>, limit: Infinity, desc: false };
    const q = {
      select: (_c: string, opts?: { count?: string; head?: boolean }) => { st.count = opts?.count === "exact"; st.head = opts?.head === true; return q; },
      gte: (c: keyof Row, v: string | number) => { st.preds.push((r) => r[c] != null && (typeof v === "number" ? Number(r[c]) >= v : String(r[c]) >= v)); return q; },
      lt: (c: keyof Row, v: string) => { st.preds.push((r) => r[c] != null && String(r[c]) < v); return q; },
      order: (_c: string, o: { ascending: boolean }) => { st.desc = !o.ascending; return q; },
      limit: (n: number) => { st.limit = n; return q; },
      then: (resolve: (r: unknown) => unknown) => {
        const hit = ROWS.filter((r) => st.preds.every((p) => p(r)));
        reads.push(st.head ? "count" : "rows");
        if (st.head) return resolve(refuseCounts ? { data: null, count: null, error: { message: "statement timeout" } } : { data: null, count: hit.length, error: null });
        const sorted = [...hit].sort((a, b) => (st.desc ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at)));
        return resolve({ data: sorted.slice(0, st.limit), count: st.count ? hit.length : null, error: null });
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
  g.__errorDb = fakeDb;
  handler = await loadEdgeHandler("get-error-telemetry", {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__errorDb; }",
  });
}, 120_000);

type Answer = {
  data: Row[];
  counts?: { total: number; lastHour: number; previousHour: number; serverErrors: number } | null;
  truncated?: boolean;
};

const ask = async (sinceIso: string): Promise<Answer> => {
  const res = await handler(new Request("https://h.supabase.co/functions/v1/get-error-telemetry", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": ADMIN },
    body: JSON.stringify({ sinceIso, limit: 1000 }),
  }));
  expect(res.status).toBe(200);
  return (await res.json()) as Answer;
};

describe("a 7-day range holding 2,500 errors", () => {
  it("answers the newest 1,000 rows, the range's exact counts, and truncated", async () => {
    refuseCounts = false;
    const body = await ask(minutesAgo(7 * 24 * 60));
    expect(body.data).toHaveLength(1_000);
    expect(body.data[0].id).toBe("e00000");
    expect(body.counts, "no counts: the page can only print the sample's length as the range's total").toEqual({
      total: 2_500, lastHour: 40, previousHour: 25, serverErrors: 250,
    });
    expect(body.truncated).toBe(true);
  });

  it("a range that fits is not truncated, and its counts equal its rows", async () => {
    refuseCounts = false;
    const body = await ask(minutesAgo(120));
    expect(body.data).toHaveLength(65);
    expect(body.counts?.total).toBe(65);
    expect(body.truncated).toBe(false);
  });

  it("a count the database refuses leaves counts null and the rows still answer", async () => {
    refuseCounts = true;
    try {
      const body = await ask(minutesAgo(7 * 24 * 60));
      expect(body.data).toHaveLength(1_000);
      expect(body.counts).toBeNull();
      expect(body.truncated, "a full sample with no count may hold more: it says so").toBe(true);
    } finally { refuseCounts = false; }
  });
});
