// @vitest-environment node
/**
 * A SPONSORSHIP SEARCH NEVER RANKS ON REFUSALS (connect W1, BR-01).
 *
 * Live 2026-11-07: search_jobs {query:"visa sponsorship software engineer"}
 * answered ten rows, every one a description match, and seven of the ten
 * (the first two among them) said they would NOT sponsor: the words matched
 * the employers' own refusal disclaimers. The board has no sponsorship
 * filter. The words now leave the query, and the answer says plainly that the
 * board cannot filter by sponsorship and that only a posting's own text can
 * say it sponsors (owner decision 2026-11-07).
 *
 * The ten rows below are that live answer's sponsorship sentences (browse lens
 * calls/g05_visa_rows.json): what the description tier ranked on.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readQuery } from "../../supabase/functions/agent-mcp/query-place";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const VISA_ROWS: ReadonlyArray<{ id: string; title: string; company: string; says: "refuses" | "offers"; line: string }> = [
  { id: "greenhouse:roblox:8243631", title: "Software Engineer, Engine Harmony", company: "Roblox", says: "refuses", line: "visa categories, or support future H-1B sponsorship at this time" },
  { id: "greenhouse:roblox:8325759", title: "Software Engineer, Engine Productivity", company: "Roblox", says: "refuses", line: "visa categories, or support future H-1B sponsorship at this time" },
  { id: "ashby:the-exploration-company:79fe8a46-8cee-4586-b650-6c0c48e86f62", title: "Software System Engineer", company: "The Exploration Company", says: "offers", line: "Relocation assistance is provided for those willing to relocate including visa sponsorship where applicable" },
  { id: "greenhouse:anthropic:5468901008", title: "Staff+ Software Engineer, STEM", company: "Anthropic", says: "offers", line: "Visa sponsorship: We do sponsor visas!" },
  { id: "rippling:quavo-inc:8d7ce36b-9600-4510-ad02-2be3bc6a3fa8", title: "Software Quality Engineer", company: "Quavo Inc", says: "refuses", line: "This role is not sponsorship eligible" },
  { id: "ashby:clera:f062a52d-8407-4b0b-9ab2-995252bc4b6c", title: "Senior Android Software Engineer", company: "Clera", says: "offers", line: "Visa sponsorship is available" },
  { id: "ashby:clera:5834311b-2358-4adb-bc18-ac36d02e0431", title: "Principal Robotics Software Engineer", company: "Clera", says: "refuses", line: "Visa sponsorship is not available" },
  { id: "paylocity:0eed7c03-694e-454b-8e29-7abbbc8e65b5:4646633", title: "Software Engineer", company: "BN, an Augeo company", says: "refuses", line: "This employer does not sponsor employment visas now or in the future for this position" },
  { id: "paylocity:0eed7c03-694e-454b-8e29-7abbbc8e65b5:4646636", title: "Senior Software Engineer", company: "BN, an Augeo company", says: "refuses", line: "This employer does not sponsor employment visas now or in the future for this position" },
  { id: "bamboohr:jorieai:165", title: "Software Engineer I", company: "Jorieai", says: "refuses", line: "No Contractors, No C2C, No Visa Sponsorship" },
];
/** A word of a sponsorship sentence the description tier would match. */
const SPONSOR_WORD = /^(?:visas?|sponsor(?:s|ed|ing|ship)?|h-?1-?b)$/i;

describe("the reader takes the sponsorship words out of the query", () => {
  it.each([
    ["visa sponsorship software engineer", "software engineer"],
    ["software engineer jobs with visa sponsorship", "software engineer"],
    ["H1B software engineer jobs", "software engineer"],
    ["data scientist H-1B sponsorship", "data scientist"],
    ["skilled worker visa care assistant", "care assistant"],
    ["companies that will sponsor a work visa software developer", "software developer"],
  ])("%s searches %s", (q, rest) => {
    const r = readQuery(q);
    expect(r.query).toBe(rest);
    expect(r.sponsorship).toBeTruthy();
  });

  it.each(["Sponsorship Manager", "Sponsorship Sales Executive", "Visa Analyst", "Tier 2 Support Engineer", "corporate sponsorship coordinator"])(
    "%s is a title and stays whole",
    (q) => expect(readQuery(q)).toEqual({ query: q }),
  );
});

describe("the server never sends the board a word the refusals are written in, and says why", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => {
    mcp = await bootKeylessMcp();
    mcp.board = () => new Response(JSON.stringify({
      jobs: VISA_ROWS.map((r) => ({ id: r.id, source: r.id.split(":")[0], title: r.title, company: r.company, matchScope: "description" })),
      total: 0, relatedTotal: 1718, hasMore: true, nextOffset: 10,
    }), { status: 200 });
  }, 120_000);

  it("'visa sponsorship software engineer' reaches the board as 'software engineer', with the plain sponsorship note", async () => {
    const out = JSON.parse((await mcp.call({ query: "visa sponsorship software engineer" })).text);
    const sent = String(mcp.boardCalls.find((b) => b.action === "list")!.q);
    expect(sent).toBe("software engineer");
    // Not one word sent is a word the ten rows' sponsorship sentences hold.
    for (const row of VISA_ROWS) {
      const lineWords = row.line.split(/[^A-Za-z0-9-]+/).filter((w) => SPONSOR_WORD.test(w)).map((w) => w.toLowerCase());
      expect(lineWords.length, row.id).toBeGreaterThan(0);
      for (const w of sent.toLowerCase().split(/\s+/)) expect(lineWords, `${row.id}: ${w}`).not.toContain(w);
    }
    expect(out.sponsorshipNote).toMatch(/cannot filter by visa sponsorship/);
    expect(out.sponsorshipNote).toMatch(/only when its text says so/);
    // The note never says any posting here sponsors.
    expect(out.sponsorshipNote).not.toMatch(/these (?:postings|jobs|roles) (?:offer|sponsor)/i);
    expect(out.locationInterpreted).toMatchObject({ query: "software engineer", from: "visa sponsorship" });
    // No card gains a sponsorship claim the board never made.
    for (const card of out.jobs) expect(Object.keys(card).filter((k) => /sponsor/i.test(k))).toEqual([]);
  });

  it("a search with no sponsorship words carries no sponsorship note", async () => {
    const out = JSON.parse((await mcp.call({ query: "software engineer" })).text);
    expect(out.sponsorshipNote).toBeUndefined();
  });
});
