/**
 * THE PLANS CAN BE BOUGHT, AND A PAID FREELANCE BOOST IS GENERATED, NOT SOLD AGAIN.
 *
 * WHAT WAS WRONG (platform sweep 2026-10-04).
 *   L3-01  /pricing rendered the $99 card with no email; every click posted
 *          {email: undefined} and the checkout answered 400. The plan sold on
 *          the page could not be bought from it.
 *   L3-16  FreelanceBoost read its saved intake AFTER a mount effect had
 *          written the empty form over it, so a buyer returning from Stripe
 *          was told their answers were gone and shown only the buy buttons:
 *          they paid, got nothing, and were walked into paying twice.
 *   L6-06  a plan that owed money was shown "Go Pro" (a second plan) instead
 *          of a way to update the card.
 *   L3-04  the Pro card sold the Morning Queue, which only the agent plan
 *          unlocks (the decision-free half of that item).
 *   L3-15  backing out of Stripe was answered "We couldn't process your
 *          payment", and Try Again went home whatever was being bought.
 *   10-17  Freelance Boost and Transition Pro are no longer sold (owner
 *          decision 2026-10-17): the page says so to a visitor, is not
 *          indexed and offers no buy button, while a past buyer's link still
 *          generates what was bought.
 *
 * Mounted for real, with only the backend and the auth state faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

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

let user: { email: string } | null = null;
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user, session: user ? { access_token: "jwt" } : null }) }));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: false }) }));

const pro = { active: false, status: null as string | null, currentPeriodEnd: null, loading: false };
const subscribe = vi.fn(async () => true);
const manage = vi.fn(async () => undefined);
vi.mock("@/hooks/use-pro-subscription", () => ({
  useProSubscription: () => ({ pro, subscribe, manage, actionLoading: false, knownEmail: "" , refresh: vi.fn() }),
}));

const purchaseProduct = vi.fn(async () => null);
vi.mock("@/hooks/use-product-checkout", async (orig) => ({
  ...(await orig<typeof import("@/hooks/use-product-checkout")>()),
  useProductCheckout: () => ({ purchaseProduct, isLoading: false, currentProduct: null }),
}));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
const seo: Array<Record<string, unknown>> = [];
vi.mock("@/components/seo/SEO", () => ({ SEO: (p: Record<string, unknown>) => { seo.push(p); return null; } }));
// Purchases open, as once the owner names the seller (owner decision
// 2026-10-17): the Pro card's button is what is tested here.
vi.mock("@/lib/purchases-open", () => ({ purchasesOpen: () => true }));
vi.mock("@/components/ProductPreview", () => ({ ProductPreview: () => null }));

import { AgentSubscriptionCard } from "@/components/AgentSubscriptionCard";
import { ProSubscriptionCard } from "@/components/ProSubscriptionCard";
import FreelanceBoost from "../pages/FreelanceBoost";
import PaymentFailed from "../pages/PaymentFailed";

vi.setConfig(MOUNT_TEST_BUDGET);

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

const at = (path: string, node: JSX.Element) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="*" element={<>{node}<Where /></>} />
    </Routes>
  </MemoryRouter>,
);

let hrefSet: string[];
beforeEach(() => {
  invoke.mockReset();
  subscribe.mockClear();
  manage.mockClear();
  purchaseProduct.mockClear();
  user = null;
  pro.active = false;
  pro.status = null;
  localStorage.clear();
  hrefSet = [];
  const real = window.location;
  const loc: Record<string, unknown> = {};
  for (const k of ["origin", "protocol", "host", "hostname", "port", "pathname", "search", "hash"] as const) {
    Object.defineProperty(loc, k, { get: () => real[k], enumerable: true });
  }
  Object.defineProperty(loc, "href", { get: () => real.href, set: (v: string) => { hrefSet.push(v); }, enumerable: true });
  vi.stubGlobal("location", loc);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the agent card on /pricing (L3-01)", () => {
  it("sends a signed-out visitor to sign in and back, and posts nothing", async () => {
    at("/pricing", <AgentSubscriptionCard />);
    fireEvent.click(screen.getByRole("button", { name: /start the agent/i }));
    expect(screen.getByTestId("where").textContent).toBe(`/auth?next=${encodeURIComponent("/pricing")}`);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("takes a signed-in visitor to Stripe", async () => {
    user = { email: "owner@example.com" };
    invoke.mockResolvedValue({ data: { url: "https://checkout.stripe.com/c/cs_test_1" }, error: null });
    at("/pricing", <AgentSubscriptionCard />);
    fireEvent.click(screen.getByRole("button", { name: /start the agent/i }));
    await waitFor(() => expect(hrefSet).toEqual(["https://checkout.stripe.com/c/cs_test_1"]), SLOW);
    expect(invoke.mock.calls[0][0]).toBe("create-agent-checkout");
  });

  it("takes a subscriber to the agent instead of an error", async () => {
    user = { email: "owner@example.com" };
    invoke.mockResolvedValue({ data: { alreadySubscribed: true, tier: "agent" }, error: null });
    at("/pricing", <AgentSubscriptionCard />);
    fireEvent.click(screen.getByRole("button", { name: /start the agent/i }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/agent"), SLOW);
  });

  it("opens the billing portal for a plan that owes money, never a second checkout", async () => {
    user = { email: "owner@example.com" };
    invoke.mockImplementation(async (fn: string) => fn === "create-agent-checkout"
      ? { data: { needsPaymentUpdate: true }, error: null }
      : { data: { url: "https://billing.stripe.com/p/session_1" }, error: null });
    at("/pricing", <AgentSubscriptionCard />);
    fireEvent.click(screen.getByRole("button", { name: /start the agent/i }));
    await waitFor(() => expect(hrefSet).toEqual(["https://billing.stripe.com/p/session_1"]), SLOW);
    expect(invoke.mock.calls.map(([fn]) => fn)).toEqual(["create-agent-checkout", "create-portal-session"]);
  });
});

describe("the Pro card", () => {
  it("no longer sells the agent's Morning Queue as a Pro perk (L3-04, decision-free half)", () => {
    at("/pricing", <ProSubscriptionCard />);
    expect(screen.queryByText(/Morning Queue/)).toBeNull();
  });

  it("offers a plan that owes money a card update, not a second plan (L6-06)", () => {
    user = { email: "owner@example.com" };
    pro.status = "past_due";
    at("/account", <ProSubscriptionCard />);
    expect(screen.queryByRole("button", { name: /go pro/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /update payment method/i }));
    expect(manage).toHaveBeenCalledTimes(1);
  });

  it("sends a signed-out visitor to sign in before any checkout", () => {
    at("/pricing", <ProSubscriptionCard />);
    fireEvent.click(screen.getByRole("button", { name: /go pro/i }));
    expect(subscribe).not.toHaveBeenCalled();
    expect(screen.getByTestId("where").textContent).toBe(`/auth?next=${encodeURIComponent("/pricing")}`);
  });

  it("subscribes a signed-in visitor with their account address", () => {
    user = { email: "owner@example.com" };
    at("/pricing", <ProSubscriptionCard />);
    // Pro's own renewal box first (owner decision 2026-10-17).
    fireEvent.click(document.querySelector("[data-auto-renew-box] input")!);
    fireEvent.click(screen.getByRole("button", { name: /go pro/i }));
    expect(subscribe).toHaveBeenCalledWith("owner@example.com");
  });
});

describe("a buyer back from Stripe with a paid Freelance Boost (L3-16)", () => {
  const DRAFT = {
    projects: [{ clientType: "a dental practice", problem: "no bookings", deliverable: "a booking site", toolsSkills: "Webflow", outcome: "", duration: "3 weeks", paymentBand: "", repeatOrReferral: "" }],
    targetRole: "Product Manager",
    jobPosting: "",
    employmentTimeline: "",
    situation: "alongside",
    workMode: "freelance",
  };

  it("is generated from the intake saved on this device, without a second purchase", async () => {
    localStorage.setItem("freelanceBoostIntake", JSON.stringify(DRAFT));
    invoke.mockResolvedValue({ data: { success: true, data: { structure: "projects_section", structureNote: "", header: "Freelance Projects", scopeStatement: "", projects: [{ clientLabel: "dental", relevance: 8, bullets: ["Shipped a booking site"], keywordsCovered: [] }], transitionParagraph: "", gapHandling: "", keywordCoverage: null } }, error: null });
    at("/freelance-boost?session_id=cs_test_paid_boost", <FreelanceBoost />);
    // The saved result is asked for first (wave 3, S8-016); none here, so it is generated.
    await waitFor(() => expect(invoke.mock.calls.some(([f]) => f === "generate-freelance-boost")).toBe(true), SLOW);
    expect(invoke.mock.calls[0][0]).toBe("recover-purchase");
    const [, opts] = invoke.mock.calls.find(([f]) => f === "generate-freelance-boost") as [string, { body: { sessionId: string; targetRole: string } }];
    expect(opts.body).toMatchObject({ sessionId: "cs_test_paid_boost", targetRole: "Product Manager" });
    expect(await screen.findByText("Shipped a booking site", {}, SLOW)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("freelanceBoostIntake") ?? "{}").targetRole, "the saved intake was overwritten").toBe("Product Manager");
    expect(purchaseProduct).not.toHaveBeenCalled();
  });

  it("with no intake on this device, offers to generate (already paid) and never the buy buttons", async () => {
    at("/freelance-boost?session_id=cs_test_paid_boost", <FreelanceBoost />);
    expect(await screen.findByRole("button", { name: /generate my section \(already paid\)/i }, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /boost my experience/i }), "a paid buyer was offered the $29 checkout again").toBeNull();
    expect(screen.queryByRole("button", { name: /full transition kit/i })).toBeNull();
    expect(invoke.mock.calls.filter(([f]) => f === "generate-freelance-boost"), "generated with no intake").toHaveLength(0);
  });

  it("without a purchase, it says it is no longer sold, is not indexed, and offers no buy button or intake (2026-10-17)", () => {
    seo.length = 0;
    at("/freelance-boost", <FreelanceBoost />);
    const note = document.querySelector("[data-no-longer-sold]");
    expect(note?.textContent).toMatch(/Freelance Boost and Transition Pro are no longer sold, and they are not part of Pro/);
    expect(note?.textContent).toMatch(/keeps working for 90 days/);
    expect(seo.at(-1)).toMatchObject({ noIndex: true });
    expect(screen.queryByRole("button", { name: /boost my experience/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /full transition kit/i })).toBeNull();
    expect(screen.queryByText(/import from your profile/i), "the intake is for a purchase only").toBeNull();
    expect(document.body.textContent).not.toMatch(/\$29|\$59/);
  });

  it("control: a past buyer's link opens the intake and says nothing is sold to them again", async () => {
    at("/freelance-boost?session_id=cs_test_paid_boost", <FreelanceBoost />);
    expect(await screen.findByText(/import from your profile/i, {}, SLOW)).toBeInTheDocument();
    expect(document.querySelector("[data-no-longer-sold]")).toBeNull();
  });
});

describe("backing out of Stripe (L3-15)", () => {
  it("says nothing was charged, and Try again goes back to the product being bought", async () => {
    // With the binding the cancelled checkout carried (wave 3, S8-056).
    sessionStorage.setItem("rb_checkout_retry", JSON.stringify({ productId: "premiumPackage", sessionId: "8a6f7d3e-1b2c-4d5e-9f00-112233445566", path: "/pricing", at: Date.now() }));
    at("/payment-failed?product=premiumPackage", <PaymentFailed />);
    expect(screen.getByText("Checkout cancelled")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't process your payment/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(purchaseProduct).toHaveBeenCalledWith("premiumPackage", expect.objectContaining({ ctaSection: "payment_cancelled", sessionId: "8a6f7d3e-1b2c-4d5e-9f00-112233445566" })), SLOW);
  });

  it("returns a Freelance Boost buyer to the guided flow, where their intake is kept", () => {
    at("/payment-failed?product=freelanceTransitionPro", <PaymentFailed />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByTestId("where").textContent).toBe("/freelance-boost");
    expect(purchaseProduct).not.toHaveBeenCalled();
  });
});
