// @vitest-environment node
/**
 * TODAY IS A CALENDAR DAY, A PAY PAGE IS FULL, AND A MALFORMED OR ABUSIVE
 * REQUEST IS THE CALLER'S (S12-020, S12-035, S12-122, S12-123, S12-124;
 * job-board .93, wave 4 round 2).
 *
 * S12-020. "Today" was a rolling 24 hours over stamps that are mostly a date
 * with no time (00:00Z), so a US visitor at 8pm EDT lost the postings dated
 * that same day: countOnly 2,879 -> 1,200 across midnight UTC.
 * S12-035. "Highest pay" read exactly `limit` rows and then folded clusters,
 * so the page was a quarter to half empty ("cashier" 44 of 60).
 * S12-122. An anonymous caller could ask for offset 400,000: 5.7 s of database.
 * S12-123. A body of null or a number answered 500, and so did a long id to
 * `exists`.
 * S12-124. location ["Austin","Dallas"] became "Austin,Dallas" and matched
 * nothing, silently; a NUL leaked to Postgres as 22P05.
 *
 * The pure rules are imported; every route is driven through the shipped
 * handler (helpers/board-handler.ts bundles the real index.ts).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ageCutoffMs, textFieldShape, viewerTzOffset } from "../../supabase/functions/job-board/filters";
import { locationTerms } from "../../supabase/functions/_shared/location-terms";
import { ANON, bootBoardHandler, type BoardHandler } from "./helpers/board-handler";
import { row } from "./helpers/board-list";
import type { Query } from "./helpers/proxy-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const H = 3_600_000;
const DAY = 24 * H;

describe("the age window is the viewer's calendar day (S12-020)", () => {
  it("at 8pm EDT, Today still holds the postings dated that day", () => {
    const now = Date.parse("2026-10-13T00:00:00Z"); // 8pm EDT on the 12th
    const cutoff = ageCutoffMs(1, now, 240);
    expect(new Date(cutoff).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(Date.parse("2026-10-12T00:00:00Z") >= cutoff, "a row dated the 12th is today's").toBe(true);
    // At 11:59pm EDT the rolling day has moved four hours on; the calendar day has not.
    expect(new Date(ageCutoffMs(1, now + 3 * H + 59 * 60_000, 240)).toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });

  it("is never narrower than the rolling window and at most a day wider; N days reach back N-1 calendar days", () => {
    for (let h = 0; h < 48; h++) {
      const now = Date.parse("2026-10-12T00:00:00Z") + h * H;
      for (const tz of [-840, -330, 0, 240, 480, 720]) {
        const c = ageCutoffMs(1, now, tz);
        expect(c).toBeLessThanOrEqual(now - DAY);
        expect(now - c).toBeLessThanOrEqual(2 * DAY);
      }
    }
    expect(new Date(ageCutoffMs(7, Date.parse("2026-10-13T00:00:00Z"), 240)).toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });

  it("no offset reads the latest date line, so nobody's today is cut; a malformed one is the same", () => {
    expect(viewerTzOffset(undefined)).toBe(720);
    expect(viewerTzOffset("abc")).toBe(720);
    expect(viewerTzOffset(9999)).toBe(720);
    expect(viewerTzOffset(-60)).toBe(-60);
    expect(viewerTzOffset("240")).toBe(240);
  });
});

describe("the text filters are text (S12-124)", () => {
  it("a list where a string belongs, nothing left after sanitising, and NULs", () => {
    expect(textFieldShape({ location: ["Austin", "Dallas"], q: "nurse" }, locationTerms)).toEqual({ body: { q: "nurse" }, ignored: ["location"] });
    expect(textFieldShape({ q: "%%", location: "%_|" }, locationTerms)).toEqual({ body: {}, ignored: ["q", "location"] });
    expect(textFieldShape({ q: "nur\u0000se", department: "le\u0000gal" }, locationTerms).body).toEqual({ q: "nurse", department: "legal" });
    expect(textFieldShape({ q: "c++", location: "Austin, TX" }, locationTerms), "positive control").toEqual({ body: { q: "c++", location: "Austin, TX" }, ignored: [] });
  });
});

describe("through the shipped handler", () => {
  let h: BoardHandler;
  beforeAll(async () => { h = await bootBoardHandler(); });
  beforeEach(() => h.reset());
  const anon = { authorization: `Bearer ${ANON}`, apikey: ANON };
  const postingReads = () => h.db.queries.filter((q: Query) => q.table === "job_board_postings");

  it("Today binds the calendar cutoff on the page read and the RPCs alike, never the rolling day", async () => {
    h.answer((q) => (q.rpc === "search_jobs" ? { data: [{ ...row("greenhouse:acme:1", "Registered Nurse"), total_rows: 1 }], error: null } : undefined));
    const before = Date.now();
    await h.post({ action: "list", maxAgeDays: 1, tzOffset: 240, limit: 60 });
    await h.post({ action: "list", q: "registered nurse", maxAgeDays: 1, tzOffset: 240, limit: 60 });
    const after = Date.now();
    const gte = postingReads().flatMap((q) => q.calls.filter(([m, a]) => m === "gte" && a[0] === "posted_at").map(([, a]) => Date.parse(String(a[1]))));
    expect(gte.length, "the browse read binds the window").toBeGreaterThan(0);
    // The cutoff the handler computed at its own instant, somewhere between the two.
    const ok = (c: number) => c >= ageCutoffMs(1, before, 240) && c <= ageCutoffMs(1, after, 240);
    for (const c of gte) expect(ok(c), new Date(c).toISOString()).toBe(true);
    const rpc = h.db.rpcArgs("search_jobs")[0];
    expect(rpc.p_max_age_days, "the rolling day is never sent").toBeNull();
    expect(ok(Date.parse(String(rpc.p_posted_after)) + 1), String(rpc.p_posted_after)).toBe(true);
  });

  it("the pay order over-fetches before it folds, so a page of clusters is still full", async () => {
    const rows = Array.from({ length: 180 }, (_, i) => row(`greenhouse:acme:${i}`, `Cashier ${Math.floor(i / 2)}`, {
      company: "Acme", location: `Town ${i}`, salary_min_annual: 50_000 - i, salary_rank_usd: 50_000 - i,
    }));
    h.answer((q) => (q.table === "job_board_postings" && q.calls.some(([m, a]) => m === "order" && a[0] === "salary_rank_usd")
      ? { data: rows.slice(0, (q.calls.find(([m]) => m === "range")?.[1][1] as number) + 1), error: null }
      : undefined));
    const r = await h.post({ action: "list", q: "cashier", sort: "salary", limit: 60 });
    const pay = postingReads().find((q) => q.calls.some(([m, a]) => m === "order" && a[0] === "salary_rank_usd"))!;
    expect(pay.calls.find(([m]) => m === "range")?.[1]).toEqual([0, 179]);
    expect((r.jobs as unknown[]).length, "60 cards, each folding two postings").toBe(60);
    expect(r.nextOffset).toBe(120);
    expect(r.hasMore).toBe(true);
  });

  it("an anonymous offset past 10,000 is refused before any read; our servers are not capped", async () => {
    const r = await h.post({ action: "list", country: "US", offset: 400_000, limit: 60 }, anon);
    expect(r).toMatchObject({ error: "offset_too_deep", maxOffset: 10_000 });
    expect(postingReads().length).toBe(0);
    h.reset();
    const ok = await h.post({ action: "list", country: "US", offset: 9_960, limit: 60 }, anon);
    expect(ok.error).toBeUndefined();
    const reader = await h.post({ action: "list", country: "US", offset: 400_000, limit: 60 }, await h.readerHeaders());
    expect(reader.error).toBeUndefined();
  });

  it("a body that is not an object is a 400, and an over-long id is simply not open", async () => {
    for (const body of [null, 42, [1, 2], "list"]) {
      const res = await fetchRaw(h, JSON.stringify(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    h.answer((q) => (q.table === "job_board_postings" && q.calls.some(([m]) => m === "in") ? { data: [{ id: "greenhouse:acme:1" }], error: null } : undefined));
    const long = "x".repeat(100_000);
    const r = await h.post({ action: "exists", ids: ["greenhouse:acme:1", long] });
    expect(r.open).toEqual({ "greenhouse:acme:1": true, [long]: false });
    const read = postingReads()[0];
    expect((read.calls.find(([m]) => m === "in")?.[1][1] as string[])).toEqual(["greenhouse:acme:1"]);
  });

  it("a location list and a stripped-empty q are named in ignoredFilters, and no NUL reaches the database", async () => {
    const r = await h.post({ action: "list", location: ["Austin", "Dallas"], limit: 60 });
    expect(r.ignoredFilters).toContain("location");
    expect(postingReads().some((q) => q.calls.some(([, a]) => JSON.stringify(a).includes("Austin,Dallas"))), "the coerced list never became a filter").toBe(false);
    h.reset();
    h.answer((q) => (q.rpc === "search_jobs" ? { data: [{ ...row("greenhouse:acme:1", "Nurse"), total_rows: 1 }], error: null } : undefined));
    await h.post({ action: "list", q: "nurse\u0000", limit: 60 });
    expect(JSON.stringify(h.db.queries.map((q) => q.calls)).includes("\\u0000")).toBe(false);
  });
});

async function fetchRaw(h: BoardHandler, raw: string): Promise<{ status: number }> {
  // post() serialises an object; these bodies are the raw JSON a caller sent.
  const g = globalThis as Record<string, unknown>;
  const handler = g.__edgeHandler as (r: Request) => Promise<Response>;
  void h;
  const res = await handler(new Request("https://h.supabase.co/functions/v1/job-board", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer svc-key-for-tests" }, body: raw,
  }));
  return { status: res.status };
}
