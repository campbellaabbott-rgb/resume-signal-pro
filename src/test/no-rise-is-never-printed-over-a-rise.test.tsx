/**
 * "NO RISE" IS NEVER PRINTED OVER A RISE (audit CP9, CP8).
 *
 * Samsara read "No rise in roles served on this board between Oct 4 (69) and
 * Oct 11 (72)"; Anduril "860 → 874". The verdict 'no-growth' means "under the
 * bar" (25% and four roles), not "no rise", and the counts were rows served on
 * our daily read, a different population from the open-roles figure printed
 * under them. Held here: under the bar the line reads "Not a rise of 25% or
 * more: 69 on Oct 4, 72 on Oct 11", a rise over the bar reads "A rise of N%",
 * both say what they count, and no English or locale value says "no rise".
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { HiringRecordCard, type HiringRecordInput } from "@/components/jobs/company/HiringRecordCard";
import { COMPANY_SHARD_LOCALES, companyShard } from "./helpers/company-shard";
import { date as fmtDate } from "@/lib/format";
// Dates as the site's one formatter prints them for English readers (src/lib/format.ts: day, month, year), so the guard keeps its "reader's language" claim without pinning one calendar style.
const D = (day: string) => fmtDate(day, { lng: "en" });


const BARS = { growthMinRatePct: 25, growthWindowDays: 7, closedWindowDays: 90, shareDays: 14, supportDays: 30 };
const rec = (verdict: "grew" | "no-growth", base: number, latest: number, rate: number): HiringRecordInput => ({
  curve: { open_roles: 72, filled_roles_90d: 0, relisted_roles_90d: 0, tracking_days: 40, observability_bucket: "full_read", sufficient: false, dated_coverage: 0.5 },
  gated: { verdict: "unknown", withheld: null }, actively: verdict === "grew" ? "positive" : "unknown", admitted: verdict === "grew" ? "grew" : null,
  relistCaution: false,
  growth: { verdict, row: { baseline_day: "2026-10-04", baseline_served: base, latest_day: "2026-10-11", latest_served: latest, rate }, why: null },
  bars: BARS,
});
const growthLine = (c: HTMLElement) => c.querySelector("[data-record='growth']")?.textContent ?? "";

describe("the growth line under the bar", () => {
  it("names the bar it did not reach and both counts, and says what it counts", () => {
    const { container } = render(<HiringRecordCard input={rec("no-growth", 69, 72, 0.0435)} />);
    const line = growthLine(container);
    expect(line).toContain(`Not a rise of 25% or more: 69 on ${D("2026-10-04")}, 72 on ${D("2026-10-11")}.`);
    expect(line).toContain("Rows served on this board in our own daily snapshot, counted differently from open roles.");
    expect(container.textContent).not.toMatch(/\bno rise\b/i);
  });

  it("a fall under the bar is printed the same way, never as shrinking", () => {
    const { container } = render(<HiringRecordCard input={rec("no-growth", 263, 211, -0.198)} />);
    expect(growthLine(container)).toContain(`Not a rise of 25% or more: 263 on ${D("2026-10-04")}, 211 on ${D("2026-10-11")}.`);
    expect(container.textContent).not.toMatch(/shrink|fell|decline/i);
  });

  it("over the bar it is 'A rise of N%', with the same label", () => {
    const { container } = render(<HiringRecordCard input={rec("grew", 100, 130, 0.3)} />);
    expect(growthLine(container)).toContain(`A rise of 30% in rows served: 100 on ${D("2026-10-04")}, 130 on ${D("2026-10-11")}.`);
    expect(growthLine(container)).toContain("counted differently from open roles");
    expect(container.querySelector("[data-record-lead]")?.textContent).toBe(`Its board served 30% more roles on ${D("2026-10-11")} than on ${D("2026-10-04")}.`);
  });
});

describe("every locale", () => {
  it("states the bar in the under-the-bar line and labels the counts, in all nine", () => {
    const NO_RISE = /\bno rise\b|kein Anstieg in|ningún aumento|aucune hausse|geen stijging in|nenhuma subida|walang pagtaas/i;
    for (const l of COMPANY_SHARD_LOCALES) {
      const rec = (companyShard(l) as { companyProfile: { record: Record<string, string> } }).companyProfile.record;
      expect(rec.growthNone, `${l} growthNone`).toContain("{{minRate}}");
      expect(rec.growthNone, `${l} growthNone`).toMatch(/\{\{a\}\}[\s\S]*\{\{b\}\}|\{\{b\}\}[\s\S]*\{\{a\}\}/);
      expect(rec.growthNone, `${l} growthNone reads as no rise`).not.toMatch(NO_RISE);
      expect(rec.growthLabel.length, `${l} growthLabel`).toBeGreaterThan(10);
    }
  });
});
