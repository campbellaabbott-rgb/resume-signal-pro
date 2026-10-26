/**
 * NO TWO POSTING PAGES SHARE A TITLE (SEO round integration, 2026-10-24).
 *
 * The CI parity test (sitemap-prerender-parity: "gives no two sitemap URLs
 * the same <title>") found two live postings under one title after the
 * 2026-10-18 publish. postingPageTitle keeps the place and drops the employer
 * when both do not fit beside a whole job title, so two employers' identical
 * titles in one city render one title. The bake now remembers every posting
 * title it writes and gives a later page that would repeat one its
 * requisition key (postingPageTitleAvoiding), and the React posting page keeps
 * the baked title on a load of its own indexable file.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { postingPageTitle, postingPageTitleAvoiding } from "@/components/jobs/posting-page";
import type { PostingRow } from "@/components/jobs/posting-page";

const row = (over: Partial<PostingRow>): PostingRow => ({
  id: "greenhouse:bethisraeldeaconess:4012345",
  title: "Registered Nurse - Intensive Care Unit",
  company: "Beth Israel Deaconess Medical Center",
  location: "Boston, MA",
  country: "US",
  postedAt: "2026-10-20T00:00:00Z",
  ...over,
} as PostingRow);

describe("postingPageTitleAvoiding", () => {
  const a = row({});
  const b = row({ id: "greenhouse:massgeneral:77001", company: "Massachusetts General Hospital" });

  it("two employers' identical titles in one city render one title from postingPageTitle (the defect)", () => {
    expect(postingPageTitle(a)).toBe(postingPageTitle(b));
    expect(postingPageTitle(a)).toBe("Registered Nurse - Intensive Care Unit — Boston, MA");
  });

  it("the second page takes its requisition key and the first keeps its title", () => {
    const taken = new Set<string>();
    const ta = postingPageTitleAvoiding(a, taken); taken.add(ta);
    const tb = postingPageTitleAvoiding(b, taken); taken.add(tb);
    expect(ta).toBe(postingPageTitle(a));
    expect(tb).not.toBe(ta);
    expect(tb).toContain("77001");
    expect(tb.length).toBeLessThanOrEqual(68);
  });

  it("a title nobody holds is left alone (positive control)", () => {
    expect(postingPageTitleAvoiding(a, new Set(["something else"]))).toBe(postingPageTitle(a));
  });

  it("a third collision on the same key form still comes out unique", () => {
    const taken = new Set<string>();
    const rows = [a, b, row({ id: "greenhouse:massgeneral:77001", company: "Massachusetts General Hospital", location: "Boston, MA" })];
    const titles = rows.map((r) => { const t = postingPageTitleAvoiding(r, taken); taken.add(t); return t; });
    expect(new Set(titles).size).toBe(3);
  });
});

describe("the bake and the app use it", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("the bake titles every posting page through it and remembers what it wrote", () => {
    const src = strip(readFileSync(join(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
    expect(src).toMatch(/D\.postingPageTitleAvoiding\(job, postingTitlesTaken\)/);
    expect(src).toMatch(/postingTitlesTaken\.add\(t\)/);
  });
  it("the React posting page keeps the baked title of a live posting", () => {
    const src = strip(readFileSync(join(__dirname, "../pages/JobPosting.tsx"), "utf8"));
    expect(src).toMatch(/preferBakedHead=\{live && !!shown\}/);
  });
});
