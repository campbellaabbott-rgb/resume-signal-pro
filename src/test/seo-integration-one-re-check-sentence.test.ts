/**
 * ONE RE-CHECK RULE, SPELLED THE SAME WAY BY BOTH RENDERERS (SEO round
 * integration, 2026-10-24; the R6 hand-off).
 *
 * The bake said "the live board re-checks a posting when you open it, where
 * the employer's system allows it" and React's posting note said "opening a
 * posting whose feed we last read more than 6 hours ago asks the employer's
 * system again". Both were conditional, but the bake's left out the one
 * condition the board actually applies (Jobs.tsx asks again only past
 * VERIFY_ON_VIEW_AFTER_HOURS), and React's own banned list
 * (BANNED_SOURCE_CLAIMS) refused the bake's wording. The bake's clause now
 * states React's rule with the vendor condition, and the board's sources note
 * (jobsPage.sourceNote, rendered on /jobs and every company and field page)
 * no longer says "official public job-board APIs" or that a taken-down
 * posting disappears "on the next pass".
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RECHECK_AFTER_HOURS, RECHECK_CLAUSE, bannedSourcePhrasesIn } from "../../scripts/prerender-copy.mjs";
import { companyLanderPage, landerOpenings } from "../../scripts/prerender-pages.mjs";
import { BANNED_SOURCE_CLAIMS, VERIFY_ON_VIEW_AFTER_HOURS } from "@/lib/seo/source-copy";
import { possessive } from "@/lib/company-display";
import { companyBoardHead } from "@/lib/seo/board-heads";

const LOCALES = join(__dirname, "../i18n/locales");
const locales = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));
const read = (f: string) => JSON.parse(readFileSync(join(LOCALES, f), "utf8"));

describe("the bake's re-check clause is React's rule", () => {
  it("names the threshold Jobs.tsx applies", () => {
    expect(RECHECK_AFTER_HOURS).toBe(VERIFY_ON_VIEW_AFTER_HOURS);
    expect(RECHECK_CLAUSE).toContain(`more than ${VERIFY_ON_VIEW_AFTER_HOURS} hours ago`);
    expect(RECHECK_CLAUSE).toMatch(/where that system allows it$/);
  });

  it("passes both renderers' banned lists", () => {
    const sentence = `the live board ${RECHECK_CLAUSE}.`;
    expect(bannedSourcePhrasesIn(sentence)).toEqual([]);
    expect(BANNED_SOURCE_CLAIMS.filter((re) => re.test(sentence)).map(String)).toEqual([]);
  });

  it("is what a company page prints next to its openings (the code path runs)", () => {
    const listed = landerOpenings({ postings: [{ id: "a", path: "/jobs/posting/greenhouse/acme/a", title: "Nurse", place: "Leeds" }], cached: null, today: "2026-10-24" });
    const p = companyLanderPage({
      token: "acme", name: "Acme", primaryToken: "acme", openN: 40, facts: null, openings: listed.openings, boardCompanies: null,
      site: "https://resumebooster.work", esc: (s: string) => s, possessive, fmt: (n: number) => n.toLocaleString("en-US"), href: (t: string) => `/jobs/company/${t}`,
    });
    expect(p.content).toContain(`the live board ${RECHECK_CLAUSE}`);
    expect(BANNED_SOURCE_CLAIMS.filter((re) => re.test(p.content)).map(String)).toEqual([]);
  });

  it("and React's posting note states the same threshold in English", () => {
    const note = String(read("en.json").jobPostingPage.sourceNote).replace("{{hours}}", String(VERIFY_ON_VIEW_AFTER_HOURS));
    expect(note).toContain(`more than ${VERIFY_ON_VIEW_AFTER_HOURS} hours ago asks the employer's system again`);
  });
});

describe("the board's sources note, in every locale", () => {
  it.each(locales)("%s keeps {{vendors}} and the Ghost Job Index, and drops the two claims", (f) => {
    const note = String(read(f).jobsPage.sourceNote);
    expect(note).toContain("{{vendors}}");
    expect(note).toContain("Ghost Job Index");
    expect(note).not.toMatch(/official public job-board APIs/i);
    expect(note).not.toMatch(/disappear on the next pass/i);
  });

  it("the English note says when a taken-down posting leaves (positive control)", () => {
    expect(read("en.json").jobsPage.sourceNote).toContain("leaves the board when the rotation next re-reads that company's feed");
  });
});

// The React company head builds its description up to the snippet budget the
// way the bake does (OBS-2), so a long employer name gives way in every
// language instead of overflowing; seo-react-one-head-per-address holds the
// English equal to the bake's.
describe("a long employer name's description fits the snippet budget in every locale", () => {
  const name = "The Very Long Employer Name Of Many Words Incorporated";
  it.each(locales)("%s", (f) => {
    const lp = read(f).jobsPage as Record<string, string>;
    const t = (key: string, def: string, vars?: Record<string, unknown>) => {
      const k = key.replace(/^jobsPage\./, "");
      const tpl = typeof lp[k] === "string" ? lp[k] : def;
      return tpl.replace(/\{\{(\w+)\}\}/g, (_, v) => String((vars ?? {})[v] ?? ""));
    };
    for (const kind of ["employer", "agency"] as const) {
      const h = companyBoardHead({ kind, name, possessive: `${name}'s`, n: "1,234", t });
      expect(h.description.length, `${f} ${kind}: ${h.description}`).toBeLessThanOrEqual(160);
      expect(h.description).toContain(name);
    }
  });
});
