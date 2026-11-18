// @vitest-environment node
/**
 * A CLOSED ID UNDER A CARRIED PREFIX IS NOT FOUND, AND GIVEN BACK (S14X-016).
 *
 * The board answers two different 404s for a detail read: "Unknown job id"
 * for an id whose vendor and employer it does not carry, and "Posting not
 * found (it may have closed)" for an id under an employer it does carry. Only
 * the first was read as not found; the second was rethrown, so get_job,
 * get_jobs, fetch and apply_myself answered "hit an internal error. Try again
 * shortly" (a retry that cannot work) and a keyless caller kept the charge for
 * an id the board does not hold. The board's status now rides with its
 * message, and a 404 is not found whatever its words.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const GHOST = "greenhouse:airbnb:999999999999";
let mcp: KeylessMcp;
beforeEach(async () => {
  mcp = await bootKeylessMcp();
  mcp.board = (body) =>
    body.action === "detail"
      ? new Response(JSON.stringify({ error: "Posting not found (it may have closed)" }), { status: 404 })
      : new Response(JSON.stringify({ jobs: [], total: 0 }), { status: 200 });
});
const refunds = () => mcp.rpcs.filter((r) => r.name === "mcp_anon_refund").length;

describe("an id the board holds no posting for, under an employer it carries", () => {
  it("get_job answers notFound, not an internal error, and gives the keyless call back", async () => {
    const out = await mcp.call({ id: GHOST }, { name: "get_job" });
    expect(out.isError).toBe(false);
    expect(out.text).not.toMatch(/internal error/i);
    expect(JSON.parse(out.text)).toMatchObject({ id: GHOST, job: null, notFound: true });
    expect(refunds()).toBe(1);
  });

  it("apply_myself answers state notFound and gives the call back", async () => {
    const out = await mcp.call({ id: GHOST }, { name: "apply_myself" });
    expect(out.text).not.toMatch(/internal error/i);
    expect(JSON.parse(out.text)).toMatchObject({ jobId: GHOST, state: "notFound" });
    expect(refunds()).toBe(1);
  });

  it("fetch says so in its metadata", async () => {
    const out = await mcp.call({ id: GHOST }, { name: "fetch" });
    expect(out.text).not.toMatch(/internal error/i);
    expect(JSON.parse(out.text).metadata).toMatchObject({ notFound: true });
  });

  it("get_jobs lists the id as notFound beside the others", async () => {
    const out = await mcp.call({ ids: [GHOST] }, { name: "get_jobs" });
    expect(out.text).not.toMatch(/internal error/i);
    expect(out.text).toContain(GHOST);
    expect(out.text).toMatch(/"reason":"notFound"/);
  });

  it("a 404 with no words at all is still not found", async () => {
    mcp.board = () => new Response("{}", { status: 404 });
    const out = await mcp.call({ id: GHOST }, { name: "get_job" });
    expect(JSON.parse(out.text)).toMatchObject({ notFound: true });
  });

  it("a board failure that is not a 404 is still an error, and is not given back", async () => {
    mcp.board = () => new Response(JSON.stringify({ error: "statement timeout" }), { status: 500 });
    const out = await mcp.call({ id: GHOST }, { name: "get_job" });
    expect(out.isError).toBe(true);
    expect(refunds()).toBe(0);
  });
});
