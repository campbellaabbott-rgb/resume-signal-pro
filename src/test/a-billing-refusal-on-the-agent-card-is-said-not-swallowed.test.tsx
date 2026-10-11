/**
 * A BILLING REFUSAL ON THE AGENT CARD IS SAID, NOT SWALLOWED (S11-015).
 *
 * The agent card opens Stripe's billing portal for a plan that owes money or
 * a Pro plan that would bill beside the agent. When create-portal-session
 * answered anything but a url (mailbox_unproven, a 404, a 500), openPortal
 * did nothing at all: the button looked broken and the subscriber was left
 * paying. The answer's own words are now shown, or a plain line when it has
 * none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { email: "owner@example.com" }, session: { access_token: "jwt" } }) }));
vi.mock("@/hooks/useAgentSender", () => ({ useAgentSender: () => ({ online: false }) }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));

import { AgentSubscriptionCard } from "@/components/AgentSubscriptionCard";

vi.setConfig(MOUNT_TEST_BUDGET);

let hrefSet: string[];
beforeEach(() => {
  invoke.mockReset();
  toastError.mockReset();
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

const REFUSAL = "To protect your billing details, open billing from the link in your Stripe receipt, or email resumeboostersupp@gmail.com from this address.";

describe("the agent card's billing link", () => {
  it("shows the portal's refusal in words", async () => {
    invoke.mockImplementation(async (fn: string) => fn === "create-agent-checkout"
      ? { data: { needsPaymentUpdate: true }, error: null }
      : { data: { error: REFUSAL, code: "mailbox_unproven" }, error: null });
    render(<MemoryRouter><AgentSubscriptionCard /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /start the agent/i }));
    await waitFor(() => expect(toastError, "the portal's refusal was swallowed").toHaveBeenCalledWith(REFUSAL), SLOW);
    expect(hrefSet).toEqual([]);
  });

  it("reads the refusal from an error status's body", async () => {
    invoke.mockImplementation(async (fn: string) => fn === "create-agent-checkout"
      ? { data: { hasProSubscription: true }, error: null }
      : { data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: "No subscription found for this account" }) } } });
    render(<MemoryRouter><AgentSubscriptionCard /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /start the agent/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("No subscription found for this account"), SLOW);
  });

  it("still opens the portal when it answers a url", async () => {
    invoke.mockImplementation(async (fn: string) => fn === "create-agent-checkout"
      ? { data: { needsPaymentUpdate: true }, error: null }
      : { data: { url: "https://billing.stripe.com/p/session_1" }, error: null });
    render(<MemoryRouter><AgentSubscriptionCard /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /start the agent/i }));
    await waitFor(() => expect(hrefSet).toEqual(["https://billing.stripe.com/p/session_1"]), SLOW);
  });
});
