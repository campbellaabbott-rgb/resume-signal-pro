/**
 * THE SCANNER PAGE SELLS ONLY WHAT IS SOLD, AND COUNTS NOTHING UNDATED
 * (review round of 2026-10-26).
 *
 * The new "/" links to /resume-checker as "Check it free against a posting",
 * so /resume-checker became the only home of three pieces of the old homepage
 * that said what /pricing does not:
 *   - its FAQ described the $5 Full Analysis and Pro as on sale ("Both options
 *     exist, and you choose") and promised the analysis "usually a minute or
 *     two after payment", while /pricing says "Not on sale yet" and the owner
 *     prints no delivery time until a delivery has been watched (P18, G2);
 *   - its closing comparison sold the Full Analysis with LinkedIn profile
 *     optimisation (no longer offered), industry templates and a "Complete
 *     10-Section Report" (not in its definition), under a badge saying the
 *     résumé "might be losing you interviews right now", and its open state
 *     promised "Instant results" and that "One interview" pays for it;
 *   - its hero printed the board's count floored ("1,000,000+ live
 *     openings") with no date basis and said the openings were "matched to
 *     your resume", while "/" says fit is a word match and résumé matching
 *     is being rebuilt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const gates = vi.hoisted(() => ({ fa: false, pro: false }));
vi.mock("@/lib/purchases-open", () => ({
  fullAnalysisOnSale: () => gates.fa,
  proOnSale: () => gates.pro,
}));
vi.mock("@/hooks/use-board-totals", async (orig) => ({
  ...(await orig<typeof import("@/hooks/use-board-totals")>()),
  useBoardTotals: () => ({ jobs: 1_025_295, feeds: 29_000, tracked: 1_200_000 }),
}));
vi.mock("@/hooks/use-scan-totals", () => ({ useScanTotals: () => null }));

import { FAQ } from "@/components/FAQ";
import { FinalCTA } from "@/components/FinalCTA";
import { Hero } from "@/components/Hero";

const ROOT = resolve(__dirname, "../..");

beforeEach(() => { gates.fa = false; gates.pro = false; });
afterEach(cleanup);

/** The FAQ with every answer opened. */
function faqText(): string {
  render(<MemoryRouter><FAQ /></MemoryRouter>);
  const triggers = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-expanded") !== null);
  let text = "";
  for (const b of triggers) {
    fireEvent.click(b);
    text += ` ${document.body.textContent ?? ""}`;
  }
  return text;
}

describe("the scanner page's FAQ", () => {
  it("with both switches off: no product described as on sale, no delivery time, and no promise that one opens", () => {
    const text = faqText();
    expect(text).not.toMatch(/Both options exist/);
    expect(text).not.toMatch(/\$45\/month/);
    expect(text).not.toMatch(/minute or two after payment/);
    expect(text).not.toMatch(/How long does the analysis take/);
    expect(text).toMatch(/Is this a subscription\?/);
    expect(text).toMatch(/nothing is on sale yet/);
    expect(text).not.toMatch(/open soon/i);
  });

  it("with only the Full Analysis on sale: it alone is described, and the delivery time is printed", () => {
    gates.fa = true;
    const text = faqText();
    expect(text).toMatch(/one-time payment that never renews/);
    expect(text).not.toMatch(/\$45\/month/);
    expect(text).toMatch(/How long does the analysis take/);
  });

  it("with both on sale: both are described", () => {
    gates.fa = true;
    gates.pro = true;
    const text = faqText();
    expect(text).toMatch(/Both options exist/);
    expect(text).toMatch(/\$45\/month/);
  });

  it("as shipped both switches are on (sales stay on, the owner, 2026-10-27), so the answer that names both shows", async () => {
    const real = await vi.importActual<typeof import("@/lib/purchases-open")>("@/lib/purchases-open");
    expect([real.fullAnalysisOnSale(), real.proOnSale()]).toEqual([true, true]);
  });

  it("every language carries the closed and the Full-Analysis-only answers, and none promises a sale soon", () => {
    for (const f of readdirSync(resolve(ROOT, "src/i18n/locales")).filter((n) => n.endsWith(".json"))) {
      const q = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales", f), "utf8")).faq.questions;
      expect(q.subscriptionClosed?.answer, `${f} subscriptionClosed`).toBeTruthy();
      expect(q.subscriptionClosed.answer, `${f} subscriptionClosed`).not.toMatch(/open soon|bientôt|pronto|bald möglich|binnenkort|em breve|जल्द|lalong madaling/i);
      expect(q.subscriptionFaOnly?.answer, `${f} subscriptionFaOnly`).toMatch(/\{\{price\}\}/);
    }
  });
});

describe("the scanner page's closing call to action", () => {
  it("sells no retired or undefined feature and makes no interview claim, closed or open", () => {
    for (const open of [false, true]) {
      gates.fa = open;
      render(<MemoryRouter><FinalCTA onGetStarted={() => {}} /></MemoryRouter>);
      const text = document.body.textContent ?? "";
      for (const said of [/LinkedIn/i, /Templates Applied/i, /10-Section/i, /ALL Bullets/i, /interviews?/i, /Instant results/i, /paid for itself/i]) {
        expect(text, `${open ? "open" : "closed"}: ${said}`).not.toMatch(said);
      }
      cleanup();
    }
  });

  it("no language keeps the comparison, the urgency badge or the interview arithmetic", () => {
    for (const f of readdirSync(resolve(ROOT, "src/i18n/locales")).filter((n) => n.endsWith(".json"))) {
      const fc = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales", f), "utf8")).finalCta ?? {};
      for (const k of ["comparison", "urgency", "roi", "guarantee", "benefits"]) expect(fc[k], `${f} finalCta.${k}`).toBeUndefined();
    }
  });
});

describe("the scanner page's hero", () => {
  it("prints no floored count without its date, and does not say the openings are matched to a résumé", () => {
    render(<MemoryRouter><Hero /></MemoryRouter>);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\d[\d,.]*\+\s*(?:live|open)/i);
    expect(text).not.toMatch(/1,000,000/);
    expect(text).not.toMatch(/matched to your r[ée]sum[ée]/i);
  });

  it("no language says the openings are matched to a résumé", () => {
    for (const f of readdirSync(resolve(ROOT, "src/i18n/locales")).filter((n) => n.endsWith(".json"))) {
      const h = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales", f), "utf8")).hero?.headline ?? {};
      expect(h.feedbackLive, `${f} hero.headline.feedbackLive`).toBeUndefined();
      expect(h.feedbackPlain, `${f} hero.headline.feedbackPlain`).toBeUndefined();
      expect(h.tailFreeCheck, `${f} hero.headline.tailFreeCheck`).toBeTruthy();
    }
  });
});
