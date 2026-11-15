// @vitest-environment node
/**
 * A TITLE WORD BEFORE A STATE CODE IS NOT A TOWN (connect W1 recheck,
 * 2026-11-08).
 *
 * The trailing-place lift read any capitalised word before a state code as a
 * city: "Customer Service TX" searched q "Customer" in a place called
 * "Service, TX" and said the place "was kept as written". Live with
 * x-rb-budget: probe, q "Customer" + location "Service, TX" held 0 where
 * main's whole query held 26, and q "Nurse" + "ICU, CA" 0 where main's held
 * 61. The words before the code now count only when the board's own city
 * table knows them (or they are a metro shorthand it expands); anything else
 * goes to the board whole, as main sends it. After "in", a city with no comma
 * before its code is held to the same table ("Engineer in Training TX").
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readQuery } from "../../supabase/functions/agent-mcp/query-place";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

/** The recheck's twelve readings, each a search main kept whole. */
const ROLE_THEN_STATE = [
  "Customer Service TX",
  "Medical Billing TX",
  "Data Entry CA",
  "Nurse ICU CA",
  "Truck Driver CDL TX",
  "Software Engineer Python CA",
  "Pharmacist Retail FL",
  "LPN Nursing Home TX",
  "Python Django NY",
  "Therapist PT NJ",
  "Nurse Night Shift CA",
  "Customer Service, TX",
];

describe("the words before a state code are a city only when the board knows the city", () => {
  it.each(ROLE_THEN_STATE)("%s stays whole, as main sends it", (q) => {
    expect(readQuery(q)).toEqual({ query: q });
  });

  it.each(["Engineer in Training TX", "Nurse in ICU CA"])("%s after a preposition names no town either", (q) => {
    expect(readQuery(q)).toEqual({ query: q });
  });

  it.each([
    ["registered nurse jobs Austin TX", { query: "registered nurse", location: "Austin, TX" }],
    ["nurse jobs Pittsburgh PA", { query: "nurse", location: "Pittsburgh, PA" }],
    ["nurse in Austin TX", { query: "nurse", location: "Austin, TX" }],
    ["Medical Billing Houston TX", { query: "Medical Billing", location: "Houston, TX" }],
  ])("a city the board knows still moves: %s", (q, want) => {
    expect(readQuery(q)).toMatchObject(want);
  });

  it("only a known city is said to be kept as written", () => {
    expect(readQuery("Data Entry Houston TX").note).toBe('"Houston, TX" was kept as written: a city name can span states.');
    for (const q of ROLE_THEN_STATE) expect(readQuery(q).note).toBeUndefined();
  });

  it.each([
    ["software engineer Bay Area CA", "Bay Area"],
    ["data analyst jobs NYC NY", "NYC"],
  ])("a metro shorthand before a state code goes as the shorthand the board expands: %s", (q, location) => {
    const r = readQuery(q);
    expect(r.location).toBe(location);
    expect(r.note).toBeUndefined();
  });
});

describe("ChatGPT's search tool sends a role and a state code to the board as typed", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => { mcp = await bootKeylessMcp(); }, 120_000);

  it("search {query:'Customer Service TX'} searches no place called Service", async () => {
    mcp.boardCalls.length = 0;
    const out = JSON.parse((await mcp.call({ query: "Customer Service TX" }, { name: "search", ua: "openai-mcp/1.0.0" })).text);
    const list = mcp.boardCalls.find((b) => b.action === "list")!;
    expect(list.q).toBe("Customer Service TX");
    expect(list.location).toBeUndefined();
    expect(out.locationInterpreted).toBeUndefined();
  });
});
