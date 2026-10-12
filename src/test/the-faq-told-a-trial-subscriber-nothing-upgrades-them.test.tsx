/**
 * THE FAQ TOLD A TRIAL SUBSCRIBER THAT NOTHING UPGRADES THEM
 * (commercial-readiness plan 2026-10-08, item 11).
 *
 * "Is this a subscription?" ended "...and nothing upgrades you
 * automatically", in nine languages, while both plans renew every month and
 * the Morning Queue's first-time trial becomes the paid plan unless it is
 * cancelled before it ends. The answer, as the homepage renders it, now says
 * both.
 *
 * 2026-10-11, the apply pivot: the Morning Queue (the Agent plan) is retired
 * and Pro, which has no trial at checkout, is the one plan on sale. The
 * answer must still say the plan renews until cancelled, and must no longer
 * describe a plan or a trial nobody can buy.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import en from "../i18n/locales/en.json";
import { SUBSCRIPTIONS } from "@/config/products";

vi.mock("@/hooks/use-currency", () => ({ useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, isLocalCurrency: false }) }));

import { FAQ } from "@/components/FAQ";

afterEach(cleanup);

describe("the subscription answer", () => {
  it("says the one plan on sale renews until cancelled, and describes no retired plan and no trial", () => {
    render(<FAQ />);
    fireEvent.click(screen.getByText(en.faq.questions.subscription.question));
    const answer = screen.getByText((_, el) => !!el && el.textContent?.startsWith("Both options exist") === true && el.children.length === 0);
    const text = answer.textContent ?? "";
    expect(text).toContain(`$${SUBSCRIPTIONS.pro.priceUsd}/month`);
    expect(text).toMatch(/renews every month until you cancel/);
    expect(text).not.toMatch(/and nothing upgrades you automatically/);
    // Retired by the apply pivot: no price, plan name or trial of the agent's.
    expect(text).not.toContain(`$${SUBSCRIPTIONS.agent.priceUsd}`);
    expect(text).not.toMatch(/Morning Queue|Agent plan|apply agent|free trial/i);
  });

});
