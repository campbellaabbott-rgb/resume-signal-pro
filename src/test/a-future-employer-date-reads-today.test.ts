/**
 * A FUTURE EMPLOYER DATE READS TODAY (job-listings audit JL7).
 *
 * An APAC tenant's date-only stamp is a future UTC midnight for the western
 * half of the world, and the posting page printed it raw ("Posted 2026-10-13"
 * on 12 October) while the card computed a negative age and printed nothing.
 * Every listing surface now clamps through posting-page.ts's
 * postingDatePosted — the same clamp the JobPosting markup uses — so the
 * card says "posted today", the facts say today's date, and no surface ever
 * prints a day that has not happened.
 */
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { listingAge } from "@/lib/listing/age";
import { date as fmtDate } from "@/lib/format";
import { cardAgeText, postedFactText } from "@/components/jobs/listing/listing-text";
import { postingDatePosted } from "@/components/jobs/posting-page";

const NOW = new Date("2026-10-12T03:00:00Z");
const t = i18n.t.bind(i18n);

describe("a date after today is today", () => {
  it("clamps a future date-only stamp to today, with an age of zero", () => {
    expect(listingAge({ id: "workday:acme~wd3~AU:R1", postedAt: "2026-10-13" }, NOW)).toEqual({ kind: "dated", days: 0, day: "2026-10-12" });
    expect(listingAge({ id: "workday:acme~wd3~AU:R1", postedAt: "2026-10-13T00:00:00+11:00" }, NOW)).toEqual({ kind: "dated", days: 0, day: "2026-10-12" });
  });

  it("is the same clamp the structured data uses", () => {
    const a = listingAge({ id: "greenhouse:acme:1", postedAt: "2026-11-30" }, NOW);
    expect(a.kind === "dated" && a.day).toBe(postingDatePosted("2026-11-30", NOW));
  });

  it("the card says 'posted today' and the facts print today's date", () => {
    const job = { id: "workday:acme~wd3~AU:R1", source: "workday", postedAt: "2026-10-13" };
    expect(cardAgeText(t, job, NOW)).toBe("posted today");
    expect(postedFactText(t, job, "en", NOW)).toBe(`${fmtDate("2026-10-12", { lng: "en" })}, as the employer's system states it`);
    expect(postedFactText(t, job, "en", NOW)).not.toMatch(/\b13\b/);
  });

  it("a past date still counts whole calendar days", () => {
    const job = { id: "greenhouse:acme:1", source: "greenhouse", postedAt: "2026-10-09T22:15:00Z" };
    expect(listingAge(job, NOW)).toEqual({ kind: "dated", days: 3, day: "2026-10-09" });
    expect(cardAgeText(t, job, NOW)).toBe("posted 3 days ago");
    expect(cardAgeText(t, { ...job, postedAt: "2026-10-11" }, NOW)).toBe("posted 1 day ago");
  });

  it("a stamp that is not a date is no date (never 'posted NaN days ago')", () => {
    for (const postedAt of [null, "", "soon", "13/10/2026"]) {
      expect(listingAge({ id: "greenhouse:acme:1", postedAt }, NOW)).toEqual({ kind: "undated" });
      expect(cardAgeText(t, { id: "greenhouse:acme:1", postedAt }, NOW)).toBeNull();
    }
  });

  it("prints the day as a calendar day in the reader's language, never shifted by a time zone", () => {
    // Since pass B the facts print through the site's one formatter
    // (src/lib/format.ts), which reads every English page day, month, year.
    // The employer's own day, written with a western offset late in the day,
    // stays that day: it is a calendar day, read in no time zone.
    const late = { id: "greenhouse:acme:1", source: "greenhouse", postedAt: "2026-10-11T23:59:00-08:00" };
    expect(postedFactText(t, late, "en", NOW)).toBe("11 Oct 2026, as the employer's system states it");
    expect(fmtDate("2026-10-12", { lng: "en" })).toBe("12 Oct 2026");
    expect(fmtDate("2026-10-12", { lng: "en-GB" })).toBe("12 Oct 2026");
    expect(fmtDate("2026-10-12", { lng: "de" })).toMatch(/12\. Okt\. 2026/);
  });
});
