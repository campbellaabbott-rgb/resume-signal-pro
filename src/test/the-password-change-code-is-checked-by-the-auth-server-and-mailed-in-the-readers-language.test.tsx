/**
 * THE PASSWORD-CHANGE CODE IS CHECKED BY THE AUTH SERVER, AND MAILED IN THE
 * READER'S LANGUAGE (S14X-087, S14X-236).
 *
 * WHAT WAS WRONG. With no current password, the account page's security card
 * mailed a reauthentication code (supabase.auth.reauthenticate) and then sent
 * whatever was typed as the update's nonce. GoTrue v2.197.0 checks a nonce
 * only when "secure password change" is on and the session is over a day
 * old, so for a fresh session ANY text changed the password. The
 * reauthentication mail carries no redirect, so it could only be English, and
 * the address change asked for its two confirmation mails with no redirect
 * either (no &lng for the auth hook to read).
 *
 * WHAT HOLDS NOW: the code comes in a password-reset email whose redirect
 * names the reader's language; the AUTH SERVER checks it (verifyOtp, type
 * recovery), so a wrong one changes nothing; the fresh session then waits for
 * the account guard, and only then is the password set, with no nonce. The
 * address change names the confirm step and the language. No source file
 * calls reauthenticate any more.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import i18next from "i18next";
import { codeOf } from "./helpers/strip-comments";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

const h = vi.hoisted(() => ({
  calls: [] as string[],
  args: {} as Record<string, unknown[]>,
  verify: null as null | { data: { session: unknown }; error: unknown },
  guard: { state: "done", proven: true, passwordCleared: false, signedOut: false, reason: null, status: 200, keysRevoked: [] } as Record<string, unknown>,
  autoconfirm: true,
}));
const record = (name: string, ...a: unknown[]) => { h.calls.push(name); h.args[name] = a; };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: async (...a: unknown[]) => { record("resetPasswordForEmail", ...a); return { data: {}, error: null }; },
      verifyOtp: async (p: { type: string }) => { record(`verifyOtp:${p.type}`, p); return h.verify ?? { data: { session: null }, error: { message: "Token has expired or is invalid" } }; },
      updateUser: async (attrs: Record<string, unknown>, opts?: unknown) => { record(`updateUser:${Object.keys(attrs).sort().join(",")}`, attrs, opts); return { data: {}, error: null }; },
      reauthenticate: async () => { record("reauthenticate"); return { data: {}, error: null }; },
      signInWithPassword: async () => { record("signInWithPassword"); return { data: {}, error: null }; },
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));
vi.mock("@/contexts/AuthContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/contexts/AuthContext")>()),
  useAuth: () => ({
    user: { id: "u-1", email: "member@example.com" },
    session: { access_token: "t" },
    signOut: async () => undefined,
    signOutEverywhere: async () => undefined,
    ensureGuard: async () => { h.calls.push("ensureGuard"); return h.guard; },
  }),
}));
vi.mock("@/integrations/lovable", () => ({ lovable: { auth: { signInWithOAuth: async () => ({}) } } }));

import { SecurityCard } from "@/components/account/SecurityCard";

vi.setConfig(MOUNT_TEST_BUDGET);

const ROOT = resolve(__dirname, "../..");
const setLanguage = (lng: string) => Object.defineProperty(i18next, "language", { value: lng, configurable: true, writable: true });
const was = i18next.language;

beforeEach(() => {
  h.calls.length = 0;
  h.args = {};
  h.verify = null;
  h.guard = { state: "done", proven: true, passwordCleared: false, signedOut: false, reason: null, status: 200, keysRevoked: [] };
  h.autoconfirm = true;
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (u: string) => (String(u).endsWith("/auth/v1/settings")
    ? new Response(JSON.stringify({ mailer_autoconfirm: h.autoconfirm }), { status: 200 })
    : new Response("{}", { status: 404 }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLanguage(was); });

const page = () => render(<MemoryRouter><SecurityCard /></MemoryRouter>);
const press = async (name: RegExp | string) => { await act(async () => { fireEvent.click(screen.getAllByRole("button", { name })[0]); }); };
async function codeFlow(code: string) {
  page();
  await press(/Email me a code instead/);
  fireEvent.change(screen.getByLabelText("Code from the password-reset email"), { target: { value: code } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a-new-password" } });
  h.calls.length = 0;
  await press("Update");
}

describe("S14X-087: the code is the auth server's to check", () => {
  it("the code comes in a password-reset email, in the reader's language, and this browser is marked as having asked", async () => {
    setLanguage("es");
    page();
    await press(/Email me a code instead/);
    expect(h.calls).toEqual(["resetPasswordForEmail"]);
    const [email, opts] = h.args.resetPasswordForEmail as [string, { redirectTo: string }];
    expect(email).toBe("member@example.com");
    expect(opts.redirectTo).toBe(`${window.location.origin}/auth?mode=reset&lng=es`);
    expect(JSON.parse(localStorage.getItem("rb_auth_pending") ?? "null")).toMatchObject({ next: "/account", email: "member@example.com" });
    expect(screen.getByRole("status")).toHaveTextContent("a password-reset email with a 6-digit code is on its way to member@example.com");
  });

  it("a wrong code changes nothing", async () => {
    await codeFlow("x");
    expect(h.calls).toEqual(["verifyOtp:recovery"]);
    expect(screen.getByRole("status")).toHaveTextContent("That code didn't work, so your password was not changed.");
  });

  it("a right code: the auth server checks it, the guard answers, then the password is set with no nonce", async () => {
    h.verify = { data: { session: { access_token: "recovery-token", user: { id: "u-1", email: "member@example.com" } } }, error: null };
    await codeFlow("123456");
    expect(h.calls).toEqual(["verifyOtp:recovery", "ensureGuard", "updateUser:password"]);
    expect(h.args["verifyOtp:recovery"][0]).toEqual({ email: "member@example.com", token: "123456", type: "recovery" });
    expect(h.args["updateUser:password"][0]).toEqual({ password: "a-new-password" });
    expect(screen.getByRole("status")).toHaveTextContent("Password changed.");
  });

  it("a guard that ended every session, could not answer, or refused stops the change; the auth log's unconfirmed answer lets it through", async () => {
    h.verify = { data: { session: { access_token: "recovery-token" } }, error: null };
    h.guard = { state: "done", proven: true, signedOut: true };
    await codeFlow("123456");
    expect(h.calls).not.toContain("updateUser:password");
    expect(screen.getByRole("status")).toHaveTextContent("every device was signed out");
    cleanup();

    h.guard = { state: "failed", proven: false, status: 503, reason: "unavailable" };
    await codeFlow("123456");
    expect(h.calls).not.toContain("updateUser:password");
    expect(screen.getByRole("status")).toHaveTextContent("We couldn't confirm your address just now");
    cleanup();

    h.guard = { state: "done", proven: false, reason: "stale_session" };
    await codeFlow("123456");
    expect(h.calls).not.toContain("updateUser:password");
    expect(screen.getByRole("status")).toHaveTextContent("We couldn't confirm your address with that code");
    cleanup();

    h.guard = { state: "failed", proven: false, status: 409, reason: "audit_unconfirmed" };
    await codeFlow("123456");
    expect(h.calls).toEqual(["verifyOtp:recovery", "ensureGuard", "updateUser:password"]);
  });

  it("no source file asks the auth server for a reauthentication code", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const files = walk(resolve(ROOT, "src")).filter((p) => /\.(ts|tsx)$/.test(p) && !p.includes(`${join("src", "test")}`));
    expect(files.length).toBeGreaterThan(100);
    const hits = files.filter((p) => /\.auth\.reauthenticate\(/.test(codeOf(readFileSync(p, "utf8")))).map((p) => relative(ROOT, p));
    expect(hits).toEqual([]);
  });
});

describe("S14X-236: the address change names its confirm step and the reader's language", () => {
  it("both confirmation mails are asked for with a redirect the auth hook reads the language from", async () => {
    setLanguage("fr");
    h.autoconfirm = false;
    page();
    await waitFor(() => expect(document.querySelector("[data-email-change]")).not.toBeNull());
    fireEvent.change(screen.getByLabelText("New address"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("New address again"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Current password, to change your address"), { target: { value: "hunter22" } });
    await act(async () => { fireEvent.click(document.querySelectorAll("[data-email-change] button")[0] as HTMLButtonElement); });
    expect(h.calls).toEqual(["signInWithPassword", "updateUser:email"]);
    const [attrs, opts] = h.args["updateUser:email"] as [unknown, { emailRedirectTo?: string } | undefined];
    expect(attrs).toEqual({ email: "new@example.com" });
    expect(opts?.emailRedirectTo).toMatch(/\/auth\?mode=confirm.*lng=fr/);
  });
});
