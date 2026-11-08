// @vitest-environment node
/**
 * A PASTED LINK IS THE JOB, NOT A CLOSED JOB (connect W1, BR-03 and CJ-04).
 *
 * Live 2026-11-07: check_jobs_open answered a pasted
 * resumebooster.work/jobs?job=<id> link for an open Stripe posting "closed"
 * (it read the whole link as an id) beside the bare id "open", and a made-up
 * greenhouse:fake:123 "closed" too. And get_job refused the board's own
 * posting page, resumebooster.work/jobs/posting/workday/iko~wd3~Roofmart_Careers/REQ-13889
 * (the canonical page in the sitemap), as "not a job id from this board"
 * while check_jobs_open said that posting was open. Every job tool now reads
 * an id or a link through one reader (agent-mcp/job-link.ts); what names no
 * job is listed as unknown, never closed, and a well-formed id the board does
 * not hold is said to be closed, past the window, or never carried (the board's
 * exists answer cannot tell those apart). An employer link on Greenhouse's or
 * Lever's EU host names the eu~ id the board holds (recheck, 2026-11-08).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isJobIdShape, parseJobId } from "../../supabase/functions/agent-mcp/job-link";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const OPEN_ID = "workday:iko~wd3~Roofmart_Careers:REQ-13889";

describe("the one job reader names the board id a link points at", () => {
  it.each([
    [OPEN_ID, OPEN_ID],
    ["  greenhouse:acme:12345  ", "greenhouse:acme:12345"],
    [`https://resumebooster.work/jobs?job=${encodeURIComponent(OPEN_ID)}`, OPEN_ID],
    [`resumebooster.work/jobs?job=${encodeURIComponent(OPEN_ID)}`, OPEN_ID],
    ["https://www.resumebooster.work/jobs?q=nurse&job=greenhouse%3Aacme%3A12345", "greenhouse:acme:12345"],
    [`https://resumebooster.work/jobs/posting/workday/${encodeURIComponent("iko~wd3~Roofmart_Careers")}/REQ-13889`, OPEN_ID],
    ["https://resumebooster.work/jobs/posting/greenhouse/acme/12345/", "greenhouse:acme:12345"],
    ["https://resumebooster.work/jobs/posting/greenhouse%3Aacme%3A12345", "greenhouse:acme:12345"],
    ["https://job-boards.greenhouse.io/anthropic/jobs/5468901008", "greenhouse:anthropic:5468901008"],
    ["https://boards.greenhouse.io/embed/job_app?for=acme&token=12345", "greenhouse:acme:12345"],
    ["https://jobs.lever.co/acme/2f0c6c4e-9a8b-4c1d-8e2f-0a1b2c3d4e5f/apply", "lever:acme:2f0c6c4e-9a8b-4c1d-8e2f-0a1b2c3d4e5f"],
    ["https://jobs.ashbyhq.com/clera/f062a52d-8407-4b0b-9ab2-995252bc4b6c", "ashby:clera:f062a52d-8407-4b0b-9ab2-995252bc4b6c"],
  ])("%s is %s", (sent, id) => {
    expect(parseJobId(sent)).toBe(id);
  });

  // An employer in Greenhouse's or Lever's EU region is held as eu~<token>
  // (connect W1 recheck, 2026-11-08). Each pair below is a live row's id and
  // the applyUrl the board itself served for it (job-board list, 2026-11-08).
  it.each([
    ["https://job-boards.eu.greenhouse.io/imc/jobs/4960533101", "greenhouse:eu~imc:4960533101"],
    ["https://job-boards.eu.greenhouse.io/lookers/jobs/5029791101", "greenhouse:eu~lookers:5029791101"],
    ["https://boards.eu.greenhouse.io/lookers/jobs/5029791101", "greenhouse:eu~lookers:5029791101"],
    ["https://boards.eu.greenhouse.io/embed/job_app?for=lookers&token=5029791101", "greenhouse:eu~lookers:5029791101"],
    ["https://jobs.eu.lever.co/mobileye/28d00939-d06e-4f6d-84aa-4f155fe88b62", "lever:eu~mobileye:28d00939-d06e-4f6d-84aa-4f155fe88b62"],
  ])("an EU-region employer link %s is the EU posting %s", (sent, id) => {
    expect(parseJobId(sent)).toBe(id);
  });

  it.each(["not-an-id", "", "software engineer", "https://resumebooster.work/jobs", "https://example.com/jobs/123", "https://resumebooster.work/jobs/posting/greenhouse/acme", "a:b"])(
    "%j names no job",
    (sent) => expect(parseJobId(sent)).toBeNull(),
  );

  it("an id needs three parts with the first two filled", () => {
    expect(isJobIdShape("greenhouse:acme:1")).toBe(true);
    expect(isJobIdShape(":acme:1")).toBe(false);
    expect(isJobIdShape("greenhouse::1")).toBe(false);
  });
});

describe("the job tools answer a pasted link as the posting it names", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => {
    mcp = await bootKeylessMcp();
    mcp.board = (body) => {
      if (body.action === "detail") {
        return new Response(JSON.stringify({ job: { id: body.id, source: "workday", title: "Roofing Sales", company: "IKO" }, description: "Sell roofs." }), { status: 200 });
      }
      if (body.action === "exists") {
        const open: Record<string, boolean> = {};
        for (const id of body.ids as string[]) open[id] = id === OPEN_ID;
        return new Response(JSON.stringify({ open, rowTest: "served" }), { status: 200 });
      }
      return new Response(JSON.stringify({ jobs: [], total: 0, hasMore: false }), { status: 200 });
    };
  }, 120_000);
  beforeEach(() => { mcp.boardCalls.length = 0; });

  it("get_job with the board's /jobs/posting/ page reads that posting", async () => {
    const page = `https://resumebooster.work/jobs/posting/workday/${encodeURIComponent("iko~wd3~Roofmart_Careers")}/REQ-13889`;
    const res = await mcp.call({ id: page }, { name: "get_job" });
    expect(res.isError).toBe(false);
    expect(mcp.boardCalls).toEqual([{ action: "detail", id: OPEN_ID }]);
    expect(JSON.parse(res.text)).toMatchObject({ title: "Roofing Sales" });
  });

  it("check_jobs_open reads a ?job= link as open, lists junk as unknown, and says what closed means", async () => {
    const link = `https://resumebooster.work/jobs?job=${encodeURIComponent(OPEN_ID)}`;
    const fake = "greenhouse:nobody:99999999";
    const out = JSON.parse((await mcp.call({ ids: [link, "not-an-id", fake] }, { name: "check_jobs_open" })).text);
    expect(mcp.boardCalls).toEqual([{ action: "exists", ids: [OPEN_ID, fake] }]);
    expect(out.open).toEqual({ [link]: true, [fake]: false });
    expect(out.readAs).toEqual({ [link]: OPEN_ID });
    expect(out.closed).toEqual([fake]);
    expect(out.closed).not.toContain("not-an-id");
    expect(out.unknown).toEqual(["not-an-id"]);
    expect(out.unknownNote).toMatch(/not checked/);
    expect(out.closedNote).toMatch(/never carried/);
    expect(out.checked).toBe(2);
  });

  it("check_jobs_open asks the board about an EU Greenhouse link's EU id, never the US id it does not hold", async () => {
    const link = "https://job-boards.eu.greenhouse.io/imc/jobs/4960533101";
    const out = JSON.parse((await mcp.call({ ids: [link] }, { name: "check_jobs_open" })).text);
    expect(mcp.boardCalls).toEqual([{ action: "exists", ids: ["greenhouse:eu~imc:4960533101"] }]);
    expect(out.readAs).toEqual({ [link]: "greenhouse:eu~imc:4960533101" });
  });

  it("get_jobs names an entry that is no job as notAJobId and reads the link beside it", async () => {
    const link = `https://resumebooster.work/jobs?job=${encodeURIComponent(OPEN_ID)}`;
    const out = JSON.parse((await mcp.call({ ids: [link, "hello"] }, { name: "get_jobs" })).text);
    expect(mcp.boardCalls).toEqual([{ action: "detail", id: OPEN_ID }]);
    expect(out.returned).toBe(1);
    expect(out.requested).toBe(2);
    expect(out.unavailable).toEqual([expect.objectContaining({ id: "hello", reason: "notAJobId" })]);
  });
});
