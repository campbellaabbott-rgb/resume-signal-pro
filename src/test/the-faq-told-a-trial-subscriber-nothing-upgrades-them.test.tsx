/**
 * THE FAQ TOLD A TRIAL SUBSCRIBER THAT NOTHING UPGRADES THEM
 * (commercial-readiness plan 2026-10-08, item 11).
 *
 * "Is this a subscription?" ended "...and nothing upgrades you
 * automatically", in nine languages, while both plans renew every month and
 * the Morning Queue's first-time trial becomes the paid plan unless it is
 * cancelled before it ends. The answer, as the homepage renders it, now says
 * both.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import en from "../i18n/locales/en.json";
import { SUBSCRIPTIONS } from "@/config/products";

vi.mock("@/hooks/use-currency", () => ({ useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, isLocalCurrency: false }) }));

import { FAQ } from "@/components/FAQ";

afterEach(cleanup);

describe("the subscription answer", () => {
  it("says the plans renew until cancelled and the trial turns into the paid plan", () => {
    render(<FAQ />);
    fireEvent.click(screen.getByText(en.faq.questions.subscription.question));
    const answer = screen.getByText((_, el) => !!el && el.textContent?.startsWith("Both options exist") === true && el.children.length === 0);
    const text = answer.textContent ?? "";
    expect(text).toContain(`$${SUBSCRIPTIONS.pro.priceUsd}/month`);
    expect(text).toMatch(/renew every month until you cancel/);
    expect(text).toMatch(/free trial[^.]*turns into the paid plan[^.]*unless you cancel before/);
    expect(text).not.toMatch(/and nothing upgrades you automatically/);
  });

});
