// @vitest-environment node
/**
 * A FIT QUERY READ FROM A RÉSUMÉ IS NOT LOGGED (GP-NOLOG-2).
 *
 * POST /v1/fit reads an occupation out of the résumé when the caller sends no
 * q, and searched the board with it like any typed query, so the board wrote
 * a term taken from someone's CV into its search log while Privacy says the
 * CV is never stored. The board honours noLog only from a caller that proves
 * it is a reader (x-rb-reader); public-api already sends that proof. A query
 * read from the résumé now goes with noLog: true, and a query the caller typed
 * keeps today's body.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb, type Fetched } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let handler: EdgeHandler;
let fetched: Fetched[];
beforeAll(async () => {
  ({ handler, fetched } = await loadPublicApi((f) => {
    if (f.url.endsWith("/functions/v1/job-board")) return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    return new Response("{}", { status: 404 });
  }));
}, 120_000);
beforeEach(() => {
  fetched.length = 0;
  const db = new RecordingDb();
  db.rpcs.api_key_check = () => ({ data: ALLOWED, error: null });
  db.rpcs.api_key_fit_allowance = () => ({ data: [{ fa_user_id: null, fa_confirmed: true, fa_proven: false, fa_used: 1 }], error: null });
  db.rpcs.api_key_fit_unscored = () => ({ data: true, error: null });
  useDb(db);
});

const RESUME = "Registered nurse with eight years of triage, emergency department care, patient education and charting experience. ".repeat(2);
const boardCall = () => fetched.find((f) => f.url.endsWith("/functions/v1/job-board"))!;

describe("POST /v1/fit's board search, as shipped", () => {
  it("a query read from the résumé is sent with noLog, under the reader proof the board requires", async () => {
    expect((await callApi(handler, "/v1/fit", { method: "POST", body: { resumeText: RESUME } })).status).toBe(200);
    const b = boardCall();
    expect((b.body as Record<string, unknown>).q).toBeTruthy();
    expect((b.body as Record<string, unknown>).noLog).toBe(true);
    expect(Object.keys(b.headers).map((k) => k.toLowerCase())).toContain("x-rb-reader");
  });

  it("a query the caller typed keeps today's body", async () => {
    await callApi(handler, "/v1/fit", { method: "POST", body: { resumeText: RESUME, q: "charge nurse" } });
    const body = boardCall().body as Record<string, unknown>;
    expect(body.q).toBe("charge nurse");
    expect("noLog" in body).toBe(false);
  });
});
