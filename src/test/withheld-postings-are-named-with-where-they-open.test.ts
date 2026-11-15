// @vitest-environment node
/**
 * WITHHELD POSTINGS ARE NAMED, WITH WHERE THEY OPEN (connect W3, BR-12, copy).
 *
 * Live 2026-11-07: {location:"Manchester", country:"GB",
 * employmentType:"part_time"} answered total 14, seven rows and withheld:3,
 * a bare number; the three were SIXT and PortmanDentex postings on
 * SmartRecruiters, which this server may not hand on (SmartRecruiters stays
 * withheld until SAP permits, owner decision in force). The answer now says
 * which hiring systems were held back and gives the site's own search for the
 * same arguments, where they open. Nothing withheld, no note.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const row = (id: string, title: string) => ({ id, source: id.split(":")[0], title, company: "X" });

describe("a page with withheld rows says what and where", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => { mcp = await bootKeylessMcp(); }, 120_000);

  it("SmartRecruiters rows held back: withheld counts them and withheldNote names the system and the site search", async () => {
    mcp.board = () => new Response(JSON.stringify({
      jobs: [
        row("greenhouse:acme:1", "Sales Assistant"),
        row("smartrecruiters:sixt:744000000000001", "Rental Agent"),
        row("smartrecruiters:portmandentex:744000000000002", "Dental Nurse"),
        row("lever:beta:2f0c6c4e-9a8b-4c1d-8e2f-0a1b2c3d4e5f", "Barista"),
      ],
      total: 14, hasMore: false,
    }), { status: 200 });
    const out = JSON.parse((await mcp.call({ location: "Manchester", country: "GB", employmentType: "part_time" })).text);
    expect(out.jobs).toHaveLength(2);
    expect(out.withheld).toBe(2);
    expect(out.withheldNote).toMatch(/^2 more postings are on this page only on resumebooster\.work \(SmartRecruiters, which this server may not hand on\): /);
    expect(out.withheldNote).toContain("https://resumebooster.work/jobs?location=Manchester&country=GB");
  });

  it("USAJOBS by its own name, and the query in the site search", async () => {
    mcp.board = () => new Response(JSON.stringify({
      jobs: [row("usajobs:federal:800001", "Nurse"), row("greenhouse:acme:1", "Nurse")],
      total: 2, hasMore: false,
    }), { status: 200 });
    const out = JSON.parse((await mcp.call({ query: "nurse" })).text);
    expect(out.withheldNote).toMatch(/^1 more posting is on this page only on resumebooster\.work \(USAJOBS, which this server may not hand on\): https:\/\/resumebooster\.work\/jobs\?q=nurse$/);
  });

  it("nothing withheld, no note", async () => {
    mcp.board = () => new Response(JSON.stringify({ jobs: [row("greenhouse:acme:1", "Nurse")], total: 1, hasMore: false }), { status: 200 });
    const out = JSON.parse((await mcp.call({ query: "nurse" })).text);
    expect(out.withheld).toBeUndefined();
    expect(out.withheldNote).toBeUndefined();
  });
});
