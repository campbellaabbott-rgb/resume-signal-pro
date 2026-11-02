/**
 * A PLAN ON THE ADDRESS THAT THE ACCOUNT CANNOT USE IS SHOWN, NOT SOLD AGAIN
 * (S13-086).
 *
 * check-subscription answers { active: false, linkPending: true } for an
 * account whose address holds a live plan it is not linked to. The card
 * printed the linking note and, under it, "Go Pro — $45/month". The checkout
 * reads the same address and answers { alreadySubscribed: true }, so the
 * button could never start a plan; pressing it toasted "You're already a Pro
 * member / Your plan is already active on this account" and the card went
 * back to locked. The card now shows the plan and how it gets linked, and the
 * toast for an address-only plan says that, not "active on this account".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  toasts: [] as Array<{ title?: string; description?: string }>,
  pro: { active: false, status: null as string | null, currentPeriodEnd: null as string | null, loading: false, trialing: false, linkPending: false, cancelAtPeriodEnd: false, planTier: null as "pro" | "agent" | null },
  realHook: false,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => h.invoke(...a) } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { email: "member@example.com" }, session: { access_token: "jwt" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (t: { title?: string; description?: string }) => { h.toasts.push(t); } }) }));

import { useProSubscription } from "@/hooks/use-pro-subscription";

beforeEach(() => {
  h.invoke.mockReset();
  h.toasts.length = 0;
  localStorage.clear();
});
afterEach(() => cleanup());

describe("the hook's answer to alreadySubscribed", () => {
  it("an address-only plan is told to get linked, never that it is active on this account", async () => {
    h.invoke.mockImplementation(async (fn: string) => {
      if (fn === "check-subscription") return { data: { active: false, linkPending: true }, error: null };
      if (fn === "create-subscription-checkout") return { data: { alreadySubscribed: true, tier: "pro" }, error: null };
      return { data: null, error: null };
    });
    const { result } = renderHook(() => useProSubscription());
    await waitFor(() => expect(result.current.pro.loading).toBe(false));
    await act(async () => { await result.current.subscribe("member@example.com"); });
    expect(h.toasts).toHaveLength(1);
    expect(h.toasts[0].title).toBe("This address already has a Pro plan");
    expect(h.toasts[0].description).toMatch(/isn't linked to this account yet/);
    expect(JSON.stringify(h.toasts)).not.toMatch(/already active on this account/);
  });

  it("a plan that is live on this account still hears it is a member", async () => {
    h.invoke.mockImplementation(async (fn: string) => {
      if (fn === "check-subscription") return { data: { active: true, status: "active" }, error: null };
      if (fn === "create-subscription-checkout") return { data: { alreadySubscribed: true, tier: "pro" }, error: null };
      return { data: null, error: null };
    });
    const { result } = renderHook(() => useProSubscription());
    await waitFor(() => expect(result.current.pro.loading).toBe(false));
    await act(async () => { await result.current.subscribe("member@example.com"); });
    expect(h.toasts[0].title).toBe("You're already a Pro member");
  });
});
