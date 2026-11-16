// @vitest-environment node
/**
 * A COUNTRY OR REMOTE LOCATION IS SAID BACK, AND SEARCHED AS TYPED (RC-S9-002).
 *
 * search_jobs sends the location argument to the board as typed, which
 * matches it as words in each posting's location. For a whole country or a
 * remote word that finds a fraction of what the board's own field holds
 * (live 2026-11-14, q "registered nurse": location "United States" 4,441
 * against country US capped at 10,000; "remote" 66 against remote: true
 * 303), and nothing in the answer said the place had been read as words.
 *
 * Reading it as the filter instead was measured and declined (n1461: a filter
 * loses rows the words find, and the board has no OR of the two), so the
 * location still goes as typed. What changes is that the answer says so:
 * when the whole location is one country by name or a remote word, and no
 * country or remote filter was sent, locationNote names the filter that
 * searches the board's own field, and the prompts relay it and offer the
 * search again. A state, a city, "City, <country>" (already split) or a
 * country already sent carries none.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let mcp: KeylessMcp;
beforeEach(async () => { mcp = await bootKeylessMcp(); });

const search = async (args: Record<string, unknown>) => {
  const body = await mcp.rpc("tools/call", { name: "search_jobs", arguments: args });
  return ((body.result as { structuredContent?: Record<string, unknown> } | undefined)?.structuredContent ?? {}) as Record<string, unknown>;
};
const listBody = () => mcp.boardCalls.find((b) => b.action === "list") ?? mcp.boardCalls[0];

describe("a whole country or a remote word is sent as typed, and the answer names the filter", () => {
  it.each([
    ["United States", "registered nurse", 'country: "US"'],
    ["USA", "registered nurse", 'country: "US"'],
    ["Germany", "software engineer", 'country: "DE"'],
    ["remote", "registered nurse", "remote: true"],
    ["Remote US", "registered nurse", 'remote: true and country: "US"'],
  ])("location %s", async (location, query, filter) => {
    const sc = await search({ query, location });
    expect(listBody().location).toBe(location);
    expect(listBody().country).toBeUndefined();
    expect(listBody().remote).toBeUndefined();
    expect(String(sc.locationNote)).toContain(`location "${location}" was matched as words`);
    expect(String(sc.locationNote)).toContain(filter);
    expect(sc.locationInterpreted).toBeUndefined();
  });
});

describe("any other location carries no locationNote", () => {
  it.each([
    ["Austin, TX", "nurse"],
    ["Texas", "nurse"],
    ["Remote TX", "nurse"],
    ["Berlin", "engineer"],
    ["New York", "analyst"],
  ])("location %s", async (location, query) => {
    const sc = await search({ query, location });
    expect(listBody().location).toBe(location);
    expect(sc.locationNote).toBeUndefined();
  });

  it("'London, UK' still splits to London in GB, with no locationNote", async () => {
    const sc = await search({ query: "nurse", location: "London, UK" });
    expect(listBody()).toMatchObject({ location: "London", country: "GB" });
    expect(sc.locationNote).toBeUndefined();
  });

  it("a country already sent, or remote already true, is not offered again", async () => {
    expect((await search({ query: "nurse", location: "Germany", country: "DE" })).locationNote).toBeUndefined();
    expect((await search({ query: "nurse", location: "remote", remote: true })).locationNote).toBeUndefined();
  });
});

describe("the guide and the prompts relay it", () => {
  it("the guide says what locationNote means, and browse_jobs and find_roles_for_my_cv relay it and offer the search", async () => {
    const guide = JSON.stringify(await mcp.rpc("resources/read", { uri: "resumebooster://guide" }));
    expect(guide).toMatch(/locationNote/);
    for (const [name, args] of [["browse_jobs", { what: "nurse", where: "United States" }], ["find_roles_for_my_cv", { location: "remote" }]] as const) {
      const got = JSON.stringify(await mcp.rpc("prompts/get", { name, arguments: args }));
      expect(got, name).toMatch(/locationNote as the board says them, and offer the search locationNote names/);
    }
  });
});
