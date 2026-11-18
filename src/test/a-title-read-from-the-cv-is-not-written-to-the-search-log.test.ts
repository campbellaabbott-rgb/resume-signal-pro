// @vitest-environment node
/**
 * A TITLE READ FROM THE CV IS NOT WRITTEN TO THE SEARCH LOG (GP-NOLOG-1).
 *
 * fit_resume reads an occupation out of the CV and searches the board for it.
 * The search went out with no noLog flag, so the board wrote that title into
 * its search-demand log, while the connector's privacy text says the CV is
 * never stored. Now a search whose title came from the CV asks the board not
 * to log it (job-board honours the flag beside the reader proof); a title the
 * caller typed as `query` is searched exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const CV = "Registered nurse with eight years on acute medical wards, IV therapy, patient assessment and discharge planning. ".repeat(3);
const KEY = { authorization: "Bearer rb_live_harness_key" };

let mcp: KeylessMcp;
beforeEach(async () => {
  mcp = await bootKeylessMcp();
  mcp.answers.api_key_check = { data: { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "builder", rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1 }, error: null };
  mcp.board = () => new Response(JSON.stringify({ jobs: [], total: 0, hasMore: false }), { status: 200 });
});
const searches = () => mcp.boardCalls.filter((b) => b.action !== "detail");

describe("fit_resume's search", () => {
  it("with no query, the title read from the CV is searched with noLog", async () => {
    await mcp.rpc("tools/call", { name: "fit_resume", arguments: { resumeText: CV } }, KEY);
    expect(searches()).toHaveLength(1);
    expect(searches()[0]).toMatchObject({ noLog: true });
    expect(JSON.stringify(searches()[0])).toMatch(/nurse/i);
  });

  it("with a typed query, the body is today's, with no noLog", async () => {
    await mcp.rpc("tools/call", { name: "fit_resume", arguments: { resumeText: CV, query: "ward manager" } }, KEY);
    expect(searches()).toHaveLength(1);
    expect(JSON.stringify(searches()[0])).toMatch(/"ward manager"/);
    expect(searches()[0]).not.toHaveProperty("noLog");
  });
});
