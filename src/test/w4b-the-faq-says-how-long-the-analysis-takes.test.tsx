/**
 * THE FAQ SAYS HOW LONG THE ANALYSIS TAKES, AND WHAT PRO IS (S12-134; the
 * product line).
 *
 * WHAT WAS WRONG. "Your resume analysis is generated instantly after payment.
 * You will see your results on the success page within seconds." Generating
 * it takes up to a few minutes, so a buyer watching a spinner past "seconds"
 * wrote to support. And "Is this a subscription?" said every tool is a
 * one-time payment and Pro is "unlimited scans and every tool", while the
 * catalogue now sells two one-time tools and Pro is the writing tools.
 *
 * Mounted for real, every answer opened. The answers read NEW keys (an
 * existing locale value is never edited), whose English defaults are these.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// These answers are the ones shown once both products are on sale; while
// they are not, the FAQ asks no delivery question and says purchases open
// soon (review round 2026-10-26,
// hp-fix-the-scanner-page-sells-only-what-is-sold-and-dates-what-it-counts).
vi.mock("@/lib/purchases-open", () => ({ purchasesOpen: () => true, fullAnalysisOnSale: () => true, proOnSale: () => true }));

import { FAQ } from "@/components/FAQ";
import { proSummaryOnSale } from "@/config/pro-perks";

afterEach(cleanup);

const openAll = () => {
  render(<FAQ />);
  for (const trigger of screen.getAllByRole("button")) fireEvent.click(trigger);
};
const answerTo = (question: RegExp): string => {
  render(<FAQ />);
  fireEvent.click(screen.getByRole("button", { name: question }));
  return document.querySelector("[data-state='open'][role='region']")?.textContent ?? "";
};

describe("the FAQ", () => {
  it("never promises the analysis within seconds, and states the bound it keeps", () => {
    const answer = answerTo(/How long does the analysis take/);
    expect(answer).not.toMatch(/within seconds|instantly/i);
    expect(answer).toMatch(/a few minutes at most/);
    expect(answer).toMatch(/90 days/);
  });

  it("says what is one-time and what Pro is, and still that nothing else upgrades you", () => {
    const answer = answerTo(/Is this a subscription/);
    expect(answer).not.toMatch(/every tool/i);
    // Owner decision 2026-10-17: one one-off, and Pro read from the one list.
    expect(answer).toMatch(/\$5 Full Analysis is a one-time payment/);
    expect(answer).not.toMatch(/Freelance|Transition Pro|unlimited/i);
    // Pro's summary as a page may print it today: without the included Full
    // Analysis while that is not on sale (gate G2).
    expect(answer).toContain(proSummaryOnSale().text);
    expect(answer).toMatch(/Everything in a free account, plus the writing tools/);
    expect(answer).toMatch(/\$45\/month/);
    expect(answer).toMatch(/Nothing else upgrades you automatically/);
  });

  it("no answer anywhere says within seconds", () => {
    openAll();
    expect(document.body.textContent).not.toMatch(/within seconds/i);
  });
});
