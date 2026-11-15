// @vitest-environment node
/**
 * A TRAILING PLACE WITHOUT "IN" IS A PLACE (connect W1, CJ-06).
 *
 * Live 2026-11-07, as ChatGPT's search tool sends it (a query string and
 * nothing else): "registered nurse jobs Austin TX" answered total 0 and ten
 * rows from Houston and elsewhere, while query "registered nurse" with
 * location "Austin, TX" held 51. Only "in", "near" and "around" were read.
 *
 * Now "City ST", "City, ST", a state by name and a metro alias at the end move
 * to the location filter, under the guards a job title needs: a credential
 * that is also a state code ("Physician Assistant PA"), a place after "of"
 * ("University of Texas"), a title's own place after a dash, and a bare place
 * name with no search filler before it ("Teller Washington").
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readQuery } from "../../supabase/functions/agent-mcp/query-place";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

describe("a place at the end with no preposition moves to the filter", () => {
  it.each([
    ["registered nurse jobs Austin TX", { query: "registered nurse", location: "Austin, TX" }],
    ["registered nurse Austin, TX", { query: "registered nurse", location: "Austin, TX" }],
    ["software engineer San Francisco CA", { query: "software engineer", location: "San Francisco, CA" }],
    ["nurse Salt Lake City UT", { query: "nurse", location: "Salt Lake City, UT" }],
    ["nurse jobs Kansas City MO", { query: "nurse", location: "Kansas City, MO" }],
    ["nurse jobs Pittsburgh PA", { query: "nurse", location: "Pittsburgh, PA" }],
    ["nurse jobs Texas", { query: "nurse", location: "Texas" }],
    ["data analyst jobs NYC", { query: "data analyst", location: "NYC" }],
  ])("%s", (q, want) => {
    expect(readQuery(q)).toMatchObject(want);
  });

  it.each([
    "Physician Assistant PA",
    "Orthopedic PA",
    "Hospitalist MD",
    "Radiologic Technologist CT",
    "Registered Nurse, TX",
    "Research Associate University of Texas",
    "Security Agent - Houston, TX",
    "Teller Washington",
    "Texas Roadhouse server",
    "Boston Scientific sales rep",
    "Washington Post reporter",
    "Phoenix developer",
    "nurse in OR",
    "Director of IN programs",
  ])("%s stays whole", (q) => {
    expect(readQuery(q)).toEqual({ query: q });
  });
});

describe("ChatGPT's search tool searches Austin RNs in Austin", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => { mcp = await bootKeylessMcp(); }, 120_000);

  it("search {query:'registered nurse jobs Austin TX'} reaches the board as registered nurse in Austin, TX", async () => {
    await mcp.call({ query: "registered nurse jobs Austin TX" }, { name: "search", ua: "openai-mcp/1.0.0" });
    expect(mcp.boardCalls.find((b) => b.action === "list")).toMatchObject({ q: "registered nurse", location: "Austin, TX" });
  });
});
