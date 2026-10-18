/**
 * THE CONNECTOR KEEPS A PLACE AFTER "NOT" OUT OF THE LOCATION FILTER (S12-172
 * parity; job-board's handoff to agents-api, applied at integration).
 *
 * job-board stopped lifting a place typed after not, except, excluding, but,
 * outside, without, minus or other than into the location filter. agent-mcp
 * has its own trailing-place lift (query-place.ts), which still read "nurse
 * jobs not in Texas" as nurse jobs IN Texas: the person's AI searched the one
 * state the person had ruled out. Both now refuse the same words, and a test
 * holds the two lists equal.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readQuery } from "../../supabase/functions/agent-mcp/query-place";

describe("a place after a negation is the place not wanted", () => {
  it.each([
    "nurse jobs not in Texas",
    "nurse jobs except in Texas",
    "accountant roles outside in California",
    "warehouse work anywhere but in Ohio",
    "engineer not near Austin, TX",
    "teacher jobs other than in Canada",
  ])("%s keeps the place out of location and country", (q) => {
    const r = readQuery(q);
    expect(r.location).toBeUndefined();
    expect(r.country).toBeUndefined();
    expect(r.query).toBe(q);
  });

  it("control: the same place without a negation is still lifted", () => {
    expect(readQuery("nurse jobs in Texas")).toMatchObject({ query: "nurse", location: "Texas" });
    expect(readQuery("engineer near Austin, TX")).toMatchObject({ query: "engineer", location: "Austin, TX" });
    expect(readQuery("teacher jobs in Canada")).toMatchObject({ query: "teacher", country: "CA" });
  });

  it("the connector and the board refuse the same words", () => {
    const words = (f: string) => {
      const m = /const NEGATION_BEFORE_PLACE = (\/.+\/i);/.exec(readFileSync(resolve(__dirname, "../../supabase/functions", f), "utf8"));
      if (!m) throw new Error(`${f} has no NEGATION_BEFORE_PLACE`);
      return m[1];
    };
    expect(words("agent-mcp/query-place.ts")).toBe(words("job-board/query-place.ts"));
  });
});
