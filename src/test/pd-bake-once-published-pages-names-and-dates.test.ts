/**
 * THE BAKE'S DECISIONS ABOUT PAGES IT NO LONGER CHOOSES, NAMES IT CANNOT
 * PRINT, DUPLICATES, AND DATES (SEO report 2026-10-12: SEO-002, SEO-006,
 * SEO-025, SEO-033, SEO-036). Each rule is a pure function in
 * scripts/prerender-pages.mjs or scripts/prerender-names.mjs, run here
 * against the cases the report measured; the bake that calls them is run by
 * pd-bake-the-crawler-copy-sells-nothing-retired.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMPANY_STUB_KEEP_DAYS, POSTING_STUB_KEEP_DAYS, companyCarryState, companyLedgerEntry, companyStubPage, companyTokenOf,
  contentFingerprint, duplicateSkeletonGroups, onceCompanyPaths, pageDates, postingCarryBase, postingCeilingSplit, postingStubPage,
  resolveDuplicateGroups, seedPostingLedger, tombstoneHtml, COUNT_BEARING, FINGERPRINT_VERSION,
} from "../../scripts/prerender-pages.mjs";
import { bakeEmployerName, repairEmployerName, unpublishableNameReason } from "../../scripts/prerender-names.mjs";
import { changedUrls } from "../../scripts/indexnow-ping.mjs";
import { postingIdFromPath } from "@/components/jobs/posting-page";

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TODAY = "2026-10-12";
const P1 = "/jobs/posting/workday/acme~wd1~ext/R1";
const P2 = "/jobs/posting/workday/acme~wd1~ext/R2";

describe("SEO-002: a published posting URL never falls back to the homepage", () => {
  it("seeds the pre-ledger URLs once, as 'retired' and never re-read, and leaves what a sitemap or the ledger names alone", () => {
    const ledger = { postings: { [P1]: { state: "live", since: "2026-10-10", first: "2026-10-01" } } };
    const sitemap = `<urlset><url><loc>https://resumebooster.work${P2}</loc></url></urlset>`;
    const P3 = "/jobs/posting/workday/acme~wd1~ext/R3";
    const { ledger: out, added } = seedPostingLedger({ ledger, seedPaths: [P1, P2, P3, `${P3}/`, "/jobs"], sitemaps: [sitemap], idFromPath: postingIdFromPath, today: TODAY });
    expect(added).toBe(1);
    expect(out.postings[P1].state, "the ledger's own entry wins").toBe("live");
    expect(out.postings[P2], "a sitemap path is the carry rule's").toBeUndefined();
    expect(out.postings[P3]).toMatchObject({ state: "retired", seed: true, since: TODAY });
    // Idempotent: a second run seeds nothing more.
    expect(seedPostingLedger({ ledger: out, seedPaths: [P3], idFromPath: postingIdFromPath, today: "2026-10-13" }).added).toBe(0);
  });

  it("carries a seeded page without a board read for its window, then keeps a tombstone instead of dropping it", () => {
    const ledger = { postings: {
      [P1]: { state: "retired", seed: true, since: "2026-10-01" },
      [P2]: { state: "gone", since: "2026-07-01" },
    } };
    const inWindow = postingCarryBase({ ledger, idFromPath: postingIdFromPath, today: TODAY });
    expect(inWindow.stubs.has(P1)).toBe(true);
    expect(inWindow.recheck.has(P1), "a seed is never re-read").toBe(false);
    expect(inWindow.tombstones.has(P2), `a gone page past ${POSTING_STUB_KEEP_DAYS} days is a tombstone, not the homepage`).toBe(true);
    const later = postingCarryBase({ ledger, idFromPath: postingIdFromPath, today: "2027-01-15" });
    expect(later.tombstones.has(P1)).toBe(true);
    expect(later.stubs.has(P1)).toBe(false);
    // A tombstone stays one.
    const t = postingCarryBase({ ledger: { postings: { [P1]: { state: "tombstone", since: "2026-12-01" } } }, idFromPath: postingIdFromPath, today: "2027-06-01" });
    expect(t.tombstones.has(P1)).toBe(true);
  });

  it("a seeded page says nothing was checked, and a page retired at the ceiling says why", () => {
    const seed = postingStubPage({ path: P1, id: "workday:acme~wd1~ext:R1", state: "retired", basis: "seed", title: "Analyst", company: "Acme", windowDays: 30, esc });
    expect(seed.robots).toBe("noindex, follow");
    expect(seed.content).toMatch(/whether it is still open was not checked/);
    expect(seed.content).not.toMatch(/still on the live board/);
    const ceiling = postingStubPage({ path: P1, id: "workday:acme~wd1~ext:R1", state: "retired", basis: "ceiling", ceiling: 500, title: "Analyst", company: "Acme", windowDays: 30, esc });
    expect(ceiling.content).toMatch(/keeps at most 500 posting pages/);
  });

  it("the ceiling split hands back its own lists, so emptying the input keeps every carried page", () => {
    // MEASURED on a live bake, 2026-10-12: the split returned the input array
    // itself when nothing passed the ceiling, the bake emptied that array to
    // refill it, and every one of 506 carried live pages became a stub.
    const list = Array.from({ length: 3 }, (_, i) => ({ d: `2026-10-0${i + 1}` }));
    const split = postingCeilingSplit(list, { ceiling: 500, dateOf: (x: { d: string }) => x.d });
    expect(split.keep).not.toBe(list);
    list.length = 0;
    expect(split.keep.length).toBe(3);
    expect(split.retire).toEqual([]);
  });

  it("a tombstone is under a kilobyte, noindex, and links the board", () => {
    const html = tombstoneHtml({ token: "acme~wd1~ext", esc });
    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(1024);
    expect(html).toMatch(/<meta name="robots" content="noindex, follow">/);
    expect(html).toMatch(/href="\/jobs\?company=acme~wd1~ext"/);
    expect(html).not.toMatch(/rel="canonical"/);
  });

  it("IndexNow never reports a seeded or an unchecked page as a removal", () => {
    const ledger = { builtAt: TODAY, postings: {
      [P1]: { state: "retired", seed: true, since: TODAY },
      [P2]: { state: "unchecked", since: TODAY },
      "/jobs/posting/workday/acme~wd1~ext/R9": { state: "gone", since: TODAY },
    } };
    expect(changedUrls({ sitemapXml: "", ledger })).toEqual(["https://resumebooster.work/jobs/posting/workday/acme~wd1~ext/R9"]);
  });
});

describe("SEO-002: a published company URL this bake did not choose", () => {
  it("collects every published company path: the ledger, the sitemaps and the seed, normalised", () => {
    const paths = onceCompanyPaths({
      ledger: { companies: { "/jobs/company/a": { state: "live" } }, pages: { "/jobs/company/b": {}, "/pricing": {} } },
      sitemaps: ["<urlset><url><loc>https://resumebooster.work/jobs/company/careers.amd.com/</loc></url></urlset>"],
      seedPaths: ["/jobs/company/NBCUniversal3", "/jobs/company/not a token", "/jobs/posting/x/y/z"],
    });
    expect([...paths].sort()).toEqual(["/jobs/company/NBCUniversal3", "/jobs/company/a", "/jobs/company/b", "/jobs/company/careers.amd.com"].sort());
    expect(companyTokenOf("/jobs/company/careers.amd.com/")).toBe("careers.amd.com");
  });

  it("is its old page marked noindex while the board carries it and a young listing is cached, else a stub, then a tombstone", () => {
    expect(companyCarryState({ prior: undefined, today: TODAY, onBoard: true, cachedYoung: true })).toBe("noindex");
    expect(companyCarryState({ prior: undefined, today: TODAY, onBoard: true, cachedYoung: false })).toBe("stub");
    expect(companyCarryState({ prior: undefined, today: TODAY, onBoard: false, cachedYoung: true })).toBe("stub");
    expect(companyCarryState({ prior: { state: "stub", since: "2026-08-01" }, today: TODAY, onBoard: false, cachedYoung: false }), `past ${COMPANY_STUB_KEEP_DAYS} days`).toBe("tombstone");
    expect(companyCarryState({ prior: { state: "stub", since: "2026-10-01" }, today: TODAY, onBoard: false, cachedYoung: false })).toBe("stub");
    expect(companyCarryState({ prior: { state: "tombstone", since: "2026-01-01" }, today: TODAY, onBoard: true, cachedYoung: true })).toBe("tombstone");
  });

  it("a state that holds keeps the day it began, a seed stays marked, and the title is hashed, not stored", () => {
    const first = companyLedgerEntry({ prior: undefined, state: "stub", today: "2026-10-01", token: "acme", name: "Acme", title: "Acme no longer has a page of its own here", seed: true });
    expect(first).toMatchObject({ state: "stub", since: "2026-10-01", first: "2026-10-01", token: "acme", name: "Acme", seed: true });
    expect(first.titleHash).toMatch(/^[0-9a-f]{12}$/);
    const next = companyLedgerEntry({ prior: first, state: "stub", today: TODAY, token: "acme" });
    expect(next.since).toBe("2026-10-01");
    expect(next.seed).toBe(true);
    const back = companyLedgerEntry({ prior: next, state: "live", today: TODAY, token: "acme" });
    expect(back).toMatchObject({ state: "live", since: TODAY, first: "2026-10-01" });
  });

  it("the stub says only that it has no page of its own, never that the employer stopped hiring", () => {
    const p = companyStubPage({ path: "/jobs/company/acme", token: "acme", name: "Acme & Co", esc });
    expect(p.robots).toBe("noindex, follow");
    expect(p.content).toMatch(/Acme &amp; Co no longer has a page of its own here/);
    expect(p.content).toMatch(/href="\/jobs\?company=acme"/);
    expect(p.content).not.toMatch(/stopped hiring|no openings|closed/i);
    expect(p.description).not.toMatch(/&amp;/);
  });
});

describe("SEO-006: names are repaired first and refused narrowly", () => {
  it("takes a career-site label off the end and keeps the employer's name", () => {
    for (const [stored, printed] of [
      ["Chubb External", "Chubb"], ["Cummins All Functions", "Cummins"], ["Mayo Career Site US", "Mayo"],
      ["Big 5 Sporting Goods Opt 1", "Big 5 Sporting Goods"], ["EXL Talent Acquisition Team", "EXL"],
      ["FMOL Health Career Portal", "FMOL Health"], ["Siemens (External)", "Siemens"],
    ]) expect(repairEmployerName(stored).name, stored).toBe(printed);
    expect(repairEmployerName("External").name, "a name that is only a label is left whole").toBe("External");
  });

  it("refuses logo text, a careers subdomain and a bare generic word, and nothing domain-shaped or ending in Global", () => {
    expect(unpublishableNameReason("CMYK-WHT midnight background")).toBe("logo or image text");
    expect(unpublishableNameReason("Logo Horizontal Color")).toBe("logo or image text");
    expect(unpublishableNameReason("careers.cdmsmith.com")).toBe("careers subdomain");
    expect(unpublishableNameReason("All")).toBe("generic word");
    expect(unpublishableNameReason("Only External Postings")).toBe("generic label");
    // The false positives the first draft of the rule had (195 + 72 in the catalogue).
    for (const real of ["Booking.com", "Crypto.com", "Alarm.com", "Checkout.com", "Abt Global", "FGS Global", "Forge Global", "HealthCareersInSask.ca", "Logo Brands", "Black & Veatch", "Banner Health"]) {
      expect(unpublishableNameReason(real), real).toBeNull();
    }
  });

  it("judges a stored label as a whole before repairing it, so a label never becomes a name", () => {
    const parts = { boardName: (_t: string | null, s: string | null) => String(s ?? ""), isCodeShapedName: () => false };
    expect(bakeEmployerName("notexternal", "Only External Postings", parts)).toMatchObject({ name: "Only External Postings", repaired: false, reason: "generic label" });
    expect(bakeEmployerName("chubb~ocs~CX", "Chubb External", parts)).toMatchObject({ name: "Chubb", repaired: true, reason: null });
  });
});

describe("SEO-036: one member of a duplicate group keeps its index", () => {
  const groups = duplicateSkeletonGroups([
    { key: "martinbrower", skeleton: "s1" }, { key: "reyes", skeleton: "s1" },
    { key: "acme-a", skeleton: "s2" }, { key: "acme-b", skeleton: "s2" },
    { key: "solo", skeleton: "s3" },
  ]);
  const names: Record<string, string> = { martinbrower: "Martin Brower", reyes: "Reyes Beverage Group", "acme-a": "Acme", "acme-b": "Acme" };
  const open: Record<string, number> = { martinbrower: 498, reyes: 498, "acme-a": 50, "acme-b": 80 };

  it("finds the groups and leaves a page with its own text out of them", () => {
    expect(groups.map((g) => [...g].sort())).toEqual([["martinbrower", "reyes"], ["acme-a", "acme-b"]]);
  });

  it("keeps the most open roles, canonicalises the same name to it, and gives a different name noindex with no canonical", () => {
    const role = resolveDuplicateGroups({ groups, openOf: (k) => open[k], nameKeyOf: (k) => names[k] });
    expect(role.get("acme-b")).toEqual({ role: "keep" });
    expect(role.get("acme-a")).toEqual({ role: "canonical", to: "acme-b" });
    const kept = ["martinbrower", "reyes"].filter((k) => role.get(k)?.role === "keep");
    expect(kept.length).toBe(1);
    const other = ["martinbrower", "reyes"].find((k) => !kept.includes(k))!;
    expect(role.get(other), "no canonical across two employers' names").toEqual({ role: "noindex" });
  });

  it("keeps every member indexable today (owner decision D7), and none when every member fails the name gate", () => {
    const today = resolveDuplicateGroups({ groups, wasIndexable: (k) => k === "martinbrower" || k === "reyes", openOf: (k) => open[k], nameKeyOf: (k) => names[k] });
    expect(today.get("martinbrower")).toEqual({ role: "keep" });
    expect(today.get("reyes")).toEqual({ role: "keep" });
    const gated = resolveDuplicateGroups({ groups, openOf: (k) => open[k], nameKeyOf: (k) => names[k], failsGate: (k) => k === "acme-a" || k === "acme-b" });
    expect(gated.get("acme-a")).toEqual({ role: "noindex" });
    expect(gated.get("acme-b")).toEqual({ role: "noindex" });
  });
});

describe("SEO-025: a sitemap date moves when what a page says moves, not when a count does", () => {
  const fp = (s: string, path: string) => contentFingerprint(s, { blindCounts: COUNT_BEARING(path) });

  it("a count-bearing page keeps its date when only its counts move; a listed opening changing is a change", () => {
    const path = "/jobs/company/acme";
    const a = fp(`<p>1,234 open roles</p><a href="/jobs/posting/workday/acme~wd1~ext/R1">Analyst</a>`, path);
    const b = fp(`<p>1,301 open roles</p><a href="/jobs/posting/workday/acme~wd1~ext/R1">Analyst</a>`, path);
    const c = fp(`<p>1,301 open roles</p><a href="/jobs/posting/workday/acme~wd1~ext/R7">Analyst</a>`, path);
    expect(a).toBe(b);
    expect(b).not.toBe(c);
    const d = pageDates({ fp: b, legacyFp: "x", prior: { fp: a, fpv: FINGERPRINT_VERSION, lastmod: "2026-10-01", changed: "2026-10-01" }, today: TODAY });
    expect(d.lastmod).toBe("2026-10-01");
    // A guide is not count-bearing: its numbers are what it says.
    expect(COUNT_BEARING("/guides/x")).toBe(false);
    expect(contentFingerprint("58 industries")).not.toBe(contentFingerprint("59 industries"));
  });

  it("switching the fingerprint re-dates nothing: a ledger entry from the old one is compared with the old one", () => {
    const text = "<p>1,234 open roles</p>";
    const legacy = contentFingerprint(text);
    const d = pageDates({ fp: fp(text, "/jobs/field/x"), legacyFp: legacy, prior: { fp: legacy, lastmod: "2026-09-30" }, today: TODAY });
    expect(d.lastmod).toBe("2026-09-30");
    expect(d.fpv).toBe(FINGERPRINT_VERSION);
  });

  it("a guide's date is the later of its stated date and the day its text last changed", () => {
    expect(pageDates({ fp: "new", legacyFp: "new", prior: { fp: "old", fpv: FINGERPRINT_VERSION, lastmod: "2026-07-06", changed: "2026-07-06" }, today: TODAY, stated: "2026-07-06" }).lastmod).toBe(TODAY);
    expect(pageDates({ fp: "same", legacyFp: "same", prior: { fp: "same", fpv: FINGERPRINT_VERSION, lastmod: "2026-07-06", changed: "2026-07-06" }, today: TODAY, stated: "2026-07-06" }).lastmod).toBe("2026-07-06");
    expect(pageDates({ fp: "same", legacyFp: "same", prior: null, today: TODAY, stated: "2026-07-06" }).lastmod, "a guide the ledger never saw takes its stated date").toBe("2026-07-06");
    expect(pageDates({ fp: "x", legacyFp: "x", prior: null, today: TODAY, stated: "2027-01-01" }).lastmod, "never later than today").toBe(TODAY);
  });

  it("the bake dates every page through pageDates and writes the version into the ledger", () => {
    const bake = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(bake).toMatch(/pageDates\(\{ fp: fp\.fp, legacyFp: fp\.legacyFp, prior: priorPages\[path\], today: TODAY, stated: fp\.stated \}\)/);
    expect(bake).toMatch(/\{ fp: d\.fp, fpv: d\.fpv, lastmod: d\.lastmod, changed: d\.changed \}/);
  });
});
