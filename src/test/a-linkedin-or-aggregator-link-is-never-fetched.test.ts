// @vitest-environment node
/**
 * A LINKEDIN OR AGGREGATOR LINK IS NEVER FETCHED (MCP upgrade 3, W1 lane L3:
 * U3-04(d)(e) as revised by L3).
 *
 * WHAT WAS WRONG. Live 2026-11-16 (probe c28), apply_myself given a LinkedIn
 * job link answered only "That is not a job id from this board." with a fix
 * that named resumebooster.work links: nothing the person's AI could do next
 * with the link the person had. An Indeed or Glassdoor link got the same.
 *
 * WHAT IS NOW TRUE. parseJobLink (agent-mcp/job-link.ts, pure) answers:
 *   - a LinkedIn /jobs/view/<title>-at-<company>-<id> link with a ready
 *     search read from the link's own words, {query: title, companies:
 *     [company]}, and wording that says it is a search for this title at
 *     this employer and not this posting, that LinkedIn posts are often
 *     agencies or reposts, and to check employer and title before applying
 *     (L3);
 *   - a LinkedIn link that carries no title (a bare number, a share link)
 *     by asking the person for the title and employer;
 *   - an Indeed, Glassdoor or other aggregator link with "we don't read that
 *     site", asking the person for the title and employer.
 * None of these is ever fetched: the reader is shown making no request, and
 * the shipped agent-mcp handler, given such links on every job tool, is shown
 * reaching no host but its own board.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseJobLink } from "../../supabase/functions/agent-mcp/job-link";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const LINKEDIN_SLUG = "https://www.linkedin.com/jobs/view/senior-data-engineer-at-acme-analytics-4012345678/?trk=public_jobs";
const LINKEDIN_BARE = "https://www.linkedin.com/jobs/view/4012345678";
const AGGREGATORS = [
  "https://www.indeed.com/viewjob?jk=0123456789abcdef",
  "https://uk.indeed.com/viewjob?jk=0123456789abcdef",
  "https://www.indeed.co.uk/viewjob?jk=0123456789abcdef",
  "https://www.glassdoor.com/job-listing/senior-data-engineer-acme-JV_IC1147401_KO0,20_KE21,25.htm?jl=1009123456789",
  "https://www.ziprecruiter.com/c/Acme/Job/Senior-Data-Engineer/-in-Austin,TX?jid=abc123",
  "https://www.monster.com/job-openings/senior-data-engineer-austin-tx--1234",
  "https://www.totaljobs.com/job/senior-data-engineer/acme-job104123456",
  "https://www.seek.com.au/job/81234567",
];

describe("the reader answers a LinkedIn link from its own words, and fetches nothing", () => {
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("the link reader made a request")));
  afterEach(() => spy.mockClear());

  it("a /jobs/view/<title>-at-<company>-<id> link is a search for that title at that employer, said to be one", () => {
    for (const url of [
      LINKEDIN_SLUG,
      "https://uk.linkedin.com/jobs/view/senior-data-engineer-at-acme-analytics-4012345678",
      "linkedin.com/jobs/view/senior-data-engineer-at-acme-analytics-4012345678",
    ]) {
      const r = parseJobLink(url);
      expect(r, url).toMatchObject({
        kind: "words",
        site: "linkedin",
        suggestedSearch: { query: "senior data engineer", companies: ["acme analytics"] },
      });
      if (r.kind !== "words") continue;
      expect(r.note).toMatch(/a search for this title at this employer, not this posting/);
      expect(r.note).toMatch(/LinkedIn posts are often agencies or reposts/);
      expect(r.note).toMatch(/check the employer and title before applying/);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("a title with 'at' in it splits at the last '-at-'", () => {
    expect(parseJobLink("https://www.linkedin.com/jobs/view/head-of-data-at-scale-at-acme-4012345678")).toMatchObject({
      suggestedSearch: { query: "head of data at scale", companies: ["acme"] },
    });
  });

  it("a LinkedIn link that carries no title asks the person for the title and employer, with no search", () => {
    for (const url of [LINKEDIN_BARE, "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4012345678", "https://lnkd.in/gAbCdEf"]) {
      const r = parseJobLink(url);
      expect(r, url).toMatchObject({ kind: "words", site: "linkedin" });
      if (r.kind !== "words") continue;
      expect(r.suggestedSearch).toBeUndefined();
      expect(r.note).toMatch(/ask the person for the title and employer/);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("an aggregator link is a site we don't read: ask the person for the title and employer", () => {
    for (const url of AGGREGATORS) {
      const r = parseJobLink(url);
      expect(r, url).toMatchObject({ kind: "words", site: "aggregator" });
      if (r.kind !== "words") continue;
      expect(r.suggestedSearch).toBeUndefined();
      expect(r.note).toMatch(/we don't read that site/i);
      expect(r.note).toMatch(/ask the person for the title and employer/);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("no LinkedIn or aggregator link is ever read as a board id or a candidate", () => {
    for (const url of [LINKEDIN_SLUG, LINKEDIN_BARE, ...AGGREGATORS]) {
      expect(parseJobLink(url, { workday: true }).kind, url).toBe("words");
    }
  });
});

describe("the shipped agent-mcp handler, given these links, reaches no host but its own board", () => {
  let mcp: KeylessMcp;
  const reached: string[] = [];
  beforeAll(async () => {
    mcp = await bootKeylessMcp();
    const g = globalThis as Record<string, unknown>;
    const inner = g.fetch as (url: string, init?: unknown) => Promise<Response>;
    g.fetch = (url: string, init?: unknown) => {
      reached.push(String(url));
      return inner(url, init);
    };
  }, 120_000);

  it.each([
    ["get_job", { id: LINKEDIN_SLUG }],
    ["apply_myself", { id: LINKEDIN_BARE }],
    ["fetch", { id: AGGREGATORS[0] }],
    ["get_jobs", { ids: [LINKEDIN_SLUG, AGGREGATORS[3]] }],
    ["check_jobs_open", { ids: [LINKEDIN_BARE, AGGREGATORS[1]] }],
  ] as Array<[string, Record<string, unknown>]>)("%s", async (name, args) => {
    reached.length = 0;
    await mcp.call(args, { name });
    const hosts = reached.map((u) => new URL(u).hostname);
    for (const h of hosts) expect(h, `${name} reached ${h}`).toMatch(/^(?:harness\.supabase\.co|openai\.com)$/);
    expect(hosts.join(" ")).not.toMatch(/linkedin|lnkd|indeed|glassdoor|ziprecruiter|monster|totaljobs|seek/);
  });
});
