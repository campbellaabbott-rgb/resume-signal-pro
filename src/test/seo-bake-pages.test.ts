/**
 * THE BAKE'S PAGE RULES, RUN AGAINST THE ROWS THE 2026-10-18 BAKE PUBLISHED
 * (SEO round). Each case is a defect the before-audit measured on the baked
 * output; the pure functions that decide it live in scripts/prerender-pages.mjs
 * and scripts/prerender-copy.mjs, and the bake calls them as they are called
 * here.
 */
import { describe, expect, it } from "vitest";
import {
  boardVendorOf, companyCarryState, companyLanderPage, landerOpenings, postingReserveSplit, postingStubEntry, postingStubPage,
} from "../../scripts/prerender-pages.mjs";
import {
  BANNED_SOURCE_PHRASES, RECHECK_CLAUSE, SOURCE_SENTENCE, bannedSourcePhrasesIn, orgNode, wilsonPct, withWebsiteGraph,
} from "../../scripts/prerender-copy.mjs";

const SITE = "https://resumebooster.work";
const TODAY = "2026-10-18";
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const possessive = (n: string) => (/s$/i.test(n) ? `${n}'` : `${n}'s`);
const fmt = (n: number) => n.toLocaleString("en-US");
const href = (t: string) => `/jobs/company/${t}`;
type Page = { title: string; description: string; content: string; canonical: string | null; robots: string | null; jsonLd: Array<Record<string, unknown>> };
const lander = (over: Record<string, unknown> = {}): Page => companyLanderPage({
  token: "dominos", name: "Domino's", primaryToken: "dominos", openN: 23789, countedOn: TODAY,
  facts: { countries: [], fields: [] }, openings: [], boardCompanies: 29000, site: SITE, esc, possessive, fmt, href,
  ...over,
}) as Page;

describe("SEO-005 / S12-131: a company page links only pages the bake wrote, and names its own hiring system", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: `smartrecruiters:dominos:${i}`, title: `Delivery Driver ${i}`, place: "Ann Arbor, MI" }));
  it("prints a row with no posting page as text, links a baked one, and never links /jobs?job=", () => {
    const listed = landerOpenings({
      postings: [], cached: { at: TODAY, rows }, today: TODAY,
      pageFor: (id: string) => (id === "smartrecruiters:dominos:3" ? "/jobs/posting/smartrecruiters/dominos/3" : null),
    });
    const p = lander({ openings: listed.openings, openingsAt: listed.at, vendor: "SmartRecruiters" });
    expect(p.content).not.toMatch(/href="\/jobs\?job=/);
    expect(p.content).toContain('href="/jobs/posting/smartrecruiters/dominos/3"');
    expect(p.content).toContain("<li>Delivery Driver 0 — Ann Arbor, MI</li>");
    // One link to the live board, which every row opens on.
    expect(p.content).toContain('href="/jobs/company/dominos"');
    // The board's own hiring system, never all nineteen.
    expect(p.content).toContain("(SmartRecruiters)");
    expect(p.content).not.toMatch(/one of [A-Z]/);
    // Only the baked page is an item of the page's list.
    const items = (p.jsonLd[0].mainEntity as { itemListElement: unknown[] } | undefined)?.itemListElement ?? [];
    expect(items).toHaveLength(1);
  });
  it("names the vendor from a listed id, or a Workday or UKG token's shape, and otherwise none", () => {
    const labelOf = (k: string) => ({ workday: "Workday", ukg: "UKG Pro Recruiting", greenhouse: "Greenhouse" } as Record<string, string>)[k] ?? null;
    expect(boardVendorOf("acme", { ids: ["greenhouse:acme:1"], labelOf })).toBe("Greenhouse");
    expect(boardVendorOf("iqvia~wd1~IQVIA", { ids: [], labelOf })).toBe("Workday");
    expect(boardVendorOf("recruiting~ONE1006ONEAL~x", { ids: [], labelOf })).toBe("UKG Pro Recruiting");
    expect(boardVendorOf("dominos", { ids: [], labelOf })).toBeNull();
    expect(lander({ vendor: null }).content).not.toMatch(/\(one of|\(\s*\)/);
  });
});

describe("R6a / R5a: the re-check carries its condition and the source sentence makes no promise the board cannot keep", () => {
  it("company pages say the board re-checks where the employer's system allows it", () => {
    const listed = landerOpenings({ postings: [{ id: "a", path: "/jobs/posting/x/y/a", title: "One", place: "" }], cached: null, today: TODAY });
    const p = lander({ openings: listed.openings });
    expect(p.content).toContain(`the live board ${RECHECK_CLAUSE}`);
    expect(bannedSourcePhrasesIn(p.content)).toEqual([]);
  });
  it("the banned-phrase check catches every form the 2026-10-18 bake printed, and passes the new sentences", () => {
    const old = [
      "Pulled straight from Acme's own hiring system — never an aggregator, never a repost.",
      "No aggregators: each opening is read from the hiring system of the company that published it.",
      "the live board re-checks a posting when you open it.",
      "collected from companies' own official career sites — never aggregators",
    ];
    for (const s of old) expect(bannedSourcePhrasesIn(s), s).not.toEqual([]);
    expect(bannedSourcePhrasesIn(`Every opening is ${SOURCE_SENTENCE}; the board ${RECHECK_CLAUSE}.`)).toEqual([]);
    expect(BANNED_SOURCE_PHRASES.length).toBeGreaterThanOrEqual(4);
  });
});

describe("S12-021: an employer's indexable page states the employer's count, across its boards", () => {
  it("titles PwC with the sum of its boards and says how many", () => {
    const p = lander({ token: "pwc~wd3~crm_experienced_careers_site", primaryToken: "pwc~wd3~crm_experienced_careers_site", name: "PwC", openN: 3011, boards: 3 });
    expect(p.title).toBe("PwC jobs: 3,011 open roles across 3 hiring-system boards");
    expect(p.description).toContain("3,011 open roles at PwC across 3 of its hiring-system boards");
    expect(p.content).toContain("3,011 open PwC roles across 3 of PwC's hiring-system boards");
    // A single board keeps its own wording.
    expect(lander({ boards: 1 }).title).toBe("Domino's jobs: 23,789 open roles from their own hiring system");
  });
});

describe("SEO-037: a board sharing a name with a different, larger employer keeps its own canonical and no index", () => {
  it("is self-canonical, noindex, and says which board it is", () => {
    const p = lander({ token: "rochester~wd5~UR_Staff", primaryToken: "ur~wd1~URcareers", name: "University of Rochester", openN: 400, nameShared: true, vendor: "Workday" });
    expect(p.canonical, "a canonical to a different employer's page").toBeNull();
    expect(p.robots).toBe("noindex, follow");
    expect(p.title).toContain("on its Workday board “UR_Staff”");
    expect(p.title.length).toBeLessThanOrEqual(68);
    // The bake knows only that the two tenants differ, not that two employers do.
    expect(p.content).toContain("another board under the same name, which we cannot tie to this one, has a page of its own");
    expect(p.content).not.toContain("a different employer under the same name");
    // The same employer's sibling board still canonicalises to its primary.
    const sibling = lander({ token: "pwc~wd3~global_campus_careers", primaryToken: "pwc~wd3~crm_experienced_careers_site", name: "PwC", openN: 355 });
    expect(sibling.canonical).toBe("/jobs/company/pwc~wd3~crm_experienced_careers_site");
  });
});

describe("S13-117: a token two hiring systems carry names no employer", () => {
  it("prints the collision page's own words and no Organization", () => {
    const p = lander({ token: "lush", primaryToken: "lush", name: "Lush", collision: { h1: "Open roles on boards named “lush”", lead: "2 hiring systems carry a board with this name. Nothing we hold says whether they are one employer, so this page shows no employer facts." } });
    expect(p.title).toBe("Open roles on boards named “lush”");
    expect(p.content).not.toMatch(/own hiring system|Open roles at Lush/);
    expect(JSON.stringify(p.jsonLd)).not.toMatch(/"about"|"Organization"/);
  });
});

describe("S13-047: an employer still on the board is never tombstoned", () => {
  it("keeps a stub past the keep window while the board carries the token with open roles", () => {
    expect(companyCarryState({ prior: { state: "stub", since: "2026-07-01" }, today: TODAY, onBoard: true, cachedYoung: false })).toBe("stub");
    expect(companyCarryState({ prior: { state: "tombstone", since: "2026-07-01" }, today: TODAY, onBoard: true, cachedYoung: false })).toBe("stub");
    expect(companyCarryState({ prior: { state: "stub", since: "2026-07-01" }, today: TODAY, onBoard: false, cachedYoung: false })).toBe("tombstone");
  });
});

describe("SEO-039: a duplicate posting stub points its canonical at its twin and the ledger keeps the twin", () => {
  it("canonicalises to the twin with no noindex, and the entry carries duplicateOf", () => {
    const twin = "/jobs/posting/workday/kiongroup~wd3~KION_SCS/JR-0088008";
    const p = postingStubPage({ path: "/jobs/posting/workday/kiongroup~wd3~KION_SCS/JR-0088009", id: "workday:kiongroup~wd3~KION_SCS:JR-0088009", state: "retired", title: "Operator", company: "KION", windowDays: 30, duplicateOf: twin, esc }) as Page;
    expect(p.canonical).toBe(twin);
    expect(p.robots).toBeNull();
    const e = postingStubEntry({ stub: { state: "retired", id: "workday:kiongroup~wd3~KION_SCS:JR-0088009", duplicateOf: twin }, prior: undefined, today: TODAY, employerName: (_t: string, s: string) => s, tokenOf: () => "kiongroup~wd3~KION_SCS" });
    expect(e.duplicateOf).toBe(twin);
    // A gone, unchecked or seeded stub keeps noindex and its own canonical.
    const gone = postingStubPage({ path: "/jobs/posting/a/b/c", id: "a:b:c", state: "gone", title: "X", company: "Y", windowDays: 30, esc }) as Page;
    expect(gone.robots).toBe("noindex, follow");
    expect(gone.canonical ?? null).toBeNull();
    // Its board link is not followed: it is the /jobs page with a dialog open.
    const unchecked = postingStubPage({ path: "/jobs/posting/a/b/c", id: "a:b:c", state: "unchecked", title: "X", company: "Y", windowDays: 30, esc }) as Page;
    expect(unchecked.content).toMatch(/href="\/jobs\?job=[^"]+" rel="nofollow"/);
  });
});

describe("SEO-017: the fresh reserve is real once the ceiling is full", () => {
  it("retires carried pages expiring within three days, soonest first, down to ceiling - reserve", () => {
    const carried = Array.from({ length: 500 }, (_, i) => ({ id: i, vt: i < 150 ? "2026-10-20" : "2026-11-10" }));
    carried[120].vt = "2026-10-19";
    const split = postingReserveSplit(carried, { ceiling: 500, reserve: 100, today: TODAY, validThroughOf: (d: { vt: string }) => d.vt });
    expect(split.keep).toHaveLength(400);
    expect(split.retire).toHaveLength(100);
    const ids = split.retire.map((d: { id: number }) => d.id);
    expect(ids, "the soonest to expire goes first").toContain(120);
    expect(ids, "a later one waits").not.toContain(99);
    expect(split.retire.every((d: { vt: string }) => d.vt <= "2026-10-21")).toBe(true);
  });
  it("never retires a page with time left, so the reserve is only as large as the expiring pages allow", () => {
    const carried = Array.from({ length: 500 }, (_, i) => ({ vt: i < 30 ? "2026-10-21" : "2026-11-10" }));
    const split = postingReserveSplit(carried, { ceiling: 500, reserve: 100, today: TODAY, validThroughOf: (d: { vt: string }) => d.vt });
    expect(split.retire).toHaveLength(30);
    expect(postingReserveSplit(carried.slice(0, 380), { ceiling: 500, reserve: 100, today: TODAY, validThroughOf: (d: { vt: string }) => d.vt }).retire).toEqual([]);
  });
});

describe("SEO-011a: one Organization, no legal identity, and the WebSite names it", () => {
  it("carries no legalName, address, contactPoint or sameAs until the owner supplies them", () => {
    const o = orgNode(SITE);
    expect(o["@id"]).toBe(`${SITE}/#org`);
    expect(o.logo).toBe(`${SITE}/icons/icon-512.png`);
    for (const k of ["legalName", "address", "contactPoint", "sameAs"]) expect(o, k).not.toHaveProperty(k);
  });
  it("gives the template's WebSite block an @id and the Organization as publisher, keeping its SearchAction", () => {
    const html = '<head><script type="application/ld+json">\n{ "@context": "https://schema.org", "@type": "WebSite", "name": "Resume Booster", "url": "https://resumebooster.work", "potentialAction": { "@type": "SearchAction" } }\n</script></head>';
    const out = withWebsiteGraph(html, SITE);
    const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(out)![1]);
    expect(ld["@id"]).toBe(`${SITE}/#website`);
    expect(ld.publisher).toEqual({ "@id": `${SITE}/#org` });
    expect(ld.potentialAction).toEqual({ "@type": "SearchAction" });
  });
});

describe("SEO-009: the daily re-check's 95% interval", () => {
  it("is the Wilson interval, which never claims a certainty a sample cannot give", () => {
    expect(wilsonPct(117, 117)).toEqual([96.8, 100]);
    expect(wilsonPct(112, 113)).toEqual([95.1, 99.9]);
    expect(wilsonPct(0, 0)).toBeNull();
  });
});
