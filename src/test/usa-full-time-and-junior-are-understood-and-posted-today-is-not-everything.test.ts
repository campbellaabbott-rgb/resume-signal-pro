// @vitest-environment node
/**
 * full-time, junior AND on-site REACH THE BOARD AS full_time, entry AND
 * onsite, A VALUE OUTSIDE THE SET IS REFUSED WITH THE SET, AND POSTED TODAY IS
 * NOT EVERY POSTING (lane fix/1121-connector-errors, item 11).
 *
 * These are what a model types. The board dropped each and answered a wider
 * question with only ignoredFilters to say so; maxAgeDays 0 bound nothing and
 * named nothing: every posting. /v1 already refused the same values.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let m: KeylessMcp;
beforeEach(async () => {
  m = await bootKeylessMcp();
  m.board = () => new Response(JSON.stringify({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", title: "Nurse" }], total: 1, hasMore: false }), { status: 200 });
}, 120_000);
const call = async (args: Record<string, unknown>) => {
  const r = await m.call(args);
  return { ...r, body: r.isError ? {} : JSON.parse(r.text) as Record<string, unknown> };
};
const metered = () => m.rpcs.filter((x) => x.name === "mcp_anon_check_v2").length;

describe("the values a model types reach the board as the board's own", () => {
  it("full-time, junior, On-Site and USA are full_time, entry, onsite and US, and said", async () => {
    const r = await call({ query: "nurse", employmentType: "full-time", experience: "junior", workMode: "On-Site", country: "USA" });
    expect(r.isError).toBe(false);
    expect(m.boardCalls[0]).toMatchObject({ employmentType: "full_time", experience: "entry", workMode: "onsite", country: "US" });
    expect(r.body.valuesRead).toMatchObject({ "full-time": "full_time", junior: "entry", "On-Site": "onsite" });
    expect(r.body.countryRead).toEqual({ USA: "US" });
  });
  it.each([[""], [null]])("employmentType %j is no filter, never refused", async (v) => {
    const r = await call({ query: "nurse", employmentType: v });
    expect(r.isError).toBe(false);
    expect(m.boardCalls[0]).not.toHaveProperty("employmentType");
  });
  it("a value outside the set is refused with the set, before anything is counted", async () => {
    const r = await call({ query: "nurse", employmentType: "sometimes" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/full_time, part_time, contract, temporary, internship/);
    expect(metered()).toBe(0);
  });
  it("a category named in words, four categories and a made-up vendor are refused", async () => {
    expect((await call({ query: "nurse", category: "Software Engineering" })).isError).toBe(true);
    const four = await call({ query: "nurse", category: "engineering,data,design,sales" });
    expect(four.isError).toBe(true);
    expect((await call({ query: "nurse", vendor: "made_up" })).isError).toBe(true);
    expect(metered()).toBe(0);
  });
  it("maxAgeDays 0 is refused naming postedAfter; null is no filter; 1 is sent", async () => {
    const zero = await call({ query: "nurse", maxAgeDays: 0 });
    expect(zero.isError).toBe(true);
    expect(zero.text).toMatch(/postedAfter/);
    expect((await call({ query: "nurse", maxAgeDays: null })).isError).toBe(false);
    expect(m.boardCalls[0]).not.toHaveProperty("maxAgeDays");
    await call({ query: "nurse", maxAgeDays: 1 });
    expect(m.boardCalls[1]).toMatchObject({ maxAgeDays: 1 });
  });
  it("a board answer that could not apply a sent filter is no rows with notSearched", async () => {
    m.board = () => new Response(JSON.stringify({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", title: "Nurse" }], total: 900, hasMore: true, ignoredFilters: ["workMode"] }), { status: 200 });
    const r = await call({ query: "nurse", workMode: "remote" });
    expect(r.body.jobs).toEqual([]);
    expect(r.body.notSearched).toBe(true);
  });
});
