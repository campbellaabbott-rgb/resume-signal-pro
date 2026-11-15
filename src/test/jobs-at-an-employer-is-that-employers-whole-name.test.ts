// @vitest-environment node
/**
 * "JOBS AT <EMPLOYER>" IS THAT EMPLOYER'S WHOLE NAME (connect W1, BR-09).
 *
 * Live 2026-11-07: search_jobs {query:"jobs at Humana"} took the board's
 * EMPLOYER route and answered 260, one career site's open roles, while
 * {companies:"Humana"} resolved the name to both of Humana's boards (Humana and
 * CenterWell) and answered 1,198. A name after a search word ("jobs at",
 * "roles at", "openings at", "careers at") now goes to the employer filter,
 * which the board resolves under its one name rule. When the board carries no
 * employer by that name, the query is searched again as typed inside the same
 * counted call, and the board's own words about the name ride along.
 *
 * A bare "<role> at <Name>" stays as typed: the board's own titles hold
 * "Server at The Chase Club" (Reitmr) and "Janitor at Grandview Las Vegas"
 * (Mastercorp), where the name is a place of work in the title, not the
 * employer.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readQuery } from "../../supabase/functions/agent-mcp/query-place";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

describe("the reader names the employer after a search word", () => {
  it.each([
    ["jobs at Humana", { query: "", companies: ["Humana"] }],
    ["roles at Stripe", { query: "", companies: ["Stripe"] }],
    ["openings at Mayo Clinic", { query: "", companies: ["Mayo Clinic"] }],
    ["nurse jobs at Kaiser Permanente in California", { query: "nurse", companies: ["Kaiser Permanente"], location: "California" }],
  ])("%s", (q, want) => {
    expect(readQuery(q)).toMatchObject(want);
  });

  it.each(["Data Scientist at Meta", "Member at Large", "Engineer at scale", "work at home customer service", "positions at the University of Texas"])(
    "%s stays whole",
    (q) => expect(readQuery(q)).toEqual({ query: q }),
  );

  it("a caller that already sent companies keeps its own", () => {
    expect(readQuery("jobs at Humana", { companies: true })).toEqual({ query: "jobs at Humana" });
  });
});

describe("the server searches the employer, and searches as typed when the board carries no such employer", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => { mcp = await bootKeylessMcp(); }, 120_000);
  beforeEach(() => { mcp.boardCalls.length = 0; mcp.rpcs.length = 0; });
  const lists = () => mcp.boardCalls.filter((b) => b.action === "list");

  it("'jobs at Humana' reaches the board as the employer Humana, with no title words", async () => {
    mcp.board = () => new Response(JSON.stringify({
      jobs: [{ id: "workday:humana~wd5~Humana_External_Career_Site:R-1", source: "workday", title: "Care Manager", company: "Humana" }],
      total: 1, hasMore: false, companiesResolved: [{ name: "Humana", tokens: ["humana~wd5~Humana_External_Career_Site"] }],
    }), { status: 200 });
    const out = JSON.parse((await mcp.call({ query: "jobs at Humana" })).text);
    expect(lists()).toHaveLength(1);
    expect(lists()[0].companies).toEqual(["Humana"]);
    expect(lists()[0].q ?? "").toBe("");
    expect(out.locationInterpreted).toMatchObject({ companies: ["Humana"], from: "at Humana" });
    expect(out.employerNote).toBeUndefined();
  });

  it("an employer the board does not carry is searched again as typed, counted once, and said", async () => {
    mcp.board = (body) => new Response(JSON.stringify(
      Array.isArray(body.companies) && body.companies.length
        ? { jobs: [], total: 0, hasMore: false, unknownCompanies: ["Acme Widgets"] }
        : { jobs: [{ id: "greenhouse:other:1", source: "greenhouse", title: "Acme Widgets Specialist", company: "Other" }], total: 1, hasMore: false },
    ), { status: 200 });
    const out = JSON.parse((await mcp.call({ query: "jobs at Acme Widgets" })).text);
    expect(lists()).toHaveLength(2);
    expect(lists()[0].companies).toEqual(["Acme Widgets"]);
    expect(lists()[1].companies ?? []).toEqual([]);
    expect(lists()[1].q).toBe("jobs at Acme Widgets");
    expect(mcp.rpcs.filter((r) => r.name === "mcp_anon_check_v2")).toHaveLength(1);
    expect(out.employerNote).toMatch(/"Acme Widgets" matched no single employer this board carries/);
    expect(out.unknownCompanies).toEqual(["Acme Widgets"]);
    expect(out.jobs).toHaveLength(1);
  });
});
