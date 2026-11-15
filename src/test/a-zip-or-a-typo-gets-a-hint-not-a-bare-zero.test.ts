// @vitest-environment node
/**
 * A ZIP OR A TYPO GETS A HINT, NOT A BARE ZERO (connect W3, BR-10).
 *
 * Live 2026-11-07: search_jobs {query:"nurse", location:"78701"} and
 * {query:"pharmacist", location:"Pheonix"} each answered total 0 with no note,
 * while the site holds 77 nurse postings in Austin, TX and 25 pharmacist
 * postings in Phoenix. The board reads places by name only. An empty first
 * page for a ZIP now says so, and one for a misspelt place names the one place
 * a slip away (same first letter, exactly one candidate: over 1,347 real place
 * names in the corpus rows, wider rules suggested Cork for York). The location
 * argument's own description says it is not a ZIP.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { placeHint, placeInQuery } from "../../supabase/functions/agent-mcp/query-place";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

describe("the hint reader", () => {
  it.each(["78701", "78701-1234"])("%s is a ZIP code", (zip) => {
    expect(placeHint(zip)).toMatchObject({ zip: true, hint: expect.stringMatching(/not by ZIP or postal code/) });
  });

  it.each([["Pheonix", "Phoenix"], ["Huston", "Houston"], ["Chicgo", "Chicago"], ["Mancester", "Manchester"], ["Sanfrancisco", "San Francisco"]])(
    "%s is one slip from %s",
    (typed, place) => expect(placeHint(typed)).toMatchObject({ zip: false, didYouMean: place }),
  );

  it.each(["Austin, TX", "Texas", "London", "York", "Home", "Wilmington", "Bicester", "Nowhereville", "SW1A 1AA"])(
    "%s gets no hint: a place the board knows, or a real name no single place is one slip from",
    (typed) => expect(placeHint(typed)).toBeNull(),
  );

  it("the place a query names at its end", () => {
    expect(placeInQuery("nurse near 78701")).toBe("78701");
    expect(placeInQuery("nurse 78701")).toBe("78701");
    expect(placeInQuery("nurse in Pheonix")).toBe("Pheonix");
    expect(placeInQuery("nurse")).toBeNull();
  });
});

describe("the server says why a place found nothing", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => { mcp = await bootKeylessMcp(); }, 120_000);
  beforeEach(() => { mcp.board = () => new Response(JSON.stringify({ jobs: [], total: 0, hasMore: false }), { status: 200 }); });

  it("location '78701' with nothing found: locationHint says places go by name", async () => {
    const out = JSON.parse((await mcp.call({ query: "nurse", location: "78701" })).text);
    expect(out.locationUnrecognised).toBe(true);
    expect(out.locationHint).toMatch(/not by ZIP or postal code/);
  });

  it("'nurse in Pheonix' with nothing found: locationDidYouMean Phoenix", async () => {
    const out = JSON.parse((await mcp.call({ query: "nurse in Pheonix" })).text);
    expect(out.locationDidYouMean).toBe("Phoenix");
    expect(out.locationHint).toMatch(/Did you mean Phoenix\?/);
  });

  it("a ZIP that found rows, and a known place that found none, carry no hint", async () => {
    mcp.board = () => new Response(JSON.stringify({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", title: "Nurse" }], total: 1, hasMore: false }), { status: 200 });
    expect(JSON.parse((await mcp.call({ query: "nurse", location: "78701" })).text).locationHint).toBeUndefined();
    mcp.board = () => new Response(JSON.stringify({ jobs: [], total: 0, hasMore: false }), { status: 200 });
    expect(JSON.parse((await mcp.call({ query: "nurse", location: "Austin, TX" })).text).locationHint).toBeUndefined();
  });

  it("the location argument's description says it is not a ZIP", async () => {
    const list = await mcp.rpc("tools/list") as { result: { tools: Array<{ name: string; inputSchema: { properties: Record<string, { description?: string }> } }> } };
    const search = list.result.tools.find((t) => t.name === "search_jobs")!;
    expect(search.inputSchema.properties.location.description).toMatch(/Not a ZIP or postal code/);
  });
});
