/**
 * A LINK FOR ANOTHER ACCOUNT CLEARS THE FIRST ACCOUNT'S BROWSER DATA
 * (S14X-099).
 *
 * WHAT WAS WRONG. Signed in as A, a person who opened (and said yes to) a
 * link for B had B's session handed straight to the client: adoptSession
 * only called setSession. Nothing A left in this browser went, so A's checkout
 * address, A's credit-purchase ids, A's member mark and the résumé copies of
 * A's tab stayed, and were then used as B's.
 *
 * WHAT HOLDS NOW: before B's session is handed over, adoptSession reads the
 * session this browser holds; when it names another account, everything a
 * deliberate sign-out of A would clear is cleared first, and the shared mark
 * tells A's other tabs to drop their copies too. The same account clears
 * nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const h = vi.hoisted(() => ({
  here: null as null | { user: { id: string; email: string } },
  order: [] as string[],
  heldAtSetSession: null as null | Record<string, string | null>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => { h.order.push("getSession"); return { data: { session: h.here } }; },
      setSession: async () => {
        h.order.push("setSession");
        h.heldAtSetSession = {
          credits: localStorage.getItem("scanCreditsSessions"),
          checkoutEmail: localStorage.getItem("scanCreditsEmail"),
          resume: sessionStorage.getItem("rb_resume_text"),
        };
        return { data: {}, error: null };
      },
      signOut: async () => ({ error: null }),
    },
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));
vi.mock("@/integrations/lovable", () => ({ lovable: { auth: { signInWithOAuth: async () => ({}) } } }));
vi.mock("@/hooks/use-toast", () => ({ toast: () => undefined, useToast: () => ({ toast: () => undefined }) }));

import { AuthProvider, SIGN_OUT_MARK_KEY, useAuth } from "@/contexts/AuthContext";
import { CREDIT_SESSIONS_KEY } from "@/lib/purchase-proofs";
import type { Probed } from "@/lib/auth-probe";

let api: ReturnType<typeof useAuth> | null = null;
function Probe() { api = useAuth(); return null; }

const probed = (id: string, email: string) => ({
  email,
  session: { access_token: `at-${id}`, refresh_token: `rt-${id}`, user: { id, email } },
}) as unknown as Probed;

function fillAsA() {
  localStorage.setItem(CREDIT_SESSIONS_KEY, "[\"cs_live_A_ONLY\"]");
  localStorage.setItem("scanCreditsEmail", "a@example.com");
  localStorage.setItem("rb_last_email", "a@example.com");
  sessionStorage.setItem("rb_resume_text", "Alex A. résumé");
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  h.here = { user: { id: "user-a", email: "a@example.com" } };
  h.order = [];
  h.heldAtSetSession = null;
  api = null;
});
afterEach(cleanup);

describe("S14X-099: adopting another account's session", () => {
  it("clears what account A left here BEFORE B's session is handed over, and marks the sign-out for A's other tabs", async () => {
    expect(CREDIT_SESSIONS_KEY).toBe("scanCreditsSessions");
    fillAsA();
    render(<AuthProvider><Probe /></AuthProvider>);
    let res: unknown;
    await act(async () => { res = await api!.adoptSession(probed("user-b", "b@example.com")); });
    expect(h.heldAtSetSession, "account A's credits, address and résumé were handed to account B").toEqual({ credits: null, checkoutEmail: null, resume: null });
    expect(h.order.lastIndexOf("getSession")).toBeLessThan(h.order.indexOf("setSession"));
    expect(localStorage.getItem("rb_last_email")).toBeNull();
    expect(Number(localStorage.getItem(SIGN_OUT_MARK_KEY))).toBeGreaterThan(0);
    expect(res).toBe("ok");
  });

  it("the same account clears nothing", async () => {
    fillAsA();
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { await api!.adoptSession(probed("user-a", "a@example.com")); });
    expect(h.heldAtSetSession).toEqual({ credits: "[\"cs_live_A_ONLY\"]", checkoutEmail: "a@example.com", resume: "Alex A. résumé" });
    expect(localStorage.getItem(SIGN_OUT_MARK_KEY)).toBeNull();
  });

  it("a browser with no session clears nothing", async () => {
    fillAsA();
    h.here = null;
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => { await api!.adoptSession(probed("user-b", "b@example.com")); });
    expect(h.heldAtSetSession?.credits).toBe("[\"cs_live_A_ONLY\"]");
    expect(localStorage.getItem(SIGN_OUT_MARK_KEY)).toBeNull();
  });
});
