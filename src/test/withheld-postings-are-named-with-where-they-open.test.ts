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
 *
 * OD16 (2026-11-19): USAJOBS is no longer a withheld system. A federal row is
 * handed on once its who-may-apply statement is stored; one without it is
 * held back, and the note says so by name. (This harness answers no
 * statement, so its federal row is held back.)
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

  it("a USAJOBS announcement without its who-may-apply statement, by its own name and why, and the query in the site search", async () => {
    mcp.board = () => new Response(JSON.stringify({
      jobs: [row("usajobs:usajobs:800001", "Nurse"), row("greenhouse:acme:1", "Nurse")],
      total: 2, hasMore: false,
    }), { status: 200 });
    const out = JSON.parse((await mcp.call({ query: "nurse" })).text);
    expect(out.jobs).toHaveLength(1);
    expect(out.withheld).toBe(1);
    expect(out.withheldNote).toMatch(/^1 more posting is on this page only on resumebooster\.work \(USAJOBS announcements whose statement of who may apply is not stored yet, which this server does not hand on yet\): https:\/\/resumebooster\.work\/jobs\?q=nurse$/);
    // It is not called a withheld system: the federal feed is handed on (OD16).
    expect(out.withheldNote).not.toMatch(/USAJOBS, which this server may not hand on/);
  });

  it("both reasons in one note when a SmartRecruiters row and an unlabelled federal row are held back", async () => {
    mcp.board = () => new Response(JSON.stringify({
      jobs: [row("smartrecruiters:sixt:744000000000001", "Nurse"), row("usajobs:usajobs:800002", "Nurse"), row("greenhouse:acme:1", "Nurse")],
      total: 3, hasMore: false,
    }), { status: 200 });
    const out = JSON.parse((await mcp.call({ query: "nurse" })).text);
    expect(out.withheld).toBe(2);
    expect(out.withheldNote).toMatch(/^2 more postings are on this page only on resumebooster\.work \(SmartRecruiters, which this server may not hand on; USAJOBS announcements whose statement of who may apply is not stored yet, which this server does not hand on yet\): /);
  });

  it("nothing withheld, no note", async () => {
    mcp.board = () => new Response(JSON.stringify({ jobs: [row("greenhouse:acme:1", "Nurse")], total: 1, hasMore: false }), { status: 200 });
    const out = JSON.parse((await mcp.call({ query: "nurse" })).text);
    expect(out.withheld).toBeUndefined();
    expect(out.withheldNote).toBeUndefined();
  });
});
