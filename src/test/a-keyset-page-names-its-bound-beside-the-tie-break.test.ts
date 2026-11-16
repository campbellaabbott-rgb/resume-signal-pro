// @vitest-environment node
/**
 * A KEYSET PAGE NAMES ITS BOUND BESIDE THE TIE-BREAK (S14X-037, the public-api
 * half; M-S14-038).
 *
 * Every /v1 keyset sent only the OR seek, `col < ep OR (col = ep AND id > x)`.
 * The rows are right, but the planner cannot turn an OR into an index range,
 * so a page 27 days deep filtered its way down from the top of the index. The
 * redundant leading bound (`col <= ep` on a descending walk, `col >= ep` on an
 * ascending one) beside the OR gives it an Index Cond. Same rows, same order;
 * the count query stays unbounded so total.value is the same on every page.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ALLOWED, RecordingDb, callApi, cursorOf, loadPublicApi, useDb, type Op } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let handler: EdgeHandler;
let db: RecordingDb;

beforeAll(async () => {
  ({ handler } = await loadPublicApi(() => new Response("{}", { status: 404 })));
}, 120_000);

beforeEach(() => {
  db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: ALLOWED, error: null });
  useDb(db);
});

const has = (ops: Op[], m: string) => ops.some(([x]) => x === m);
const args = (ops: Op[], m: string, col: string) => ops.filter(([x, a]) => x === m && a[0] === col).map(([, a]) => a[1]);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe("each keyset carries its leading bound", () => {
  it("/v1/jobs: the row query is bounded at the cursor's date, the count query is not", async () => {
    const ep = hoursAgo(27 * 24);
    const r = await callApi(handler, `/v1/jobs?cursor=${cursorOf({ ep, id: "greenhouse:acme:9" })}`);
    expect(r.status).toBe(200);
    const postings = db.queriesOf("job_board_postings");
    const rowQ = postings.find((ops) => has(ops, "or"));
    const countQ = postings.find((ops) => ops.some(([m, a]) => m === "select" && (a[1] as { head?: boolean } | undefined)?.head));
    expect(rowQ, "the keyset row query").toBeTruthy();
    expect(args(rowQ!, "lte", "effective_posted")).toEqual([ep]);
    expect(countQ, "the count query").toBeTruthy();
    expect(args(countQ!, "lte", "effective_posted"), "the count must not move with the cursor").toEqual([]);
  });

  it("/v1/jobs without a cursor adds no bound", async () => {
    await callApi(handler, "/v1/jobs");
    for (const ops of db.queriesOf("job_board_postings")) expect(args(ops, "lte", "effective_posted")).toEqual([]);
  });

  it("/v1/changes: each list is bounded below at its own cursor, beside the since bound", async () => {
    const since = hoursAgo(48);
    const openedEp = hoursAgo(30);
    const closedEp = hoursAgo(20);
    const r = await callApi(handler, `/v1/changes?since=${encodeURIComponent(since)}`
      + `&opened_cursor=${cursorOf({ ep: openedEp, id: "greenhouse:acme:7" })}`
      + `&closed_cursor=${cursorOf({ ep: closedEp, id: "4242" })}`);
    expect(r.status).toBe(200);
    const [openedQ] = db.queriesOf("job_board_postings");
    const [closedQ] = db.queriesOf("job_board_closures");
    expect(args(openedQ, "gte", "first_seen")).toEqual([new Date(Date.parse(since)).toISOString(), openedEp]);
    expect(args(closedQ, "gte", "closed_at")).toContain(closedEp);
    expect(has(openedQ, "or") && has(closedQ, "or"), "the tie-break is still sent").toBe(true);
  });
});
