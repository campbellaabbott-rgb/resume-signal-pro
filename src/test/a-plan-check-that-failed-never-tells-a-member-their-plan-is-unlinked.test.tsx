/**
 * A PLAN CHECK THAT FAILED NEVER TELLS A MEMBER THEIR PLAN IS UNLINKED (the
 * audit-rest fixer's review of S13-086).
 *
 * WHAT WAS WRONG. When the checkout answered alreadySubscribed, the hook
 * re-read check-subscription and took any answer but "active" as "this
 * address's plan is not linked to this account": a check that timed out, or
 * answered an error, told a member whose plan IS linked to email support to
 * have it linked.
 *
 * WHAT HOLDS NOW: only a read that says linkPending gives the linking note; a
 * read that failed, or one naming neither, says the plan is there and the
 * page will show it on a reload, and names no support step.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  toasts: [] as Array<{ title?: string; description?: string }>,
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

async function pressWith(check: () => Promise<{ data: unknown; error: unknown }>) {
  h.invoke.mockImplementation(async (fn: string) => {
    if (fn === "check-subscription") return check();
    if (fn === "create-subscription-checkout") return { data: { alreadySubscribed: true, tier: "pro" }, error: null };
    return { data: null, error: null };
  });
  const { result } = renderHook(() => useProSubscription());
  await waitFor(() => expect(result.current.pro.loading).toBe(false));
  await act(async () => { await result.current.subscribe("member@example.com"); });
  expect(h.toasts).toHaveLength(1);
  return h.toasts[0];
}

describe("the toast when the checkout says the address already has a plan", () => {
  it("a check that answered an error says the plan is there and to reload, not to have it linked", async () => {
    const t = await pressWith(async () => ({ data: null, error: new Error("FunctionsFetchError: timed out") }));
    expect(t.title).toBe("This address already has a Pro plan");
    expect(t.description).toMatch(/couldn't confirm it on this account just now/);
    expect(t.description).not.toMatch(/isn't linked|Email /);
  });

  it("a check that threw says the same", async () => {
    const t = await pressWith(async () => { throw new Error("network down"); });
    expect(t.description).toMatch(/Reload the page in a moment/);
    expect(t.description).not.toMatch(/isn't linked/);
  });

  it("a check naming neither a live plan nor a pending link names no support step", async () => {
    const t = await pressWith(async () => ({ data: { active: false, linkPending: false }, error: null }));
    expect(t.description).not.toMatch(/isn't linked|Email /);
  });

  it("only a check that says linkPending gives the linking note", async () => {
    const t = await pressWith(async () => ({ data: { active: false, linkPending: true }, error: null }));
    expect(t.description).toMatch(/isn't linked to this account yet/);
  });
});
