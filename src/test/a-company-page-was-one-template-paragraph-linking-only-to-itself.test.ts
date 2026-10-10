import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import {
  LANDER_OPENINGS_READS,
  companiesLlmsLine,
  companyLanderPage,
  duplicateSkeletons,
  landerFacts,
  landerBreakers,
  landerHasOwnContent,
  landerOpenings,
  landerRobots,
  landerSkeleton,
  landerThinBreaker,
  nextOpeningsCache,
  openingsFromList,
  openingsToRead,
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
const TODAY = "2026-10-10";
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: number) => n.toLocaleString("en-US");
const href = (t: string) => (/\.[^/]*$/.test(`/jobs/company/${t}`) ? `/jobs/company/${t}/` : `/jobs/company/${t}`);
const regions = new Intl.DisplayNames(["en"], { type: "region" });
const FIELDS: Record<string, string> = { finance: "Finance & Accounting", customer: "Customer Success & Support", engineering: "Engineering & IT", operations: "Operations & Logistics" };
const factsOf = (intel: unknown) => landerFacts(intel, { countryName: (c: string) => regions.of(c) ?? null, fieldLabel: (s: string) => FIELDS[s] ?? null });

// The two employers the report compared, with get_company_intel's live answers (2026-10-10).
const MS = { usd_n: 363, countries: [{ n: 509, country: "US" }, { n: 95, country: "IN" }, { n: 47, country: "GB" }], categories: [{ n: 147, category: "finance" }, { n: 105, category: "customer" }, { n: 78, category: "engineering" }] };
const DOMINOS = { countries: [{ n: 21828, country: "US" }, { n: 3, country: "CA" }], categories: [{ n: 6126, category: "customer" }, { n: 5743, category: "operations" }, { n: 400, category: "other" }] };

type Opening = { href: string; title: string; place: string };
const page = (token: string, name: string, openN: number | null, intel: unknown, openings: Opening[] = [], openingsAt: string | null = null) =>
  companyLanderPage({ token, name, primaryToken: token, openN, facts: factsOf(intel), openings, openingsAt, sources: "Workday, Greenhouse", boardCompanies: 31000, site: SITE, esc, possessive, fmt, href });

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
    const { openings } = landerOpenings({ postings: [{ id: "workday:ms~wd5~external:JR1", path: "/jobs/posting/workday/ms~wd5~external/JR1", title: "Performance Analyst", place: "Tempe, Arizona" }], cached: null, today: TODAY });
    const p = page("ms~wd5~external", "Morgan Stanley", 605, MS, openings);
    expect(p.content).toContain(`<a href="/jobs/posting/workday/ms~wd5~external/JR1">Performance Analyst</a> — Tempe, Arizona`);
    const ld = p.jsonLd[0] as { mainEntity?: { itemListElement: Array<{ url: string }> } };
    expect(ld.mainEntity?.itemListElement[0].url).toBe(`${SITE}/jobs/posting/workday/ms~wd5~external/JR1`);
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
    expect(landerHasOwnContent({ openings: [] })).toBe(false);
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

describe("a company page lists the employer's own openings, not just a place and a field", () => {
  // Reviewer, 2026-10-10: S1 was half done. The only content most pages had
  // of their own was one to three country and field names, linked back to the
  // same page with ?country= or ?category= (the same static file to a crawler
  // that runs no script), and a place and a field are shared by hundreds of
  // employers, so near-template pages stayed indexable. The per-employer
  // openings read the comments described did not exist.
  const listing = (n: number, tag: string) => ({ jobs: Array.from({ length: n }, (_, i) => ({ id: `smartrecruiters:dominos:${tag}${i}`, title: `Delivery Driver ${tag} ${String.fromCharCode(97 + i)}`, location: "Ann Arbor, Michigan" })) });

  it("reads the board's listing into openings, each linked to the posting on the live board", () => {
    const rows = openingsFromList(200, listing(12, "x"));
    expect(rows).toHaveLength(10);
    const { openings, at, answered } = landerOpenings({ postings: [], cached: { at: "2026-10-08", rows }, today: TODAY });
    expect(answered).toBe(true);
    const p = page("dominos", "Domino's", 25792, DOMINOS, openings, at);
    const jobLinks = p.content.match(/href="\/jobs\?job=[^"]+"/g) ?? [];
    expect(jobLinks.length, "the report's bar for dominos: 10+ posting or job links").toBeGreaterThanOrEqual(10);
    expect(p.content).toContain(`href="/jobs?job=smartrecruiters%3Adominos%3Ax0"`);
    expect(p.content).toContain("read 2026-10-08");
    expect((p.jsonLd[0] as { mainEntity?: unknown }).mainEntity, "a board link is the board, not an item of this page").toBeUndefined();
    expect(openingsFromList(429, null), "a refused read is no answer").toBeNull();
  });

  it("a posting page of its own comes first and the board row for it is not listed twice", () => {
    const rows = openingsFromList(200, listing(3, "y"))!;
    const { openings } = landerOpenings({ postings: [{ id: rows[0].id, path: "/jobs/posting/smartrecruiters/dominos/y0", title: rows[0].title, place: "" }], cached: { at: TODAY, rows }, today: TODAY });
    expect(openings.map((o: Opening) => o.href)).toEqual(["/jobs/posting/smartrecruiters/dominos/y0", "/jobs?job=smartrecruiters%3Adominos%3Ay1", "/jobs?job=smartrecruiters%3Adominos%3Ay2"]);
  });

  it("a place and a field alone do not make a page its own; an answered short listing is noindex, an unread one keeps its index", () => {
    const short = landerOpenings({ postings: [], cached: { at: TODAY, rows: openingsFromList(200, listing(2, "z")) }, today: TODAY });
    expect(landerHasOwnContent({ openings: short.openings })).toBe(false);
    expect(landerRobots({ isPrimary: true, unreadable: false, answered: short.answered, ownContent: false })).toBe("noindex, follow");
    const unread = landerOpenings({ postings: [{ id: "a", path: "/jobs/posting/x/y/a", title: "One", place: "" }], cached: null, today: TODAY });
    expect(unread.answered, "a posting page with no listing read says nothing about the listing").toBe(false);
    expect(landerRobots({ isPrimary: true, unreadable: false, answered: unread.answered, ownContent: false })).toBeNull();
    const stale = landerOpenings({ postings: [], cached: { at: "2026-09-01", rows: openingsFromList(200, listing(10, "s")) }, today: TODAY });
    expect(stale.openings, "a listing older than the window is not printed").toEqual([]);
    expect(stale.answered).toBe(false);
  });

  it("each bake reads the never-read employers first, then the oldest, within its own reserve", () => {
    const tokens = ["a", "b", "c", "d", "e"];
    const cache = { a: { at: "2026-10-09", rows: [] }, b: { at: "2026-10-01", rows: [] }, d: { at: "2026-09-01", rows: [] } };
    expect(openingsToRead({ tokens, cache, today: TODAY, max: 3 })).toEqual(["c", "d", "e"]);
    expect(openingsToRead({ tokens, cache, today: TODAY, max: 4 })).toEqual(["c", "d", "e", "b"]);
    expect(LANDER_OPENINGS_READS).toBeGreaterThan(0);
    const next = nextOpeningsCache({ prior: cache, reads: new Map([["c", []]]), tokens: ["a", "b", "c", "d"], today: TODAY });
    expect(Object.keys(next).sort(), "the old entry for d is dropped, the read for c joins").toEqual(["a", "b", "c"]);
    expect(next.c.at).toBe(TODAY);
  });

  it("the report's measure: 450 employers with their own listings are 400+ distinct pages; with facts alone they collapse", () => {
    const titles = ["Nurse", "Driver", "Analyst", "Cashier", "Engineer", "Teller", "Chef", "Pharmacist", "Mechanic", "Welder", "Recruiter", "Planner"];
    const places = ["Austin, Texas", "Leeds", "Toronto, Ontario", "Pune", "Dublin"];
    const word = (k: number) => k.toString(26).replace(/\d/g, (d) => "abcdefghij"[Number(d)]).replace(/[k-p]/g, "x");
    const employers = Array.from({ length: 450 }, (_, k) => ({ token: `emp${k}`, name: `Employer ${word(k)} Group` }));
    const render = (withListing: boolean) => employers.map((e, k) => {
      const rows = withListing ? Array.from({ length: 6 }, (_, i) => ({ id: `greenhouse:${e.token}:${i}`, title: `${titles[(k + i) % titles.length]} ${word(k * 7 + i)}`, place: places[(k + i) % places.length] })) : [];
      const { openings, at } = landerOpenings({ postings: [], cached: withListing ? { at: TODAY, rows } : null, today: TODAY });
      const html = page(e.token, e.name, 40 + k, MS, openings, at).content;
      return { key: e.token, skeleton: landerSkeleton(html, [e.name, possessive(e.name)]) };
    });
    const listed = render(true);
    expect(new Set(listed.map((x) => x.skeleton)).size).toBeGreaterThanOrEqual(400);
    expect(duplicateSkeletons(listed).size).toBe(0);
    const bare = render(false);
    expect(new Set(bare.map((x) => x.skeleton)).size, "name and count swapped, nothing else: one page").toBe(1);
    expect(duplicateSkeletons(bare).size).toBe(450);
    expect(landerRobots({ isPrimary: true, unreadable: false, answered: false, ownContent: false, duplicate: true })).toBe("noindex, follow");
  });
});

describe("the bake reads the listings inside the build cap and keeps them for the next bake", () => {
  const bake = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
  it("the listings have their own share of the 721 reads, so the posting pages cannot spend it", () => {
    expect(bake).toMatch(/const BAKE_BOARD_CALL_BUDGET = 721;/);
    expect(bake).toMatch(/callBudget\(BAKE_BOARD_CALL_BUDGET - LANDER_OPENINGS_READS\)/);
    expect(bake).toMatch(/openingsBudget\.take\(\)/);
    expect(bake).toMatch(/openingsToRead\(\{ tokens: listedTokens, cache: landerOpeningsCache, today: TODAY \}\)/);
    expect(bake).toMatch(/openings: landerOpeningsCache,/);
  });
});

describe("llms-full says what /companies lists", () => {
  // Reviewer, 2026-10-10 (register L4-11): llms.txt was fixed but llms-full
  // still told answer engines /companies listed "every employer with open
  // roles", while the page lists the ~470 with a page of their own.
  it("counts the employers with a page of their own and says the board carries more", () => {
    const line = companiesLlmsLine({ site: SITE, count: 471 });
    expect(line).toContain("the 471 employers this site gives a page");
    expect(line).toContain("far more employers");
    expect(line).not.toMatch(/every employer/i);
    expect(companiesLlmsLine({ site: SITE, count: null }), "no number when the bake counted none").not.toMatch(/\d+ employers/);
  });
  it("the bake writes that line into llms-full", () => {
    expect(codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"))).toMatch(/lines\.push\(companiesLlmsLine\(\{ site: SITE, count: COMPANY_PAGE_COUNT \}\)\);/);
  });
});

describe("the two noindex rules together cannot take more than a quarter of the company pages", () => {
  // A mock bake with a cold listing cache noindexed 73 thin and 65 duplicate
  // pages of 489 under two separate quarter breakers, leaving 712 standing
  // sitemap URLs against a ratchet floor of 694; one more bad read and the
  // stale committed sitemap would have stayed in place.
  const toks = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`);
  it("the duplicate rule stands down when it and the thin pages together pass a quarter", () => {
    const candidates = toks(467, "c");
    const r = landerBreakers({ answered: toks(300, "c"), thin: toks(73, "c"), candidates, dupes: toks(65, "c").map((t) => t.replace("c", "c1")) });
    expect(r.thinBreaker).toBe(false);
    expect(r.dupeBreaker, "73 + 65 of 467 is past a quarter").toBe(true);
    expect(landerBreakers({ answered: toks(300, "c"), thin: toks(20, "c"), candidates, dupes: toks(40, "d") }).dupeBreaker).toBe(false);
  });
  it("a page both thin and duplicate counts once", () => {
    const r = landerBreakers({ answered: toks(400, "c"), thin: toks(90, "c"), candidates: toks(467, "c"), dupes: toks(90, "c") });
    expect(r.dupeBreaker).toBe(false);
  });
});
