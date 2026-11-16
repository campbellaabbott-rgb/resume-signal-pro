// @vitest-environment node
/**
 * A CURSOR CARRIES A KEY AND NEVER A FILTER (NB-30).
 *
 * /v1/changes spliced a cursor's ep and id into a PostgREST or() unquoted,
 * and decodeCursor rejected only a quote or a backslash. A hand-built cursor
 * whose id held a comma and a parenthesis therefore added its own branch to
 * the logic tree. A time cursor's ep must now be an ISO timestamp, a closure
 * cursor's id an event number, and a posting cursor's id free of the
 * characters PostgREST reads as structure; anything else is 400 bad_cursor
 * before a query is built.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ALLOWED, RecordingDb, callApi, cursorOf, loadPublicApi, useDb } from "./helpers/public-api-harness";
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

const since = encodeURIComponent(new Date(Date.now() - 48 * 3_600_000).toISOString());
const at = new Date(Date.now() - 20 * 3_600_000).toISOString();
const refused = async (path: string) => {
  const r = await callApi(handler, path);
  expect(r.status, path).toBe(400);
  expect((r.body.error as { code: string }).code).toBe("bad_cursor");
  expect(db.calls.some((c) => c.ops.some(([m]) => m === "or")), "no query carried the cursor").toBe(false);
};

describe("a cursor that is not a key is refused", () => {
  it("a closure cursor whose id holds a comma", async () => {
    await refused(`/v1/changes?since=${since}&closed_cursor=${cursorOf({ ep: at, id: "1),or(event_id.gt.0" })}`);
  });

  it("a closure cursor whose ep is not a timestamp", async () => {
    await refused(`/v1/changes?since=${since}&closed_cursor=${cursorOf({ ep: `${at},event_id.gt.0`, id: "5" })}`);
    await refused(`/v1/changes?since=${since}&closed_cursor=${cursorOf({ ep: "yesterday", id: "5" })}`);
  });

  it("a posting cursor whose id holds structure", async () => {
    await refused(`/v1/changes?since=${since}&opened_cursor=${cursorOf({ ep: at, id: "x,and(id.gt.0)" })}`);
  });

  it("a /v1/jobs cursor whose ep is not a timestamp", async () => {
    await refused(`/v1/jobs?cursor=${cursorOf({ ep: "2026-13-45", id: "greenhouse:acme:1" })}`);
  });
});

describe("a cursor the API issued is accepted", () => {
  it("database timestamps in either offset spelling, posting ids with colons and dots, numeric event ids", async () => {
    for (const ep of [at, "2026-11-15T03:13:48.631+00:00", "2026-11-15T03:13:48+00:00", "2026-11-15 03:13:48.631234+00"]) {
      const r = await callApi(handler, `/v1/changes?since=${since}`
        + `&opened_cursor=${cursorOf({ ep, id: "workday:acme.wd5:External:R-123_4" })}&closed_cursor=${cursorOf({ ep, id: "987654321" })}`);
      expect(r.status, ep).toBe(200);
    }
    expect((await callApi(handler, `/v1/jobs?cursor=${cursorOf({ ep: at, id: "greenhouse:acme:1" })}`)).status).toBe(200);
  });
});
