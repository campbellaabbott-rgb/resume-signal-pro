import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import de from "@/i18n/locales/de.json";
import hi from "@/i18n/locales/hi.json";
import { ago, count, date, dateTime, isoAttr, money, percent, period } from "./format";

beforeAll(() => {
  // English ships in the bundle; the other locales load lazily in the app.
  i18n.addResourceBundle("de", "translation", de, true, true);
  i18n.addResourceBundle("hi", "translation", hi, true, true);
});

describe("count", () => {
  it("separates thousands in the reader's language", () => {
    expect(count(1653, { lng: "en" })).toBe("1,653");
    expect(count(1943, { lng: "de" })).toBe("1.943");
    expect(count(19936, { lng: "hi" })).toBe("19,936");
  });

  it("a floor reads as a floor", () => {
    expect(count(10000, { lng: "en", floor: true })).toBe("10,000+");
    expect(count(10000, { lng: "de", floor: true })).toBe("10.000+");
  });

  it("never prints NaN or a fraction of a role", () => {
    expect(count(Number.NaN)).toBe("");
    expect(count(null)).toBe("");
    expect(count(12.6, { lng: "en" })).toBe("13");
  });

  it("defaults to the interface language", async () => {
    await i18n.changeLanguage("de");
    try {
      expect(count(5280)).toBe("5.280");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("money", () => {
  it("compacts a headline figure in the reader's language", () => {
    expect(money(14.5e9, "USD", { compact: true, lng: "en" })).toBe("$14.5B");
    expect(money(14.5e9, "USD", { compact: true, lng: "de" }).replace(/ /g, " ")).toBe("14,5 Mrd. $");
  });

  it("keeps cents only when the figure has them", () => {
    expect(money(29.92, "USD", { lng: "en" })).toBe("$29.92");
    expect(money(33114, "USD", { lng: "en" })).toBe("$33,114");
    expect(money(1200, "GBP", { lng: "en-GB" })).toBe("£1,200");
  });

  it("an unknown currency code falls back rather than throwing", () => {
    expect(money(100, "not-a-code", { lng: "en" })).toBe("$100");
    expect(money(Number.NaN, "USD")).toBe("");
  });
});

describe("dates", () => {
  it("English reads day, month, year", () => {
    expect(date("2026-10-12", { lng: "en" })).toBe("12 Oct 2026");
    expect(date("2026-10-12", { lng: "en-GB" })).toBe("12 Oct 2026");
  });

  it("a calendar day is that day in every time zone", () => {
    // 2026-10-09 parsed as UTC midnight would print 8 Oct west of Greenwich.
    expect(date("2026-10-09", { lng: "en" })).toBe("9 Oct 2026");
  });

  it("German uses its own month and order", () => {
    expect(date("2026-10-12", { lng: "de" })).toBe("12. Okt. 2026");
  });

  it("dateTime carries a time and no seconds", () => {
    const s = dateTime("2026-10-12T14:05:41Z", { lng: "en" });
    expect(s).toMatch(/2026/);
    expect(s).not.toMatch(/:41/);
  });

  it("an empty or broken value prints nothing", () => {
    expect(date(null)).toBe("");
    expect(date("not a date")).toBe("");
    expect(isoAttr("2026-10-09")).toBe("2026-10-09");
    expect(isoAttr(undefined)).toBeUndefined();
  });
});

describe("ago", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  const minus = (m: number) => new Date(now - m * 60_000).toISOString();

  it("minutes, then hours and minutes, then days", () => {
    expect(ago(minus(46), { now, lng: "en" })).toBe("46 min ago");
    expect(ago(minus(212), { now, lng: "en" })).toMatch(/^3 hr,? 32 min ago$/);
    expect(ago(minus(180), { now, lng: "en" })).toBe("3 hr ago");
    expect(ago(minus(3 * 24 * 60 + 5), { now, lng: "en" })).toBe("3 days ago");
  });

  it("212 minutes is never printed as 212 min", () => {
    expect(ago(minus(212), { now, lng: "en" })).not.toMatch(/212/);
  });

  it("word order is the language's own", () => {
    expect(ago(minus(46), { now, lng: "de" })).toMatch(/^vor 46 Min\.$/);
    expect(ago(minus(46), { now, lng: "hi" })).toMatch(/पहले$/);
  });

  it("a future time or a fresh one reads just now, never a negative age", () => {
    expect(ago(new Date(now + 3_600_000).toISOString(), { now, lng: "en" })).toBe("just now");
    expect(ago(minus(0), { now, lng: "en" })).toBe("just now");
  });
});

describe("period and percent", () => {
  it("names the pay period in the reader's language", () => {
    expect(period("hour", { lng: "en" })).toBe("/hr");
    expect(period("year", { lng: "en" })).toBe("/yr");
    expect(period("month", { lng: "en" })).toBe("/mo");
    expect(period("year", { lng: "de" })).toBe("/Jahr");
  });

  it("prints a share as a percentage", () => {
    expect(percent(0.235, { lng: "en" })).toBe("24%");
    expect(percent(0.235, { lng: "en", digits: 1 })).toBe("23.5%");
    expect(percent(undefined)).toBe("");
  });
});
