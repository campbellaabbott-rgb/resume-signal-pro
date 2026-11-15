// @vitest-environment node
/**
 * THE CHATGPT SEARCH TITLE CARRIES PLACE AND DATE (connect W3, BR-13, BR-14).
 *
 * ChatGPT's search shape is fixed at {id, title, url}. Live 2026-11-07,
 * search {query:'nurse jobs in Texas'} answered titles like "Nurse — Houston
 * ISD": no place and no date, so "which of these are in Dallas?" cost ten
 * fetches against the ChatGPT allowance. The title now carries the employer,
 * the first place and the employer's posting date, at most 120 characters, and
 * the keys stay exactly id, title and url.
 *
 * BR-13, copy only: the url, fetched by an AI with Claude-User or
 * ChatGPT-User, served the generic board page, not the posting (the posting
 * page is the frontend's to prerender). The description no longer calls it
 * the posting's page for a fetcher: it opens the posting on resumebooster.work
 * in a browser.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, CHATGPT_ADDRESS, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const YEAR = new Date().getUTCFullYear();
const ROWS = [
  { id: "greenhouse:stdavids:1", source: "greenhouse", title: "Registered Nurse", company: "St. David's", location: "Austin, TX; Round Rock, TX", postedAt: `${YEAR}-11-04T09:00:00Z` },
  { id: "greenhouse:seton:2", source: "greenhouse", title: "Registered Nurse", company: "Ascension Seton", location: "Austin, TX", postedAt: `${YEAR - 1}-12-30T09:00:00Z` },
  { id: "greenhouse:longco:3", source: "greenhouse", title: "Registered Nurse - Medical Surgical Intensive Care Unit - Night Shift - Sign-On Bonus Eligible - Full Time", company: "A Very Long Health System Name of Central Texas", location: "Austin Metropolitan Area, Texas, United States", postedAt: `${YEAR}-10-01T09:00:00Z` },
  { id: "greenhouse:nodate:4", source: "greenhouse", title: "Registered Nurse", company: "No Date Clinic" },
];

describe("a research listing names where and when", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => {
    mcp = await bootKeylessMcp();
    mcp.board = () => new Response(JSON.stringify({ jobs: ROWS, total: 4, hasMore: false }), { status: 200 });
  }, 120_000);

  it("each title is title — employer — first place — posted date, at most 120 characters, under exactly id, title, url", async () => {
    const out = JSON.parse((await mcp.call({ query: "registered nurse" }, { name: "search", address: CHATGPT_ADDRESS })).text);
    const results = out.results as Array<Record<string, string>>;
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(Object.keys(r).sort()).toEqual(["id", "title", "url"]);
      expect(r.title.length).toBeLessThanOrEqual(120);
    }
    expect(results[0].title).toBe("Registered Nurse — St. David's — Austin, TX — posted Nov 4");
    expect(results[1].title).toBe(`Registered Nurse — Ascension Seton — Austin, TX — posted Dec 30, ${YEAR - 1}`);
    expect(results[2].title).toMatch(/— A Very Long Health System Name of Central Texas — .+ — posted Oct 1$/);
    expect(results[2].title.length).toBeLessThanOrEqual(120);
    expect(results[3].title).toBe("Registered Nurse — No Date Clinic");
  });

  it("the search tool says its url opens on resumebooster.work in a browser", async () => {
    const list = await mcp.rpc("tools/list", {}, { "x-forwarded-for": CHATGPT_ADDRESS }) as { result: { tools: Array<{ name: string; description: string }> } };
    const search = list.result.tools.find((t) => t.name === "search")!;
    expect(search.description).toMatch(/url opens the posting on resumebooster\.work in a browser/);
    expect(search.description).toMatch(/the employer's posting date/);
  });
});
