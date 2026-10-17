// @vitest-environment jsdom
/**
 * A RE-DATED FEED SHOWS NO POSTING AGE (job-listings audit JL2).
 *
 * Breezy, Paylocity and UKG rewrite a posting's feed date when it is edited:
 * 7 of 127 sampled cards from those systems read up to 248 days younger than
 * the posting. A card from one of them prints no "posted N days ago"; the
 * facts print the FEED date with the hedge naming the system; every other
 * system's stated date is printed as an age, as before. The positive control
 * is the same row with a different source.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import enListing from "@/i18n/shards/listing/en.json";
import { JobCard } from "@/components/jobs/listing/JobCard";
import { PostingFacts } from "@/components/jobs/listing/PostingFacts";
import { REDATING_SOURCES, isRedatingSource, listingAge } from "@/lib/listing/age";
import type { ListingJob } from "@/lib/listing/types";
import { date as fmtDate } from "@/lib/format";
// Dates as the site's one formatter prints them for English readers (src/lib/format.ts: day, month, year), so the guard keeps its "reader's language" claim without pinning one calendar style.
const D = (day: string) => fmtDate(day, { lng: "en" });


const NOW = new Date("2026-10-12T12:00:00Z");
const row = (source: string): ListingJob => ({
  id: `${source}:acme:R1`, source, title: "Warehouse Associate", company: "Acme", token: "acme",
  location: "Reno, NV", postedAt: "2026-10-09", recheckedAt: "2026-10-12T11:00:00Z", applyUrl: "https://example.com/apply",
});
const card = (j: ListingJob) => render(
  <MemoryRouter><ul><JobCard job={j} ctx={{ surface: "board", density: "comfortable", hideEmployer: false, selected: false }} href="/x" now={NOW} /></ul></MemoryRouter>,
);
const facts = (j: ListingJob) => render(<MemoryRouter><PostingFacts job={j} now={NOW} /></MemoryRouter>);

beforeAll(() => { i18n.addResourceBundle("en", "translation", enListing, true, true); });
afterEach(cleanup);

describe("the measured re-daters", () => {
  it("are exactly Breezy, Paylocity and UKG, matched on the source or the id", () => {
    expect([...REDATING_SOURCES].sort()).toEqual(["breezy", "paylocity", "ukg"]);
    expect(isRedatingSource("Breezy ")).toBe(true);
    expect(isRedatingSource("greenhouse")).toBe(false);
    expect(listingAge({ id: "ukg:acme:R1", source: null, postedAt: "2026-10-09" }, NOW)).toEqual({ kind: "redated", day: "2026-10-09" });
  });
});

for (const source of ["breezy", "paylocity", "ukg"]) {
  describe(`${source}`, () => {
    it("the card prints no posting age", () => {
      card(row(source));
      expect(document.body.textContent).not.toMatch(/posted|days? ago/i);
      expect(document.querySelector("[data-card-age]")).toBeNull();
    });
    it("the facts print the feed date and the hedge naming the system", () => {
      facts(row(source));
      const posted = document.querySelector("[data-fact='posted']")?.textContent ?? "";
      expect(posted).toMatch(new RegExp(`^Feed date ${D("2026-10-09")}; .+ can move this date when a posting is edited, so it may be older$`));
      expect(posted).toMatch(source === "ukg" ? /UKG Pro Recruiting/ : source === "breezy" ? /Breezy/ : /Paylocity/);
    });
  });
}

describe("positive control: a system that does not move its date", () => {
  it("the same row from Greenhouse prints its age on the card and its date in the facts", () => {
    card(row("greenhouse"));
    expect(screen.getByText("posted 3 days ago")).toBeTruthy();
    cleanup();
    facts(row("greenhouse"));
    expect(document.querySelector("[data-fact='posted']")?.textContent).toBe(`${D("2026-10-09")}, as the employer's system states it`);
  });
  it("an undated row says its system states no date, and prints no first-seen", () => {
    facts({ ...row("greenhouse"), postedAt: null });
    expect(document.querySelector("[data-fact='posted']")?.textContent).toBe("The employer's system states no posting date");
    expect(document.body.textContent).not.toMatch(/first seen/i);
  });
});
