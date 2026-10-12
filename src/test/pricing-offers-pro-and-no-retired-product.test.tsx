/**
 * /pricing OFFERS PRO, AND NO RETIRED PRODUCT (the apply pivot, owner decision
 * 2026-10-11).
 *
 * The Agent plan ($99 a month), the Agent Pass ($29) and the $7 Apply
 * Assistant are retired: none of them may be offered on the page that sells,
 * and the structured data a search engine reads may quote none of their
 * prices. Pro is presented by what it does today — the perks in
 * src/config/pro-perks.ts, each a shipped capability — and nothing promises
 * AI tools that do not exist yet. Connecting your own AI is said once, with no
 * price, pointing at /agents. Mounted for real with only the backend, auth and
 * checkout faked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const invoke = vi.fn(async () => ({ data: null, error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...(a as [])) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: true, checked: true }) }));
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({ pro: { active: false, status: null, currentPeriodEnd: null, loading: false }, subscribe: vi.fn(), manage: vi.fn(), actionLoading: false, knownEmail: "", refresh: vi.fn() }),
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));

import Pricing from "../pages/Pricing";
import { PRODUCTS, SUBSCRIPTIONS, PASS } from "@/config/products";
import { PRO_PERKS } from "@/config/pro-perks";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(cleanup);

const mount = () => render(<MemoryRouter initialEntries={["/pricing"]}><Pricing /></MemoryRouter>);
const ld = () => JSON.parse(document.querySelector('script[type="application/ld+json"]')!.innerHTML) as {
  description: string; offers: { highPrice: string; offerCount: number };
};

describe("/pricing after the apply pivot", () => {
  it("renders the Pro card with today's perks, and no Agent plan card", () => {
    mount();
    expect(screen.getByText("Resume Booster Pro")).toBeInTheDocument();
    for (const perk of PRO_PERKS) expect(screen.getByText(perk)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(`$${SUBSCRIPTIONS.agent.priceUsd}`);
    expect(document.body.textContent).not.toMatch(/Morning Queue|Apply Agent|Agent plan|Start the agent/);
  });

  it("offers no pass and prices no pass, and says connecting your own AI is free, pointing at /agents", () => {
    mount();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain(`$${PASS.priceUsd} for`);
    expect(text).not.toMatch(/one-off pass|Agent Pass/);
    const line = document.querySelector("[data-connect-free]")!;
    expect(line.textContent).toMatch(/is free/);
    expect(line.textContent).toMatch(/never submit an application for you/);
    expect(line.textContent).not.toMatch(/\$\d/);
    expect(line.querySelector("a")!.getAttribute("href")).toBe("/agents");
  });

  it("does not offer the Apply Assistant, even with the whole catalogue opened", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /see every tool/i }));
    expect(screen.queryByText(PRODUCTS.applyAssistant.name)).toBeNull();
    // The rest of the catalogue still opens: the toggle is not a dead control.
    expect(screen.getByText(PRODUCTS.fullAnalysis.name)).toBeInTheDocument();
  });

  it("the structured data quotes no retired price and describes one subscription and no pass", () => {
    mount();
    const data = ld();
    expect(data.description).not.toMatch(/pass|two optional subscriptions/i);
    const retired = [SUBSCRIPTIONS.agent.priceUsd, PASS.priceUsd, PRODUCTS.applyAssistant.priceUsd];
    const offered: number[] = [
      ...(Object.keys(PRODUCTS) as Array<keyof typeof PRODUCTS>)
        .filter((k) => k !== "applyAssistant" && k !== "basicKeywordFix")
        .map((k): number => PRODUCTS[k].priceUsd),
      SUBSCRIPTIONS.pro.priceUsd,
    ];
    expect(Number(data.offers.highPrice)).toBe(Math.max(...offered));
    expect(data.offers.offerCount).toBe(offered.length + 1);
    // The Agent plan was the catalogue's ceiling; a range that still counted it would quote it.
    expect(Number(data.offers.highPrice)).not.toBe(SUBSCRIPTIONS.agent.priceUsd);
    expect(retired.every((r) => Number.isFinite(r))).toBe(true);
  });

  it("starts no checkout of a retired product on load", () => {
    mount();
    const fns = invoke.mock.calls.map((c) => (c as unknown[])[0]);
    expect(fns).not.toContain("create-agent-checkout");
    expect(fns).not.toContain("create-pass-checkout");
  });
});
