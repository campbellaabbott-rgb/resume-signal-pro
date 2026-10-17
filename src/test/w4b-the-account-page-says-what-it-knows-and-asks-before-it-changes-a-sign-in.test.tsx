/**
 * THE ACCOUNT PAGE SAYS WHAT IT KNOWS, AND ASKS BEFORE IT CHANGES A SIGN-IN
 * (S12-002, S12-025, S12-060, S12-137, S12-155; D9).
 *
 * WHAT WAS WRONG.
 *   S12-002  The credits and purchases card told every unproven account to
 *            "sign in with Google using it"; no Google control existed.
 *   S12-155  A failed get-account-data read showed "0 credits, no purchases".
 *   S12-060  An email change applied the moment it was typed, with no
 *            password and no second entry, while the page said "check both
 *            inboxes"; a password change asked for nothing either.
 *   S12-025  The scans run before signing up came in without their checklist,
 *            under one flag per browser.
 *   S12-137  The delete card, the settings and the checklist were English in
 *            every locale; the delete card named no list of what is kept.
 *
 * WHAT HOLDS NOW, mounted with the network faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

const calls: string[] = [];
const authState = { passwordOk: true, reauthError: null as null | { message: string } };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    auth: {
      signInWithPassword: async () => { calls.push("signInWithPassword"); return { data: {}, error: authState.passwordOk ? null : { message: "Invalid login credentials" } }; },
      updateUser: async (attrs: Record<string, unknown>) => { calls.push(`updateUser:${Object.keys(attrs).sort().join(",")}`); return { data: {}, error: null }; },
      reauthenticate: async () => { calls.push("reauthenticate"); return { data: {}, error: authState.reauthError }; },
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u-1", email: "member@example.com" },
    session: { access_token: "t" },
    signOut: async () => { calls.push("signOut"); },
    signOutEverywhere: async () => { calls.push("signOutEverywhere"); },
    ensureGuard: async () => { calls.push("ensureGuard"); return { state: "done" }; },
  }),
}));

import { CreditsAndPurchases } from "@/components/account/CreditsAndPurchases";
import { SecurityCard } from "@/components/account/SecurityCard";
import { DataPrivacyCard } from "@/components/account/DataPrivacyCard";
import { importFlagKey, importLocalHistory, LOCAL_HISTORY_KEY } from "@/lib/account-history-import";

let autoconfirm = true;
beforeEach(() => {
  calls.length = 0;
  authState.passwordOk = true;
  autoconfirm = true;
  vi.stubGlobal("fetch", vi.fn(async (u: string) => (String(u).endsWith("/auth/v1/settings")
    ? new Response(JSON.stringify({ mailer_autoconfirm: autoconfirm }), { status: 200 })
    : new Response("{}", { status: 404 }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const page = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

describe("S12-002: the purchases card names no control that is not there", () => {
  it("an unproven account is told how to open its purchases, and never to use Google", () => {
    page(<CreditsAndPurchases fetching={false} email="member@example.com" account={{ credits: 0, purchases: [], passes: [], orders: [], mailboxProven: false }} />);
    expect(document.body.textContent).not.toMatch(/google/i);
    expect(document.body.textContent).toMatch(/open each purchase from the link in its email/);
  });

  it("orders show their status, amount and a link that opens the purchase", () => {
    page(<CreditsAndPurchases fetching={false} email="m@example.com" account={{
      credits: 2, purchases: [], passes: [], mailboxProven: true,
      orders: [
        { id: "cs_live_aaaaaaaaaa", sessionId: "cs_live_aaaaaaaaaa", product: "Full Resume Analysis", productType: "full_analysis", date: "2026-10-01T10:00:00Z", status: "ready", amountCents: 500, currency: "usd" },
        { id: "cs_live_bbbbbbbbbb", sessionId: "cs_live_bbbbbbbbbb", product: "Cover Letter", productType: "cover_letter", date: "2026-10-02T10:00:00Z", status: "needs_resume", amountCents: 400, currency: "usd" },
        { id: "grant:g1", sessionId: null, product: "Full Resume Analysis", productType: "full_analysis", date: "2026-10-03T10:00:00Z", status: "included", amountCents: 0, currency: null },
      ],
    }} />);
    const ready = document.querySelector('[data-order="cs_live_aaaaaaaaaa"]')!;
    expect(ready.querySelector("[data-status]")!.textContent).toBe("Ready");
    expect(ready.textContent).toMatch(/\$5\.00/);
    expect(ready.querySelector("a")!.getAttribute("href")).toBe("/success?session_id=cs_live_aaaaaaaaaa");
    expect(document.querySelector('[data-order="cs_live_bbbbbbbbbb"] [data-status]')!.textContent).toBe("Needs your résumé");
    expect(document.querySelector('[data-order="cs_live_bbbbbbbbbb"] a')!.getAttribute("href")).toBe("/product-success?session_id=cs_live_bbbbbbbbbb&product=coverLetter");
    expect(document.querySelector('[data-order="grant:g1"] [data-status]')!.textContent).toBe("Included with Pro");
  });

  it("each bought order offers Report a problem: a mail to support naming the product, the day and the last eight characters, never the whole session id", () => {
    page(<CreditsAndPurchases fetching={false} email="m@example.com" account={{
      credits: 0, purchases: [], passes: [], mailboxProven: true,
      orders: [
        { id: "cs_live_a1b2c3d4e5f6g7h8", sessionId: "cs_live_a1b2c3d4e5f6g7h8", product: "Full Resume Analysis", productType: "full_analysis", date: "2026-10-01T10:00:00Z", status: "failed", amountCents: 500, currency: "usd" },
        { id: "grant:g1", sessionId: null, product: "Full Resume Analysis", productType: "full_analysis", date: "2026-10-03T10:00:00Z", status: "included", amountCents: 0, currency: null },
      ],
    }} />);
    const link = document.querySelector('[data-order="cs_live_a1b2c3d4e5f6g7h8"] [data-report-problem]') as HTMLAnchorElement;
    expect(link.textContent).toBe("Report a problem");
    const href = link.getAttribute("href")!;
    expect(href.startsWith("mailto:")).toBe(true);
    const subject = decodeURIComponent(href.split("subject=")[1]);
    expect(subject).toBe("A problem with my order · Full Resume Analysis · 2026-10-01 · e5f6g7h8");
    expect(href).not.toContain("cs_live_a1b2c3d4e5f6g7h8");
    expect(document.querySelector('[data-order="grant:g1"] [data-report-problem]')).toBeNull();
  });

  it("scan packs are not sold here any more", () => {
    page(<CreditsAndPurchases fetching={false} email="m@example.com" account={{ credits: 0, purchases: [], passes: [], orders: [], mailboxProven: true }} />);
    expect(screen.queryByRole("button", { name: /get more credits/i })).toBeNull();
  });
});

describe("S12-155: a failed read is said, never shown as nothing", () => {
  it("says it could not load, offers Try again, and shows no zero", () => {
    const retry = vi.fn();
    page(<CreditsAndPurchases fetching={false} email="m@example.com" account={null} failed onRetry={retry} />);
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't load your credits and purchases/);
    expect(document.body.textContent).not.toMatch(/No purchases yet/);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("S12-060: a sign-in changes only after the account proves it is the account", () => {
  it("while the server confirms addresses on its own, there is no address change, and the card says how to get one", async () => {
    autoconfirm = true;
    page(<SecurityCard />);
    await waitFor(() => expect(document.querySelector("[data-email-change-hidden]")!.textContent).toMatch(/Write to/));
    expect(document.querySelector("[data-email-change]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/check both inboxes/i);
  });

  it("once the server asks both addresses, the change needs the current password and the address twice", async () => {
    autoconfirm = false;
    page(<SecurityCard />);
    await waitFor(() => expect(document.querySelector("[data-email-change]")).not.toBeNull());
    fireEvent.change(screen.getByLabelText("New address"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("New address again"), { target: { value: "neu@example.com" } });
    fireEvent.change(screen.getByLabelText("Current password, to change your address"), { target: { value: "hunter22" } });
    const update = document.querySelectorAll("[data-email-change] button")[0] as HTMLButtonElement;
    await act(async () => { fireEvent.click(update); });
    expect(screen.getByText("The two addresses don't match.")).toBeTruthy();
    expect(calls).toEqual([]);
    fireEvent.change(screen.getByLabelText("New address again"), { target: { value: "new@example.com" } });
    await act(async () => { fireEvent.click(update); });
    expect(calls).toEqual(["signInWithPassword", "updateUser:email"]);
    expect(screen.getByText(/asked both your current and your new address to confirm/)).toBeTruthy();
  });

  it("a password change with a wrong current password changes nothing; a right one waits for the guard first", async () => {
    page(<SecurityCard />);
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "wrong-one" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a-new-password" } });
    authState.passwordOk = false;
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Update" })[0]); });
    expect(screen.getByText("That isn't your current password.")).toBeTruthy();
    expect(calls.some((c) => c.startsWith("updateUser"))).toBe(false);
    authState.passwordOk = true;
    calls.length = 0;
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Update" })[0]); });
    expect(calls).toEqual(["ensureGuard", "signInWithPassword", "updateUser:password"]);
  });

  it("with no password, a mailed confirmation code goes with the change", async () => {
    page(<SecurityCard />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Email me a confirmation code instead/ })); });
    expect(calls).toEqual(["reauthenticate"]);
    fireEvent.change(screen.getByLabelText("Confirmation code from the email"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a-new-password" } });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Update" })[0]); });
    expect(calls).toEqual(["reauthenticate", "ensureGuard", "updateUser:nonce,password"]);
  });

  it("signs out of this device, or everywhere", async () => {
    page(<SecurityCard />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign out everywhere" })); });
    expect(calls).toContain("signOutEverywhere");
  });
});

describe("D9 / S12-137: the delete card says what goes and what stays, in t() strings", () => {
  it("lists what is deleted, cancelled and kept, and shows a refusal's own words", async () => {
    const onDelete = vi.fn(async () => ["accountPage.deleteRetry"]);
    page(<DataPrivacyCard onExport={() => undefined} onDelete={onDelete} />);
    const terms = document.querySelector("[data-delete-terms]")!.textContent!;
    expect(terms).toMatch(/API and connected-AI keys, which stop working/);
    expect(terms).toMatch(/Kept: payment records/);
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yes, delete my account" })); });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-delete-refusal]")!.textContent).toMatch(/Your account was not deleted/);
  });
});

describe("S12-025: the scans run before signing up come in with their checklist, once per account", () => {
  type Row = Record<string, unknown>;
  const fakeDb = (rows: Row[]) => {
    const inserted: Row[][] = [];
    return {
      inserted,
      db: {
        from: () => ({
          insert: async (r: Row[]) => { inserted.push(r); rows.push(...r); return { error: null }; },
          select: () => ({ order: () => ({ limit: async () => ({ data: [...rows].reverse() }) }) }),
        }),
      },
    };
  };
  const local = {
    entries: [
      { id: "1", timestamp: "2026-10-01T10:00:00.000Z", atsScore: 61, industry: "healthcare", redFlagCount: 3, jobTitle: "Charge Nurse", jobCompany: "Acme Health",
        checklist: [{ id: "q", label: "Add your BLS certification", completed: true, category: "quick_win" }, { id: "k", label: "Add keyword: triage", completed: false, category: "keywords" }] },
      { id: "2", timestamp: "2026-10-02T10:00:00.000Z", atsScore: 70, industry: "healthcare" },
    ],
  };

  it("carries the checklist and the job, skips what the account holds, and flags only this account", async () => {
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(local));
    localStorage.setItem("scan_history_imported", "1"); // another person's import on this browser
    const held = [{ created_at: "2026-10-02T10:00:00.000Z", ats_score: 70 }];
    const { db, inserted } = fakeDb([...held]);
    const out = await importLocalHistory(db, "u-2", held, (r: never) => r);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual([expect.objectContaining({
      user_id: "u-2", ats_score: 61, red_flag_count: 3, label: "Charge Nurse @ Acme Health",
      fix_plan: [{ step: "Add your BLS certification", done: true }, { step: "Add keyword: triage", done: false }],
    })]);
    expect(out).toHaveLength(2);
    expect(localStorage.getItem(importFlagKey("u-2"))).toBe("1");
    const again = fakeDb([]);
    await importLocalHistory(again.db, "u-2", [], (r: never) => r);
    expect(again.inserted).toEqual([]);
  });
});
