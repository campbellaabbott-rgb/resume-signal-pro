/**
 * THE HOMEPAGE'S STRIP LISTS THE POSTING PAGES THE BAKE WROTE (B04, F07).
 *
 * A crawler fetching "/" on 2026-11-07 got the heading "On the board now",
 * its note, and no rows: no link to any posting or company page. The bake now
 * writes the homepage after the posting pages and lists up to eight of them
 * by the homepage's own rule (selectHomeRows), each with the day the employer
 * stated; with no row it prints no heading. homeStripRows is that rule.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homeStripRows, type BakedStripCandidate } from "@/lib/home/rows";

const NOW = new Date("2026-11-08T12:00:00Z");
const c = (over: Partial<BakedStripCandidate> & { id: string }): BakedStripCandidate => ({
  path: `/jobs/posting/greenhouse/acme/${over.id}`,
  title: `Role ${over.id}`,
  company: "Acme",
  place: "Leeds",
  token: "acme",
  source: "greenhouse",
  postedAt: "2026-11-06T00:00:00Z",
  agency: false,
  missingSince: null,
  ...over,
});

describe("homeStripRows", () => {
  it("lists a written page with its title, employer, place and the employer's stated day", () => {
    expect(homeStripRows([c({ id: "1" })], { now: NOW })).toEqual([
      { path: "/jobs/posting/greenhouse/acme/1", title: "Role 1", company: "Acme", place: "Leeds", day: "2026-11-06" },
    ]);
  });

  it("keeps one page per employer, so eight rows are eight employers", () => {
    const rows = homeStripRows([c({ id: "1" }), c({ id: "2" }), c({ id: "3", token: "beta", company: "Beta" })], { now: NOW, max: 8 });
    expect(rows.map((r) => r.company)).toEqual(["Acme", "Beta"]);
  });

  it("keeps no page outside the window, from a source that re-dates, gone, from an agency, or undated", () => {
    const rows = homeStripRows([
      c({ id: "old", postedAt: "2026-10-20T00:00:00Z" }),
      c({ id: "redate", token: "r", company: "R", source: "breezy" }),
      c({ id: "gone", token: "g", company: "G", missingSince: "2026-11-07T00:00:00Z" }),
      c({ id: "agency", token: "a", company: "A", agency: true }),
      c({ id: "undated", token: "u", company: "U", postedAt: null }),
    ], { now: NOW });
    expect(rows).toEqual([]);
  });

  it("stops at max", () => {
    const many = Array.from({ length: 12 }, (_, i) => c({ id: String(i), token: `t${i}`, company: `Employer ${i}` }));
    expect(homeStripRows(many, { now: NOW, max: 8 })).toHaveLength(8);
  });

  it("keeps no row whose employer name is blank", () => {
    expect(homeStripRows([c({ id: "1", company: " " })], { now: NOW })).toEqual([]);
  });
});

describe("the bake writes the homepage after its posting pages", () => {
  const src = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
  it("fills the strip from the pages it wrote, and calls the homepage write below the posting block", () => {
    const call = src.indexOf("writeHomePage(strip);");
    expect(call).toBeGreaterThan(src.indexOf("homeStripCandidates.push("));
    expect(src).toMatch(/const strip = D\.homeStripRows\(newestFirst, \{ max: 8, now: nowForStrip \}\);/);
  });
  it("prints the heading only over rows", () => {
    expect(src).toMatch(/\$\{strip\.length \? `<h2 class="text-xl font-bold mb-2">\$\{esc\(H\.board\.title\)\}<\/h2>/);
  });
});
