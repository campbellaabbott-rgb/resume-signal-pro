/**
 * THE HOMEPAGE COMPARISON PROMISES NO UNLIMITED RETRIES (S13-026).
 *
 * The "Why choose" table on the homepage (ValueComparison) had a "Revisions
 * included" row whose answer was "Unlimited retries", printed beside a $5
 * Full Analysis that is exactly one analysis, while the free scan runs on a
 * daily allowance. The row is gone; the table's other rows are unchanged.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { ValueComparison } from "@/components/ValueComparison";

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const locale = (l: string) => JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales", `${l}.json`), "utf8"));
const before = i18n.language;
afterEach(cleanup);
afterAll(async () => { await i18n.changeLanguage(before); });

describe("the value comparison", () => {
  for (const l of LOCALES) {
    it(`${l}: no revisions row, and the rest of the table is there`, async () => {
      const res = locale(l);
      i18n.addResourceBundle(l, "translation", res, true, true);
      await i18n.changeLanguage(l);
      render(<MemoryRouter><ValueComparison /></MemoryRouter>);
      const text = document.body.textContent ?? "";
      const rows = res.valueComparison?.rows ?? {};
      if (rows.revisions?.us) expect(text, `${l} still promises "${rows.revisions.us}"`).not.toContain(rows.revisions.us);
      if (rows.revisions?.feature) expect(text).not.toContain(rows.revisions.feature);
      expect(text).toContain(rows.cost.feature);
      expect(text).toContain(rows.jobTailoring.feature);
      cleanup();
    });
  }
});
