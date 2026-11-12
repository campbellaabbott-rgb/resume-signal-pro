// @vitest-environment node
/**
 * A CITY AND ITS COUNTRY IS SEARCHED AS THAT CITY (connect W1, BR-02).
 *
 * Live 2026-11-07: search_jobs {query:"software engineer", location:"London,
 * UK"} answered 27 where London in GB holds 271, because the board matched the
 * words "London, UK" inside each posting's place. And {query:"part-time jobs
 * near Manchester UK"} read only the country: 137 rows from Bristol, Woking and
 * Balham, none from Manchester. The city is now kept as the place and the
 * country goes to the country filter, in the query and in the location
 * argument, and the answer says so.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readLocationArg, readQuery } from "../../supabase/functions/agent-mcp/query-place";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

describe("the reader keeps the city and reads its country", () => {
  it.each([
    ["part-time jobs near Manchester UK", { query: "part-time", location: "Manchester", country: "GB" }],
    ["software engineer in London, UK", { query: "software engineer", location: "London", country: "GB" }],
    ["analyst in Paris, France", { query: "analyst", location: "Paris", country: "FR" }],
    ["engineer near Munich Germany", { query: "engineer", location: "Munich", country: "DE" }],
    ["developer in Toronto Canada", { query: "developer", location: "Toronto", country: "CA" }],
    ["nurse in Cardiff, Wales", { query: "nurse", location: "Cardiff", country: "GB" }],
  ])("%s", (q, want) => {
    expect(readQuery(q)).toMatchObject(want);
  });

  it("a region or a sector before a country is not a city, and a country alone is still the country", () => {
    expect(readQuery("nurse in southern Spain")).toMatchObject({ query: "nurse", country: "ES" });
    expect(readQuery("nurse in southern Spain").location).toBeUndefined();
    expect(readQuery("Head of Growth in Fintech UK")).toMatchObject({ query: "Head of Growth", country: "GB" });
    expect(readQuery("Head of Growth in Fintech UK").location).toBeUndefined();
    expect(readQuery("nurse in New South Wales")).toEqual({ query: "nurse in New South Wales" });
    expect(readQuery("engineer in Germany")).toMatchObject({ query: "engineer", country: "DE" });
  });

  it("a country the caller already set keeps the city and never overwrites the country", () => {
    const r = readQuery("nurse near Manchester UK", { country: true });
    expect(r).toMatchObject({ query: "nurse", location: "Manchester" });
    expect(r.country).toBeUndefined();
  });

  it("a location argument 'City, <country>' is the city and the country; every other place stays as typed", () => {
    expect(readLocationArg("London, UK")).toMatchObject({ location: "London", country: "GB" });
    expect(readLocationArg("Toronto, ON, Canada")).toMatchObject({ location: "Toronto, ON", country: "CA" });
    expect(readLocationArg("London, GB")).toMatchObject({ location: "London", country: "GB" });
    for (const typed of ["Austin, TX", "Toronto, CA", "United States", "remote", "Remote, US", "Texas", "Dubai"]) {
      expect(readLocationArg(typed), typed).toBeNull();
    }
    // A country the caller sent that disagrees leaves the argument as typed.
    expect(readLocationArg("London, UK", { country: "US" })).toBeNull();
    expect(readLocationArg("London, UK", { country: "GB" })).toMatchObject({ location: "London" });
  });
});

describe("the server sends the board the city and the country, and says so", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => { mcp = await bootKeylessMcp(); }, 120_000);
  beforeEach(() => { mcp.boardCalls.length = 0; });
  const list = () => mcp.boardCalls.find((b) => b.action === "list")!;

  it("location 'London, UK' is searched as London in GB, with locationInterpreted naming what was sent", async () => {
    const out = JSON.parse((await mcp.call({ query: "software engineer", location: "London, UK" })).text);
    expect(list()).toMatchObject({ q: "software engineer", location: "London", country: "GB" });
    expect(out.locationInterpreted).toMatchObject({ location: "London", country: "GB", locationSent: "London, UK" });
    expect(out.locationInterpreted.note).toMatch(/London in GB/);
  });

  it("'part-time jobs near Manchester UK' searches Manchester in GB, never all of the UK", async () => {
    const out = JSON.parse((await mcp.call({ query: "part-time jobs near Manchester UK" })).text);
    expect(list()).toMatchObject({ q: "part-time", location: "Manchester", country: "GB" });
    expect(out.locationInterpreted).toMatchObject({ location: "Manchester", country: "GB", from: "near Manchester UK" });
  });
});
