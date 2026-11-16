/**
 * THE ACCOUNT PRINTS DATES AND COUNTS IN THE READER'S LANGUAGE (S14X-255, the
 * account lane's share).
 *
 * WHAT WAS WRONG. The account page and its cards printed dates and counts with
 * toLocaleDateString() and friends, called with no locale: the browser's
 * language decided, not the page's, so a German page read "10/12/2026" on an
 * American browser beside German words, and an order's price was formatted
 * the same way.
 *
 * WHAT HOLDS NOW:
 *   - no file the account lane owns calls toLocaleDateString,
 *     toLocaleString or toLocaleTimeString without a locale (comments
 *     stripped first, so a sentence about the old call cannot satisfy or
 *     fail this); dates and counts go through src/lib/format, which prints
 *     in the interface language;
 *   - an order row mounted with the page in German prints a German date and
 *     a German price.
 * ConnectedAIsCard and SavedSearchesCard are other lanes' files and are not
 * read here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import i18n from "@/i18n";
import { codeOf } from "./helpers/strip-comments";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: async () => ({ data: null, error: null }) } } }));

import { OrdersList } from "@/components/account/OrdersList";

const root = resolve(__dirname, "../..");
const OTHER_LANES = new Set(["ConnectedAIsCard.tsx", "SavedSearchesCard.tsx"]);
const FILES = [
  "src/pages/Account.tsx",
  "src/pages/Agent.tsx",
  ...readdirSync(resolve(root, "src/components/account"))
    .filter((f) => f.endsWith(".tsx") && !OTHER_LANES.has(f))
    .map((f) => `src/components/account/${f}`),
];

/** A toLocale call whose first argument is missing or undefined: the browser picks the language. */
const BARE = /\.toLocale(?:Date|Time)?String\(\s*(?:\)|undefined\b)/g;

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

describe("no account file lets the browser pick the language of a date or a count", () => {
  it("reads at least the page and its cards", () => {
    expect(FILES).toContain("src/components/account/OrdersList.tsx");
    expect(FILES.length).toBeGreaterThan(20);
  });

  it.each(FILES)("%s", (file) => {
    const hits = [...codeOf(readFileSync(resolve(root, file), "utf8")).matchAll(BARE)].map((m) => m[0]);
    expect(hits).toEqual([]);
  });
});

describe("an order row in German", () => {
  it("prints a German date and a German price", async () => {
    await act(async () => { await i18n.changeLanguage("de"); });
    render(<OrdersList orders={[{ id: "o1", sessionId: "cs_test_abcdefghij12", product: "Full Analysis", productType: "full_analysis", date: "2026-10-12T10:00:00Z", status: "ready", amountCents: 500, currency: "eur" }]} />);
    const row = document.querySelector("[data-order=o1]")!.textContent ?? "";
    expect(row).toContain("12. Okt. 2026");
    expect(row).toMatch(/5,00\s€/);
  });
});
