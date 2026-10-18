/**
 * THE COMPARISONS NAME THE TRADER THE RECEIPTS NAME (plan CP-G, review note
 * "the en-GB locale names the trader 'CV Booster'"; wave 4 round 2,
 * account-compliance).
 *
 * WHAT WAS WRONG. The homepage comparison's heading and the value
 * comparison's column read the brand from the locale, and the en-GB locale
 * said "CV Booster", a name no receipt, notice, Terms or Privacy page carries:
 * a British visitor was sold by one name and billed by another.
 *
 * WHAT HOLDS NOW. The trading name is one constant (TRADING_NAME in
 * src/config/seller.ts), never translated: the comparison heading reads a new
 * key that interpolates it, and both columns print it. Proven with en-GB
 * resources that still say "CV Booster" under the old keys: the page shows
 * the trading name and never the other one. Existing locale values are not
 * edited (the translator adds the new key's nine locales).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { TRADING_NAME } from "@/config/seller";
import { ComparisonTable } from "@/components/ComparisonTable";
import { ValueComparison } from "@/components/ValueComparison";

const before = i18n.language;
beforeAll(async () => {
  i18n.addResourceBundle("en-GB", "translation", {
    comparison: { title: "Why CV Booster?" },
    valueComparison: { us: "CV Booster" },
  }, true, false);
  await i18n.changeLanguage("en-GB");
});
afterEach(() => cleanup());
afterAll(async () => { await i18n.changeLanguage(before); });

describe("one trading name in every locale", () => {
  it("is Resume Booster", () => {
    expect(TRADING_NAME).toBe("Resume Booster");
  });

  it("the homepage comparison's heading and column name it, never the en-GB brand", () => {
    render(<MemoryRouter><ComparisonTable /></MemoryRouter>);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/CV Booster/);
    expect(document.querySelector("h2")?.textContent).toBe(`Why ${TRADING_NAME}?`);
  });

  it("the value comparison's column names it, never the en-GB brand", () => {
    render(<MemoryRouter><ValueComparison /></MemoryRouter>);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/CV Booster/);
    expect(text).toContain(TRADING_NAME);
  });
});
