import { describe, expect, it } from "vitest";
import {
  companyLanderPage,
  landerFacts,
  landerHasOwnContent,
  landerRobots,
  landerThinBreaker,
  selectLanders,
} from "../../scripts/prerender-pages.mjs";
import { boardName, isCodeShapedName, possessive } from "@/lib/company-display";

/**
 * WHAT WAS WRONG, measured 2026-10-08 with a Googlebot UA (SEO report S1, F1,
 * register L4-12): the 487 company pages were 38% of the sitemap and, once the
 * name and count were normalised away, 485 of them were the same paragraph;
 * none linked a posting and the only link pointed back at the page itself. The
 * visible body printed a code annotation, "THE COUNT'S BASIS: ... so the number
 * below it is the number this page states". 169 of them named the employer by
 * its tenant code ("Ms Jobs — 605 Verified Openings"), and eight said
 * "Domino's's".
 */

const SITE = "https://resumebooster.work";
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: number) => n.toLocaleString("en-US");
const href = (t: string) => (/\.[^/]*$/.test(`/jobs/company/${t}`) ? `/jobs/company/${t}/` : `/jobs/company/${t}`);
const regions = new Intl.DisplayNames(["en"], { type: "region" });
const FIELDS: Record<string, string> = { finance: "Finance & Accounting", customer: "Customer Success & Support", engineering: "Engineering & IT", operations: "Operations & Logistics" };
const factsOf = (intel: unknown) => landerFacts(intel, { countryName: (c: string) => regions.of(c) ?? null, fieldLabel: (s: string) => FIELDS[s] ?? null });

// The two employers the report compared, with get_company_intel's live answers (2026-10-10).
const MS = { usd_n: 363, countries: [{ n: 509, country: "US" }, { n: 95, country: "IN" }, { n: 47, country: "GB" }], categories: [{ n: 147, category: "finance" }, { n: 105, category: "customer" }, { n: 78, category: "engineering" }] };
const DOMINOS = { countries: [{ n: 21828, country: "US" }, { n: 3, country: "CA" }], categories: [{ n: 6126, category: "customer" }, { n: 5743, category: "operations" }, { n: 400, category: "other" }] };

const page = (token: string, name: string, openN: number | null, intel: unknown, openings: Array<{ path: string; title: string; place: string }> = []) =>
  companyLanderPage({ token, name, primaryToken: token, openN, facts: factsOf(intel), openings, sources: "Workday, Greenhouse", boardCompanies: 31000, site: SITE, esc, possessive, fmt, href });

/** The body with its name and numbers taken out: what the report compared. */
const skeleton = (html: string, name: string) =>
  html.replace(/<[^>]*>/g, " ").split(esc(name)).join("X").replace(/\d[\d,]*/g, "N").replace(/\s+/g, " ").trim();

describe("a company page carries what the board knows about that employer and no other", () => {
  it("names where its roles are and in which fields, each linked into the board filtered that way", () => {
    const p = page("ms~wd5~external", "Morgan Stanley", 605, MS);
    expect(p.content).toContain(`<a href="/jobs/company/ms~wd5~external?country=IN">India</a>`);
    expect(p.content).toContain(`<a href="/jobs/company/ms~wd5~external?category=finance">Finance &amp; Accounting</a>`);
    expect(p.title).toBe("Morgan Stanley Jobs — 605 Verified Openings");
  });

  it("links the posting pages this bake wrote for it, in the body and as an ItemList", () => {
    const openings = [{ path: "/jobs/posting/workday/ms~wd5~external/JR1", title: "Performance Analyst", place: "Tempe, Arizona" }];
    const p = page("ms~wd5~external", "Morgan Stanley", 605, MS, openings);
    expect(p.content).toContain(`<a href="${openings[0].path}">Performance Analyst</a> — Tempe, Arizona`);
    const ld = p.jsonLd[0] as { mainEntity?: { itemListElement: Array<{ url: string }> } };
    expect(ld.mainEntity?.itemListElement[0].url).toBe(`${SITE}${openings[0].path}`);
  });

  it("two employers' pages differ in more than the name and the count", () => {
    expect(skeleton(page("ms~wd5~external", "Morgan Stanley", 605, MS).content, "Morgan Stanley"))
      .not.toBe(skeleton(page("dominos", "Domino's", 25792, DOMINOS).content, "Domino's"));
  });

  it("states its basis as prose, never as a code annotation, and never says Domino's's", () => {
    const p = page("dominos", "Domino's", 25792, DOMINOS);
    expect(p.content).not.toMatch(/[A-Z]{3,} [A-Z']{3,} [A-Z]{3,}:/);
    expect(p.content).not.toMatch(/the number below it/);
    expect(p.content).toContain("has not taken down and whose date falls inside the last 30 days");
    for (const s of [p.title, p.description, p.content]) expect(s).not.toMatch(/Domino(?:'|&#39;)s(?:'|&#39;)s/);
    expect(p.content).toContain("Domino's own official job board");
  });

  it("drops the catch-all bucket and empty rows from the facts", () => {
    const f = factsOf({ countries: [{ n: 0, country: "FR" }], categories: [{ n: 9, category: "other" }] });
    expect(f).toEqual({ countries: [], fields: [] });
    expect(landerHasOwnContent({ facts: f, postings: [] })).toBe(false);
  });
});

describe("a page with nothing of its own, or a name that is still a code, is not indexed", () => {
  it("noindexes on the board's answer, never on a failed read", () => {
    expect(landerRobots({ isPrimary: true, unreadable: false, answered: true, ownContent: false })).toBe("noindex, follow");
    expect(landerRobots({ isPrimary: true, unreadable: false, answered: false, ownContent: false }), "an RPC outage proves nothing").toBeNull();
    expect(landerRobots({ isPrimary: true, unreadable: false, answered: true, ownContent: true })).toBeNull();
    expect(landerRobots({ isPrimary: true, unreadable: true, answered: true, ownContent: true })).toBe("noindex, follow");
    expect(landerRobots({ isPrimary: false, unreadable: true, answered: true, ownContent: false }), "a secondary board canonicalises instead").toBeNull();
  });

  it("a read that answers 'nothing of its own' for most employers is a broken read, not thin pages", () => {
    expect(landerThinBreaker({ answered: 489, thin: 460 })).toBe(true);
    expect(landerThinBreaker({ answered: 489, thin: 30 })).toBe(false);
    expect(landerThinBreaker({ answered: 10, thin: 10 }), "too few answers to judge the read").toBe(false);
  });

  it("selects and groups employers by the name they use, and flags a tenant code", () => {
    const facet = [
      { token: "ms~wd5~external", name: "Ms", open: 605 },
      { token: "ms~wd5~private", name: "Ms", open: 243 },
      { token: "uoflhealth~wd1~UofLHealthCareers", name: "Uoflhealth", open: 300 },
      { token: "dominos", name: "Domino's", open: 25792 },
    ];
    const landers = selectLanders(facet, {
      openOf: (c: { open: number }) => c.open,
      displayName: (c: { token: string; name: string }) => boardName(c.token, c.name),
      unreadable: (c: { token: string }, name: string) => isCodeShapedName(c.token, name),
    });
    const by = Object.fromEntries(landers.map((l: { token: string }) => [l.token, l]));
    expect(by["ms~wd5~external"].name).toBe("Morgan Stanley");
    expect(by["ms~wd5~private"].primary, "one employer, one indexable page").toBe("ms~wd5~external");
    expect(by["uoflhealth~wd1~UofLHealthCareers"].unreadable).toBe(true);
    expect(by["dominos"].unreadable).toBe(false);
  });
});
