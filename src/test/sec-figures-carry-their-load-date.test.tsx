/**
 * SEC FIGURES CARRY THEIR LOAD DATE (audit CP19, plan D11).
 *
 * The SEC card said nothing about when its figures were loaded, left an
 * empty 40px band where a missing revenue would be, kept its bar values in
 * title tooltips a phone cannot reach, labelled the axis "23 24 25", and
 * hand-built "$14.5B" in every language. Held here: "figures loaded <date>"
 * from the row's loaded_at, else the measured load day 2026-07-23 (pinned);
 * the revenue block collapses for a year with none; bars read "FY'25" with
 * the value printed beside each and the same figures in a table for screen
 * readers; money in the reader's language.
 */
import { afterAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "i18next";
import { PublicCompanyCardView, SEC_FIGURES_LOADED_ON, financialsLoadedOn, readFinancials } from "@/components/jobs/PublicCompanyCard";
import { loadCompanyShard } from "./helpers/company-shard";
import { date as fmtDate } from "@/lib/format";
// Dates as the site's one formatter prints them for English readers (src/lib/format.ts: day, month, year), so the guard keeps its "reader's language" claim without pinning one calendar style.
const D = (day: string) => fmtDate(day, { lng: "en" });


afterAll(async () => { await i18n.changeLanguage("en"); });

const BX = {
  ticker: "BX", exchange: "NYSE", sec_name: "Blackstone Inc.", cik: 1393818, currency: "USD",
  series: [
    { fy: 2025, revenue: 14_450_000_000, net_income: 2_780_000_000 },
    { fy: 2024, revenue: 13_230_000_000, net_income: 2_780_000_000 },
    { fy: 2023, revenue: 8_020_000_000, net_income: 1_390_000_000 },
  ],
};

describe("the load date", () => {
  it("is the plan's measured day when the row carries none, and the row's own stamp when it does", () => {
    expect(SEC_FIGURES_LOADED_ON).toBe("2026-07-23");
    expect(financialsLoadedOn({ loaded_at: null })).toBe("2026-07-23");
    expect(financialsLoadedOn({ loaded_at: "2026-10-01T04:00:00Z" })).toBe("2026-10-01");
    expect(financialsLoadedOn({ loaded_at: "not a date" })).toBe("2026-07-23");
  });

  it("is printed on the card, in the reader's language", () => {
    const { container } = render(<PublicCompanyCardView fin={readFinancials(BX)} />);
    expect(container.textContent).toContain(`Figures loaded ${D("2026-07-23")}.`);
    expect(container.querySelector("[data-sec-loaded]")?.getAttribute("data-sec-loaded")).toBe("2026-07-23");
  });
});

describe("the figures", () => {
  it("label each bar FY'yy with its value visible, and hold the same figures in a table", () => {
    const { container } = render(<PublicCompanyCardView fin={readFinancials(BX)} />);
    const bars = container.querySelector<HTMLElement>("[data-sec-bars]")!;
    expect(bars.textContent).toBe("FY'23$8BFY'24$13.2BFY'25$14.5B");
    expect(bars.getAttribute("aria-hidden")).toBe("true");
    const table = container.querySelector("table")!;
    expect(table.className).toContain("sr-only");
    expect(table.querySelector("caption")?.textContent).toBe("Revenue by fiscal year");
    expect(Array.from(table.querySelectorAll("tbody tr")).map((r) => r.textContent)).toEqual(["FY'23$8B", "FY'24$13.2B", "FY'25$14.5B"]);
    expect(container.querySelector("[title]")).toBeNull();
    expect(container.querySelector(".text-2xl")?.textContent).toBe("$14.5B");
  });

  it("a year with no revenue collapses its block instead of leaving a band", () => {
    const fin = readFinancials({ ...BX, series: [{ fy: 2026, revenue: null, net_income: 120_100_000_000 }] });
    const { container } = render(<PublicCompanyCardView fin={fin} />);
    expect(container.textContent).not.toMatch(/FY2026 revenue/);
    expect(container.querySelector(".text-2xl")).toBeNull();
    expect(container.textContent).toContain("Profitable — net income $120.1B (FY2026)");
    expect(container.querySelector("[data-sec-bars]")).toBeNull();
  });

  it("money is formatted in the reader's language, not hand-built", async () => {
    loadCompanyShard(["de"]);
    await i18n.changeLanguage("de");
    const { container } = render(<PublicCompanyCardView fin={readFinancials(BX)} />);
    expect(container.textContent).toMatch(/14,5\s?Mrd\.\s?\$/);
    expect(container.textContent).toContain("Zahlen geladen am 23. Juli 2026.");
    await i18n.changeLanguage("en");
  });

  it("no row, or a row with no year, renders nothing", () => {
    expect(readFinancials(null)).toBeNull();
    expect(readFinancials({ ticker: "BX", series: [] })).toBeNull();
    expect(render(<PublicCompanyCardView fin={null} />).container).toBeEmptyDOMElement();
  });
});
