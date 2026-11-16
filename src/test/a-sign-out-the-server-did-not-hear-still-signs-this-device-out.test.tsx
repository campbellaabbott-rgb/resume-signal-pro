/**
 * A SIGN-OUT THE SERVER DID NOT HEAR STILL SIGNS THIS DEVICE OUT (S14X-098).
 *
 * WHAT WAS WRONG. signOut ran `try { await supabase.auth.signOut({ scope }) }
 * finally { ... }` and never read the answer. auth-js 2.87.1 returns an error
 * BEFORE it removes the stored session for anything but a 401/403/404, so
 * after a 503 or a dropped connection the session stayed in this browser and
 * SIGNED_OUT never fired, while the page went home as if signed out. A plain
 * retry fails the same way: scope "local" also calls /logout.
 *
 * WHAT HOLDS NOW, with the real supabase-js client (in-memory storage) and a
 * network that answers 503 to /auth/v1/logout: the session is removed from
 * this device anyway, getSession() is empty, SIGNED_OUT is heard, and the
 * person is told the server did not hear it. "Everywhere" says the other
 * devices may still be signed in, and its Try again posts the global logout
 * with the old session's token, which is held in memory only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  calls: [] as Array<{ url: string; method: string; auth: string | null }>,
  logoutStatus: 503,
  toast: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    h.calls.push({ url, method: String(init?.method ?? "GET"), auth: headers.get("authorization") });
    if (url.includes("/auth/v1/logout")) {
      return h.logoutStatus === 0
        ? Promise.reject(new TypeError("Failed to fetch"))
        : new Response(h.logoutStatus === 204 ? null : JSON.stringify({ message: "unavailable" }), { status: h.logoutStatus, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ message: "not here" }), { status: 503, headers: { "content-type": "application/json" } });
  };
  vi.stubGlobal("fetch", fetchImpl);
  return {
    supabase: createClient("https://project.example.test", "publishable-test-key", {
      auth: {
        storageKey: "sb-test-auth-token",
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: {
          getItem: (k: string) => h.store.get(k) ?? null,
          setItem: (k: string, v: string) => { h.store.set(k, v); },
          removeItem: (k: string) => { h.store.delete(k); },
        },
      },
      global: { fetch: fetchImpl as typeof fetch },
    }),
  };
});
vi.mock("@/integrations/lovable", () => ({ lovable: { auth: { signInWithOAuth: async () => ({}) } } }));
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => h.toast(...a), useToast: () => ({ toast: h.toast }) }));

import { supabase } from "@/integrations/supabase/client";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const exp = Math.floor(Date.now() / 1000) + 3600;
const ACCESS = `eyJhbGciOiJIUzI1NiJ9.${b64({ sub: "u-1", email: "member@example.com", session_id: "11111111-1111-4111-8111-111111111111", exp, amr: [{ method: "password", timestamp: 1 }] })}.sig`;
const STORED = JSON.stringify({
  access_token: ACCESS, refresh_token: "rt-1", token_type: "bearer", expires_in: 3600, expires_at: exp,
  user: { id: "u-1", email: "member@example.com", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
});

let api: ReturnType<typeof useAuth> | null = null;
function Probe() {
  api = useAuth();
  return null;
}

const events: string[] = [];
beforeEach(() => {
  h.store.clear();
  h.store.set("sb-test-auth-token", STORED);
  h.calls.length = 0;
  h.logoutStatus = 503;
  h.toast.mockReset();
  localStorage.clear();
  events.length = 0;
  api = null;
});
afterEach(cleanup);

async function mounted() {
  const { data } = supabase.auth.onAuthStateChange((e) => { events.push(e); });
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(api?.session?.access_token).toBe(ACCESS));
  return () => data.subscription.unsubscribe();
}

const toastText = () => h.toast.mock.calls.map((c) => `${(c[0] as { title?: string }).title ?? ""} ${(c[0] as { description?: string }).description ?? ""}`).join(" | ");

describe("S14X-098: the server did not hear the sign-out", () => {
  it("this device is signed out anyway: the stored session is gone, getSession is empty, SIGNED_OUT is heard, and the person is told", async () => {
    const stop = await mounted();
    await act(async () => { await api!.signOut(); });
    expect(h.calls.some((c) => c.url.includes("/auth/v1/logout") && c.method === "POST"), "the server was asked").toBe(true);
    expect(h.store.has("sb-test-auth-token"), "the session stayed in this browser after the server failed to hear the sign-out").toBe(false);
    expect((await supabase.auth.getSession()).data.session).toBeNull();
    expect(events).toContain("SIGNED_OUT");
    await waitFor(() => expect(api?.session).toBeNull());
    await waitFor(() => expect(toastText()).toMatch(/signed out on this device, but we couldn't reach the server/));
    stop();
  });

  it("a dropped connection is read the same way", async () => {
    h.logoutStatus = 0;
    const stop = await mounted();
    await act(async () => { await api!.signOut(); });
    expect(h.store.has("sb-test-auth-token")).toBe(false);
    expect(events).toContain("SIGNED_OUT");
    stop();
  });

  it("everywhere says the other devices may still be signed in, and Try again posts the global logout with the old token", async () => {
    const stop = await mounted();
    await act(async () => { await api!.signOutEverywhere(); });
    expect(h.store.has("sb-test-auth-token")).toBe(false);
    await waitFor(() => expect(toastText()).toMatch(/may still be signed in/));
    const notice = h.toast.mock.calls.find((c) => /may still be signed in/.test(String((c[0] as { description?: string }).description)))![0] as { action?: { label: string; onClick: () => void } };
    expect(notice.action?.label).toBe("Try again");
    h.calls.length = 0;
    h.logoutStatus = 204;
    await act(async () => { notice.action!.onClick(); await new Promise((r) => setTimeout(r, 20)); });
    const logouts = h.calls.filter((c) => c.url.includes("/auth/v1/logout"));
    expect(logouts).toEqual([expect.objectContaining({ method: "POST", auth: `Bearer ${ACCESS}` })]);
    expect(logouts[0].url).toMatch(/\/auth\/v1\/logout\?scope=global$/);
    await waitFor(() => expect(toastText()).toMatch(/signed out on every device/));
    stop();
  });

  it("a sign-out the server heard says nothing more", async () => {
    h.logoutStatus = 204;
    const stop = await mounted();
    await act(async () => { await api!.signOut(); });
    expect(h.store.has("sb-test-auth-token")).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(toastText()).not.toMatch(/couldn't reach the server/);
    stop();
  });
});
