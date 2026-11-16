// @vitest-environment node
/**
 * A CHANGE FEED HANDS BACK ONLY WHAT HAS SETTLED (S14X-065, C-S14-033).
 *
 * The board stamps closed_at once per board visit and commits that visit's
 * takedowns in chunks, seconds to minutes later; a visit that started later
 * can stamp later and commit first. /v1/changes paged closed[] by
 * (closed_at, event_id) with no upper bound, so a reader in that gap moved its
 * cursor past a stamp whose rows were still to commit, and no later page ever
 * returned them. The feed now reads only up to a settled horizon, publishes
 * it, and hands back a resume cursor on every page, so a consumer resumes by
 * cursor instead of by moving `since`.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOSED_SETTLE_MS, OPENED_SETTLE_MS, resumeCursorOf, settledThrough,
} from "../../supabase/functions/public-api/changes-window";
import { ALLOWED, RecordingDb, callApi, cursorOf, decodeCursorForTest, loadPublicApi, useDb, type Op } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

// ── the race, modelled on the module the handler uses ──────────────────────

type Closure = { event_id: number; closed_at: number; committedAt: number };

/** One read of the feed at `now`: committed rows after the cursor, oldest first. */
function read(log: Closure[], now: number, after: { ep: string; id: string } | null, horizon: boolean) {
  const bound = horizon ? Date.parse(settledThrough(now, CLOSED_SETTLE_MS)) : Infinity;
  const rows = log
    .filter((c) => c.committedAt <= now && c.closed_at <= bound)
    .filter((c) => !after || c.closed_at > Date.parse(after.ep) || (c.closed_at === Date.parse(after.ep) && c.event_id > Number(after.id)))
    .sort((a, b) => a.closed_at - b.closed_at || a.event_id - b.event_id);
  const next = resumeCursorOf(rows, (c) => ({ ep: new Date(c.closed_at).toISOString(), id: String(c.event_id) }), after);
  return { ids: rows.map((r) => r.event_id), next };
}

describe("two board visits that commit out of order", () => {
  const T0 = Date.parse("2026-11-15T03:00:00Z");
  // Visit A stamps T0 and commits at T0+90s; visit B stamps T0+30s and commits
  // at T0+40s, so B's identity is the lower one.
  const log: Closure[] = [
    { event_id: 2, closed_at: T0, committedAt: T0 + 90_000 },
    { event_id: 1, closed_at: T0 + 30_000, committedAt: T0 + 40_000 },
  ];

  it("without a horizon the early read passes A's stamp, and A is never delivered", () => {
    const first = read(log, T0 + 60_000, null, false);
    expect(first.ids).toEqual([1]);
    const second = read(log, T0 + 16 * 60_000, first.next, false);
    expect([...first.ids, ...second.ids]).not.toContain(2);
  });

  it("with the horizon both rows are delivered, each exactly once", () => {
    const first = read(log, T0 + 60_000, null, true);
    expect(first.ids, "nothing has settled a minute in").toEqual([]);
    const second = read(log, T0 + 16 * 60_000, first.next, true);
    const third = read(log, T0 + 40 * 60_000, second.next, true);
    expect([...first.ids, ...second.ids, ...third.ids].sort()).toEqual([1, 2]);
  });

  it("the horizon outlasts the board's slice budget several times over", () => {
    expect(CLOSED_SETTLE_MS).toBeGreaterThanOrEqual(7 * 120_000);
    expect(CLOSED_SETTLE_MS).toBeGreaterThan(400_000);
    expect(OPENED_SETTLE_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("a page with rows resumes after its last row; an empty page keeps the cursor it was given", () => {
    const key = (c: { at: string; id: number }) => ({ ep: c.at, id: String(c.id) });
    expect(resumeCursorOf([{ at: "a", id: 1 }, { at: "b", id: 2 }], key, null)).toEqual({ ep: "b", id: "2" });
    expect(resumeCursorOf([], key, { ep: "x", id: "9" })).toEqual({ ep: "x", id: "9" });
    expect(resumeCursorOf([], key, null)).toBeNull();
  });
});

// ── the shipped handler ─────────────────────────────────────────────────────

let handler: EdgeHandler;
let db: RecordingDb;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

beforeAll(async () => {
  ({ handler } = await loadPublicApi(() => new Response("{}", { status: 404 })));
}, 120_000);

beforeEach(() => {
  db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: ALLOWED, error: null });
  const closure = (event_id: number, closed_at: string) => ({
    event_id, posting_id: `greenhouse:acme:${event_id}`, source: "greenhouse", company_token: "acme", company: "Acme",
    title: `Role ${event_id}`, category: "engineering", first_seen: minutesAgo(9000), posted_at: minutesAgo(9000),
    closed_at, superseded: false, absence_basis: "full_read", suspect: false, batch_live_before: 40,
  });
  db.tables.job_board_closures = [closure(11, minutesAgo(120)), closure(12, minutesAgo(60)), closure(13, minutesAgo(3))];
  useDb(db);
});

const bound = (ops: Op[], method: string, col: string) => ops.filter(([m, a]) => m === method && a[0] === col).map(([, a]) => String(a[1]));

describe("GET /v1/changes, as shipped", () => {
  it("bounds closed[] and opened[] by their settled horizons, and publishes both", async () => {
    const before = Date.now();
    const r = await callApi(handler, `/v1/changes?since=${encodeURIComponent(minutesAgo(360))}&limit=100`);
    expect(r.status).toBe(200);
    const [closedQ] = db.queriesOf("job_board_closures");
    const [openedQ] = db.queriesOf("job_board_postings");
    const closedTo = bound(closedQ, "lte", "closed_at");
    const openedTo = bound(openedQ, "lte", "first_seen");
    expect(closedTo, "closed[] has an upper bound").toHaveLength(1);
    expect(openedTo, "opened[] has an upper bound").toHaveLength(1);
    expect(Date.parse(closedTo[0])).toBeLessThanOrEqual(before - CLOSED_SETTLE_MS + 1000);
    expect(Date.parse(closedTo[0])).toBeGreaterThan(before - CLOSED_SETTLE_MS - 60_000);
    expect(Date.parse(openedTo[0])).toBeLessThanOrEqual(before - OPENED_SETTLE_MS + 1000);
    const page = r.body.page as Record<string, Record<string, unknown>>;
    expect(page.closed.settledThrough).toBe(closedTo[0]);
    expect(page.opened.settledThrough).toBe(openedTo[0]);
    // The row stamped three minutes ago has not settled and is not served.
    expect((r.body.closed as Array<{ event_id: number }>).map((c) => c.event_id)).toEqual([11, 12]);
  });

  it("a drained page still hands back where to resume, and the note says to resume by cursor", async () => {
    const r = await callApi(handler, `/v1/changes?since=${encodeURIComponent(minutesAgo(360))}&limit=100`);
    const page = r.body.page as Record<string, Record<string, unknown>>;
    expect(page.closed.hasMore).toBe(false);
    expect(page.closed.nextCursor).toBeNull();
    const resume = decodeCursorForTest(String(page.closed.resumeCursor));
    const last = (r.body.closed as Array<{ event_id: number; closed_at: string }>).at(-1)!;
    expect(resume).toEqual({ ep: last.closed_at, id: String(last.event_id) });
    expect(page.opened.resumeCursor, "an empty first page has nothing to resume after").toBeNull();
    expect(String(r.body.note)).toMatch(/resumeCursor/);
    expect(String(r.body.note)).toMatch(/never by moving since/i);
  });

  it("an empty page hands back the cursor it was given", async () => {
    const given = cursorOf({ ep: minutesAgo(30), id: "12" });
    const r = await callApi(handler, `/v1/changes?since=${encodeURIComponent(minutesAgo(360))}&closed_cursor=${given}`);
    expect(r.status).toBe(200);
    expect((r.body.page as Record<string, Record<string, unknown>>).closed.resumeCursor).toBe(given);
  });
});
