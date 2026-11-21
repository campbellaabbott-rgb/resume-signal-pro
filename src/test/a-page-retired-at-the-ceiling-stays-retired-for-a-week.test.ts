// @vitest-environment node
/**
 * A PAGE RETIRED AT THE CEILING STAYS RETIRED FOR A WEEK (SEO audit
 * 2026-11-18, CRAWL18B-2).
 *
 * postingCarryBase put every retired ledger entry back on the re-read list,
 * so a page retired at the 500-page ceiling or to make room for new pages
 * (its end date was days away) was read again at the next bake and, where it
 * fit, served again: five pages went index, noindex, index within two days.
 * Insulet REQ-2026-18592 was retired as expiring on 2026-11-19 and re-read at
 * the next bake. A page retired as expiring now stays retired, unread, for
 * four days; one retired at the ceiling for seven while the previous
 * publish's live set is at or above ceiling minus reserve. Each entry records
 * the day it last went from a served page to a retired one (lastRetired).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as pages from "../../scripts/prerender-pages.mjs";
import { postingIdFromPath } from "@/components/jobs/posting-page";

type Entry = Record<string, unknown>;
const P = pages as unknown as {
  postingCarryBase: (o: Record<string, unknown>) => { recheck: Map<string, string>; stubs: Map<string, Entry>; held?: number };
  keptPostingStub: (path: string, e: Entry, idFromPath: (p: string) => string | null) => Entry;
  postingStubEntry: (o: Record<string, unknown>) => Entry;
  withRetiredMark?: (entry: Entry, prior: Entry) => Entry;
};

const INSULET = "/jobs/posting/workday/insulet~wd5~insuletcareers/REQ-2026-18592";
const INSULET_ENTRY = { state: "retired", since: "2026-11-19", first: "2026-10-11", title: "Supplier Engineer (Onsite - Acton)", company: "Insulet", token: "insulet~wd5~insuletcareers", basis: "expiring" };
const LIVE = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`/jobs/posting/greenhouse/acme/${1000 + i}`, { state: "live", since: "2026-11-19", first: "2026-11-01", title: "Analyst", company: "Acme", token: "acme" }]));
const base = (postings: Record<string, Entry>, today: string) => P.postingCarryBase({ ledger: { postings }, sitemaps: [], idFromPath: postingIdFromPath, today, ceiling: 500, reserve: 100 });
const stubEntry = (path: string, e: Entry, today: string) => P.postingStubEntry({
  stub: P.keptPostingStub(path, e, postingIdFromPath), prior: e, today, employerName: (_t: unknown, n: unknown) => n, tokenOf: () => null,
});

describe("Insulet REQ-2026-18592, retired as expiring on 2026-11-19", () => {
  it("is not read again at the next bake: it stays retired, with its reason and its day", () => {
    const b = base({ ...LIVE(497), [INSULET]: INSULET_ENTRY }, "2026-11-20");
    expect(b.recheck.has(INSULET)).toBe(false);
    expect(b.stubs.has(INSULET)).toBe(true);
    expect(b.held).toBe(1);
    const e = stubEntry(INSULET, b.stubs.get(INSULET)!, "2026-11-20");
    expect(e).toMatchObject({ state: "retired", since: "2026-11-19", basis: "expiring", lastRetired: "2026-11-19" });
  });

  it("is read again four days on, by when the end it was retired for has passed", () => {
    for (const day of ["2026-11-21", "2026-11-22"]) expect(base({ ...LIVE(497), [INSULET]: INSULET_ENTRY }, day).recheck.has(INSULET), day).toBe(false);
    expect(base({ ...LIVE(497), [INSULET]: INSULET_ENTRY }, "2026-11-23").recheck.has(INSULET)).toBe(true);
  });
});

describe("a page retired at the ceiling", () => {
  const CEILING = { ...INSULET_ENTRY, basis: "ceiling", since: "2026-11-21", lastRetired: "2026-11-21" };

  it("stays retired for seven days while the live set leaves no room", () => {
    for (const day of ["2026-11-22", "2026-11-27"]) {
      const b = base({ ...LIVE(429), [INSULET]: CEILING }, day);
      expect(b.recheck.has(INSULET), day).toBe(false);
      expect(b.stubs.has(INSULET), day).toBe(true);
    }
    expect(base({ ...LIVE(429), [INSULET]: CEILING }, "2026-11-28").recheck.has(INSULET)).toBe(true);
  });

  it("competes again at once when the previous publish served fewer than ceiling minus reserve", () => {
    expect(base({ ...LIVE(399), [INSULET]: CEILING }, "2026-11-22").recheck.has(INSULET)).toBe(true);
  });

  it("a page retired for any other reason is re-read as before, and so is every page without the ceiling given", () => {
    for (const basis of ["duplicate", null]) expect(base({ ...LIVE(497), [INSULET]: { ...CEILING, basis } }, "2026-11-22").recheck.has(INSULET), String(basis)).toBe(true);
    expect(P.postingCarryBase({ ledger: { postings: { ...LIVE(497), [INSULET]: CEILING } }, sitemaps: [], idFromPath: postingIdFromPath, today: "2026-11-22" }).recheck.has(INSULET)).toBe(true);
  });
});

describe("lastRetired in the ledger", () => {
  it("is the bake's day when a served page is retired, and rides on the page when it is served again", () => {
    const prior = { state: "live", since: "2026-11-18", first: "2026-10-11", title: "Supplier Engineer", company: "Insulet", token: "insulet~wd5~insuletcareers" };
    const retired = P.postingStubEntry({ stub: { id: postingIdFromPath(INSULET), path: INSULET, state: "retired", basis: "ceiling", title: "Supplier Engineer", company: "Insulet" }, prior, today: "2026-11-21", employerName: (_t: unknown, n: unknown) => n, tokenOf: () => null });
    expect(retired).toMatchObject({ state: "retired", since: "2026-11-21", basis: "ceiling", lastRetired: "2026-11-21", lastRetiredBasis: "ceiling" });
    expect(typeof P.withRetiredMark).toBe("function");
    const back = P.withRetiredMark!({ state: "live", since: "2026-11-28" }, retired);
    expect(back).toMatchObject({ state: "live", lastRetired: "2026-11-21", lastRetiredBasis: "ceiling" });
  });

  it("the bake hands the carry its ceiling and reserve, and marks the live entries", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    const call = src.slice(src.indexOf("const carryBase = postingCarryBase({"), src.indexOf("const priorPostingOf ="));
    expect(call).toMatch(/ceiling: POSTING_PAGE_CEILING,\s*reserve: POSTING_FRESH_RESERVE,/);
    expect(src).toMatch(/postingLedger\[path\] = withRetiredMark\(\{ state: "live",[^\n]*\}, priorPostingOf\(path\)\);/);
  });
});
