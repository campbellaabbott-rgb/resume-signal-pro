/**
 * A BUY BUTTON NAMED NO TERMS AND NO RENEWAL, AND SENT NO REFERRAL.
 *
 * WHAT WAS WRONG (commercial-readiness plan 2026-10-08, items 11 and 12, the
 * affiliate line; sweep S8-055).
 *   - No buy or sign-up button said "By continuing you agree to the Terms",
 *     and nothing recorded which Terms a buyer was shown, so the Terms bound
 *     nobody.
 *   - The Pro and agent subscribe buttons never said the plan renews every
 *     month until cancelled; the agent's never named its trial.
 *   - Five of six checkout calls sent no affiliate code.
 *   - A new Pro subscriber came back to /account?pro=success to a page that
 *     said nothing and could offer "Go Pro" again for five minutes: the
 *     success address carried no session, and nothing sent one.
 *
 * WHAT HOLDS NOW, mounted for real with only the backend and auth faked: the
 * line is above each plan's button with its renewal terms from the price
 * config; the call carries the Terms version only for a press on a button in
 * the line's block while it is on screen, and the referral this browser arrived with; a buyer back from
 * Stripe is re-checked with that session until the plan reads live, and told
 * so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { clickWhenEnabled } from "./helpers/click-when-enabled";
import en from "../i18n/locales/en.json";
import { TERMS_VERSION } from "@/config/terms";
import { SUBSCRIPTIONS } from "@/config/products";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
const user = { email: "member@example.com" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user, session: { access_token: "jwt" } }) }));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: false }) }));

import { AgentSubscriptionCard } from "@/components/AgentSubscriptionCard";
import { ProSubscriptionCard } from "@/components/ProSubscriptionCard";
import { purchaseTerms } from "@/lib/purchase-terms";
import { PRO_CONFIRM_INTERVAL_MS } from "@/hooks/use-pro-subscription";
import i18n from "@/i18n";

vi.setConfig(MOUNT_TEST_BUDGET);

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(v[k]));
const AGREE = en.purchaseTerms.agree.replace(/<\/?(terms|privacy)>/g, "");

beforeEach(() => {
  invoke.mockReset();
  localStorage.clear();
  window.history.replaceState(null, "", "/pricing");
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the line above a buy button, and what the button's call carries", () => {
  it("the agent's button says the trial, the renewal and the Terms, with both documents linked", () => {
    render(<MemoryRouter><AgentSubscriptionCard /></MemoryRouter>);
    expect(screen.getByText(fill(en.purchaseTerms.agentTrial, { days: SUBSCRIPTIONS.agent.trialDays, price: `$${SUBSCRIPTIONS.agent.priceUsd}` }))).toBeTruthy();
    const line = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === AGREE);
    expect([...line.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["/terms", "/privacy"]);
  });

  it("the Pro button says it renews monthly until cancelled", () => {
    invoke.mockResolvedValue({ data: { active: false }, error: null });
    render(<MemoryRouter><ProSubscriptionCard /></MemoryRouter>);
    expect(screen.getByText(fill(en.purchaseTerms.renewal, { price: `$${SUBSCRIPTIONS.pro.priceUsd}` }))).toBeTruthy();
  });

  it("the checkout call carries the Terms version shown and the referral this browser arrived with", async () => {
    localStorage.setItem("affiliate_ref", JSON.stringify({ code: "ab12cd34", expires: Date.now() + 86_400_000 }));
    invoke.mockResolvedValue({ data: { url: "" }, error: null });
    render(<MemoryRouter><AgentSubscriptionCard /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.agentPlan.cta) }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("create-agent-checkout", expect.anything()));
    const body = invoke.mock.calls.find(([fn]) => fn === "create-agent-checkout")![1].body;
    expect(body.termsVersion).toBe(TERMS_VERSION);
    expect(body.referralCode).toBe("ab12cd34");
  });

  it("with no line on screen, no call claims the buyer was shown one", () => {
    expect(purchaseTerms().termsVersion).toBeUndefined();
    invoke.mockResolvedValue({ data: { url: "" }, error: null });
    const { unmount } = render(<MemoryRouter><AgentSubscriptionCard /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en.agentPlan.cta) }));
    expect(purchaseTerms().termsVersion).toBe(TERMS_VERSION);
    unmount();
    expect(purchaseTerms().termsVersion).toBeUndefined();
  });

  it("both subscribe calls name the page's language, so Stripe shows the renewal terms in it", async () => {
    const was = i18n.language;
    i18n.language = "de";
    try {
      invoke.mockImplementation(async (fn: string) => ({ data: fn === "check-subscription" ? { active: false } : { url: "" }, error: null }));
      render(<MemoryRouter><AgentSubscriptionCard /><ProSubscriptionCard /></MemoryRouter>);
      fireEvent.click(screen.getByRole("button", { name: new RegExp(en.agentPlan.cta) }));
      // Go Pro is disabled until the subscription check answers (S12-166).
      await clickWhenEnabled(() => screen.getByRole("button", { name: /Go Pro/ }));
      await waitFor(() => expect(invoke).toHaveBeenCalledWith("create-subscription-checkout", expect.anything()));
      const bodyOf = (fn: string) => invoke.mock.calls.find(([f]) => f === fn)![1].body;
      expect(bodyOf("create-agent-checkout").language).toBe("de");
      expect(bodyOf("create-subscription-checkout").language).toBe("de");
    } finally {
      i18n.language = was;
    }
  });

  // S12-166: findByRole hands back Go Pro while the subscription check is
  // still out and the button is disabled; a click then did nothing and the
  // wait for the checkout call timed out, red on main for five pushes. A slow
  // check makes that window certain here.
  it("a click on Go Pro waits for the subscription check, however slow, and reaches the checkout", async () => {
    let answer: (v: unknown) => void = () => {};
    invoke.mockImplementation((fn: string) => (fn === "check-subscription"
      ? new Promise((r) => { answer = r; })
      : Promise.resolve({ data: { url: "" }, error: null })));
    render(<MemoryRouter><ProSubscriptionCard /></MemoryRouter>);
    const button = await screen.findByRole("button", { name: /Go Pro/ });
    expect(button.hasAttribute("disabled"), "the window this guards: Go Pro disabled while the check is out").toBe(true);
    setTimeout(() => answer({ data: { active: false }, error: null }), 150);
    await clickWhenEnabled(() => screen.getByRole("button", { name: /Go Pro/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("create-subscription-checkout", expect.anything()));
  });

  it("while the EU/UK switch is off, no box is shown and no consent is sent", () => {
    render(<MemoryRouter><AgentSubscriptionCard /></MemoryRouter>);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(purchaseTerms()).not.toHaveProperty("serviceStartConsent");
  });
});

describe("a new Pro subscriber back from Stripe (S8-055)", () => {
  it("is re-checked with the session they just paid in until the plan reads live, and told it is confirmed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.history.replaceState(null, "", "/account?pro=success&session_id=cs_test_abcdefgh123");
    let calls = 0;
    invoke.mockImplementation(async (fn: string) => {
      if (fn !== "check-subscription") return { data: null, error: null };
      calls++;
      return { data: calls < 3 ? { active: false, status: "inactive", cached: true } : { active: true, status: "active" }, error: null };
    });
    render(<MemoryRouter><ProSubscriptionCard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(en.proPlan.confirming)).toBeTruthy());
    expect(screen.getByRole("button", { name: /Go Pro/ }).hasAttribute("disabled"), "a second plan was offered while the first confirms").toBe(true);
    for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(PRO_CONFIRM_INTERVAL_MS); });
    await waitFor(() => expect(screen.getByText(en.proPlan.confirmed)).toBeTruthy());
    const sent = invoke.mock.calls.filter(([fn]) => fn === "check-subscription").map(([, o]) => o.body);
    expect(sent[0]).toEqual({ email: "member@example.com", sessionId: "cs_test_abcdefgh123" });
    expect(sent.length).toBe(3);
  });
});
