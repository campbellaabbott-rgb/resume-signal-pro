// @vitest-environment node
/**
 * A SEARCH OF ONLY SPONSORSHIP WORDS SEARCHES NOTHING AND ASKS FOR A ROLE
 * (connect W1 recheck, 2026-11-08).
 *
 * The visa-sponsorship words leave the query, because the board cannot filter
 * on sponsorship (BR-01). When nothing else was typed ("visa sponsorship",
 * "H1B", "companies that sponsor H1B visas", "Tier 2 sponsorship jobs"), the
 * query left was empty or "jobs", search_jobs sent the board no words, and
 * the board answered its whole catalogue beside the sponsorship note: the
 * person's search widened to every job. Now nothing is searched, the answer
 * says why and asks for a role or a place, and a search that still names a
 * place, an employer or a field runs as before.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readQuery, sponsorshipOnly } from "../../supabase/functions/agent-mcp/query-place";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ONLY_SPONSORSHIP = ["visa sponsorship", "H1B", "companies that sponsor H1B visas", "Tier 2 sponsorship jobs", "jobs with visa sponsorship", "visa sponsorship remote"];

describe("the reader says when sponsorship words were all there was", () => {
  it.each(ONLY_SPONSORSHIP)("%s leaves no role", (q) => {
    expect(sponsorshipOnly(readQuery(q))).toBe(true);
  });

  it.each(["visa sponsorship software engineer", "H1B nurse jobs", "Sponsorship Manager", "visa", "software engineer"])("%s still names something to search", (q) => {
    expect(sponsorshipOnly(readQuery(q))).toBe(false);
  });
});

describe("search_jobs never widens a sponsorship-only search to the whole board", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => {
    mcp = await bootKeylessMcp();
    mcp.board = (body) => new Response(JSON.stringify({
      jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", title: "Anything", company: "Acme" }],
      total: body.q || body.location || body.companies ? 12 : 880_000, hasMore: true, nextOffset: 10,
    }), { status: 200 });
  }, 120_000);

  it.each(ONLY_SPONSORSHIP)("%s asks the board nothing and asks the person for a role", async (q) => {
    mcp.boardCalls.length = 0;
    const out = JSON.parse((await mcp.call({ query: q })).text);
    expect(mcp.boardCalls.filter((b) => b.action === "list")).toEqual([]);
    expect(out.jobs).toEqual([]);
    expect(out.notSearched).toBe(true);
    expect(out.notSearchedNote).toMatch(/nothing was searched rather than every job/);
    expect(out.notSearchedNote).toMatch(/what role they want, and where/);
    expect(out.sponsorshipNote).toMatch(/cannot filter by visa sponsorship/);
    expect(out.total).toBeUndefined();
  });

  it("ChatGPT's search tool gets the same answer, with no results", async () => {
    mcp.boardCalls.length = 0;
    const out = JSON.parse((await mcp.call({ query: "H1B" }, { name: "search", ua: "openai-mcp/1.0.0" })).text);
    expect(mcp.boardCalls.filter((b) => b.action === "list")).toEqual([]);
    expect(out.results).toEqual([]);
    expect(out.notSearched).toBe(true);
  });

  it.each([
    [{ query: "visa sponsorship jobs in London" }, { location: "London" }],
    [{ query: "visa sponsorship", location: "Austin, TX" }, { location: "Austin, TX" }],
    [{ query: "H1B", category: "engineering" }, { category: "engineering" }],
  ])("%j still searches the part of the board it names", async (args, sent) => {
    mcp.boardCalls.length = 0;
    const out = JSON.parse((await mcp.call(args)).text);
    expect(mcp.boardCalls.find((b) => b.action === "list")).toMatchObject(sent);
    expect(out.notSearched).toBeUndefined();
    expect(out.sponsorshipNote).toMatch(/cannot filter by visa sponsorship/);
  });

  it("a sponsorship search with a role is searched for the role, as before", async () => {
    mcp.boardCalls.length = 0;
    const out = JSON.parse((await mcp.call({ query: "visa sponsorship software engineer" })).text);
    expect(mcp.boardCalls.find((b) => b.action === "list")!.q).toBe("software engineer");
    expect(out.notSearched).toBeUndefined();
  });
});
