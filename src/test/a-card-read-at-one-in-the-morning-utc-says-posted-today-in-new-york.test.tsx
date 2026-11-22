// @vitest-environment jsdom
/**
 * A CARD READ AT ONE IN THE MORNING UTC SAYS "POSTED TODAY" IN NEW YORK (NB-22).
 *
 * WHAT WAS WRONG. listingAge can count a posting's age in the reader's own
 * calendar day when it is given the reader's time zone, and a guard pinned
 * that. No caller gave it one. The card, the pane's Posted row and the pane's
 * own age all counted whole UTC days, so a posting made at 18:30 in New York
 * (23:30Z) and read there at 20:00 the same evening (01:00Z the next UTC day)
 * said "posted 1 day ago" inside the board's own "Today" filter. The rule
 * existed, its test passed, and nothing on screen used it.
 *
 * WHAT HOLDS NOW, with the card itself rendered for a reader in New York:
 *   - that posting says "posted today", and the facts row prints the 14th;
 *   - the count does not flip the other way: a posting from 02:00Z, which is
 *     the evening before in New York, is one day old there;
 *   - a caller that names no zone at all (null) still gets the UTC count.
 * The zone is the runtime's, set for this file, so the path under test is the
 * card's own (cardAgeText reading the reader's zone), not a zone passed in.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import enListing from "@/i18n/shards/listing/en.json";
import { JobCard, type CardContext } from "@/components/jobs/listing/JobCard";
import { PostingFacts } from "@/components/jobs/listing/PostingFacts";
import { cardAgeText, postedFactText } from "@/components/jobs/listing/listing-text";
import { readerTimeZone } from "@/lib/listing/age";
import { setLanderManifestForTests } from "@/lib/seo/lander-manifest";
import type { ListingJob } from "@/lib/listing/types";

/** 20:00 on Saturday 14 November 2026 in New York: 01:00 on the 15th in UTC. */
const NOW = new Date("2026-11-15T01:00:00Z");
const BOARD: CardContext = { surface: "board", density: "comfortable", hideEmployer: false, selected: false };
const t = i18n.t.bind(i18n);

const job = (postedAt: string): ListingJob => ({
  id: "greenhouse:acme:4012345",
  title: "Staff Accountant",
  company: "Acme",
  token: "acme",
  source: "greenhouse",
  location: "New York, NY",
  country: "US",
  workMode: "hybrid",
  employmentType: "full_time",
  department: "Finance",
  postedAt,
  recheckedAt: "2026-11-15T00:40:00Z",
  missingSince: null,
  applyUrl: "https://boards.greenhouse.io/acme/jobs/4012345",
  salary: null,
  agency: false,
} as ListingJob);

const card = (postedAt: string, now: Date = NOW) => {
  render(<MemoryRouter><ul><JobCard job={job(postedAt)} ctx={BOARD} href="/jobs?job=greenhouse%3Aacme%3A4012345" now={now} /></ul></MemoryRouter>);
  return document.body.textContent ?? "";
};

const ownZone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/New_York";
  i18n.addResourceBundle("en", "translation", enListing, true, true);
  (globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});
afterAll(() => { if (ownZone === undefined) delete process.env.TZ; else process.env.TZ = ownZone; });
beforeEach(() => { setLanderManifestForTests("*"); });
afterEach(() => { cleanup(); setLanderManifestForTests(null); });

describe("a reader in New York, at 20:00 on the 14th", () => {
  it("the reader this file renders for is in New York", () => {
    expect(readerTimeZone()).toBe("America/New_York");
    expect(NOW.getHours()).toBe(20);
  });

  it("a posting made at 18:30 that evening says posted today on its card", () => {
    const text = card("2026-11-14T23:30:00Z");
    expect(text).toContain("posted today");
    expect(text, "the card counted UTC days for a reader whose day it still is").not.toContain("posted 1 day ago");
  });

  it("and its facts row prints the 14th, the day the card counts from", () => {
    render(<MemoryRouter><PostingFacts job={job("2026-11-14T23:30:00Z")} now={NOW} /></MemoryRouter>);
    const posted = document.querySelector('[data-fact="posted"]')?.textContent ?? "";
    expect(posted).toBe("14 Nov 2026, as the employer's system states it");
  });

  it("the count does not flip the other way: 02:00Z is the evening before in New York, though it is the UTC today", () => {
    // Read at 18:30 on the 14th in New York (23:30Z, still the 14th in UTC):
    // 02:00Z on the 14th was 21:00 on the 13th there, the reader's yesterday.
    const text = card("2026-11-14T02:00:00Z", new Date("2026-11-14T23:30:00Z"));
    expect(text).toContain("posted 1 day ago");
    expect(text).not.toContain("posted today");
  });

  it("a date-only stamp stays the employer's calendar day", () => {
    expect(card("2026-11-12")).toContain("posted 2 days ago");
  });

  it("control: a caller that names no zone still gets the UTC count", () => {
    const j = job("2026-11-14T23:30:00Z");
    expect(cardAgeText(t, j, NOW, null)).toBe("posted 1 day ago");
    expect(cardAgeText(t, j, NOW, "Asia/Tokyo")).toBe("posted today"); // 08:30 on the 15th there, read at 10:00
    expect(postedFactText(t, j, "en", NOW, "Asia/Tokyo")).toBe("15 Nov 2026, as the employer's system states it");
  });
});
