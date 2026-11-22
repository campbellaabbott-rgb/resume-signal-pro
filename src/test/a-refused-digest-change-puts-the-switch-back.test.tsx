/**
 * A REFUSED DIGEST CHANGE PUTS THE SWITCH BACK (S10-160).
 *
 * WHAT WAS WRONG. writeWithDigestLocale returns PostgREST's answer, so a
 * write the database refuses RESOLVES with {error}; it rejects only when the
 * network fails. On /account's saved-searches card the email bell undid
 * itself only on a rejection, and the fit bar ignored both, so a refused
 * change left the bell saying the email alert was on (or off) and the bar
 * showing a value that was never saved: a person could wait for alerts that
 * would never come.
 *
 * WHAT HOLDS NOW, mounted with the database faked: a refusal, resolved or
 * rejected, puts the control back as it was and says the change was not
 * saved; an accepted write keeps the new value and says nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import accountEn from "../i18n/shards/account/en.json";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ patch: Record<string, unknown>; id: unknown }>,
  answer: "ok" as "ok" | "refused" | "offline",
  toasts: [] as string[],
}));

vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, {
    error: (m: string) => { h.toasts.push(m); },
    success: () => undefined,
  }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    const result = () => (table === "user_job_searches" ? { data: h.rows, error: null } : { data: null, error: null });
    q.select = () => q;
    q.order = () => q;
    q.limit = () => Promise.resolve(result());
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.update = (p: Record<string, unknown>) => { patch = p; return q; };
    q.eq = (_c: string, id: unknown) => {
      if (!patch) return Promise.resolve(result());
      h.updates.push({ patch, id });
      // last_seen_at (opening a search) is never refused here: only the
      // controls this file judges are.
      if ("last_seen_at" in patch || h.answer === "ok") return Promise.resolve({ data: null, error: null });
      if (h.answer === "offline") return Promise.reject(new TypeError("Failed to fetch"));
      return Promise.resolve({ data: null, error: { code: "42501", message: "permission denied for table user_job_searches" } });
    };
    q.delete = () => q;
    return q;
  };
  return { supabase: { from: (t: string) => chain(t) } };
});
vi.mock("@/lib/invoke-job-board", () => ({ invokeJobBoard: vi.fn(async () => ({ data: { total: 0 } })) }));

import { SavedSearchesCard } from "@/components/account/SavedSearchesCard";

beforeEach(() => {
  h.rows = [
    { id: "off", name: "Porter", params: { q: "porter" }, last_seen_at: "2026-11-01T00:00:00Z", digest_opt_in: false, fit_threshold: 0, digest_cadence: "weekly" },
    { id: "on", name: "Nurse", params: { q: "nurse" }, last_seen_at: "2026-11-01T00:00:00Z", digest_opt_in: true, fit_threshold: 0, digest_cadence: "weekly" },
  ];
  h.updates = [];
  h.answer = "ok";
  h.toasts = [];
});
afterEach(cleanup);

const mount = () => render(<MemoryRouter><SavedSearchesCard /></MemoryRouter>);
const writesOf = (field: string) => h.updates.filter((u) => field in u.patch);
const SAVE_FAILED = accountEn.accountView.digestSaveFailed;

describe("S10-160: a refused email-alert change puts the bell back and says so", () => {
  it("turning a search's email on, refused with an answer, leaves it off", async () => {
    h.answer = "refused";
    mount();
    fireEvent.click(await screen.findByLabelText("Email me weekly about Porter"));
    await waitFor(() => expect(writesOf("digest_opt_in")).toHaveLength(1));
    await waitFor(() => expect(screen.getByLabelText("Email me weekly about Porter")).toBeTruthy());
    expect(screen.queryByLabelText("Turn off weekly email for Porter")).toBeNull();
    expect(h.toasts).toEqual([SAVE_FAILED]);
  });

  it("turning a search's email off, refused with an answer, leaves it on", async () => {
    h.answer = "refused";
    mount();
    fireEvent.click(await screen.findByLabelText("Turn off weekly email for Nurse"));
    await waitFor(() => expect(writesOf("digest_opt_in")).toHaveLength(1));
    await waitFor(() => expect(screen.getByLabelText("Turn off weekly email for Nurse")).toBeTruthy());
    expect(h.toasts).toEqual([SAVE_FAILED]);
  });

  it("a network failure puts the bell back too, and says so", async () => {
    h.answer = "offline";
    mount();
    fireEvent.click(await screen.findByLabelText("Email me weekly about Porter"));
    await waitFor(() => expect(h.toasts).toEqual([SAVE_FAILED]));
    expect(screen.getByLabelText("Email me weekly about Porter")).toBeTruthy();
  });

  it("positive control: an accepted change keeps the bell on and says nothing", async () => {
    mount();
    fireEvent.click(await screen.findByLabelText("Email me weekly about Porter"));
    await waitFor(() => expect(writesOf("digest_opt_in")).toHaveLength(1));
    expect(await screen.findByLabelText("Turn off weekly email for Porter")).toBeTruthy();
    expect(h.toasts).toEqual([]);
  });
});

describe("S10-160: a refused fit bar goes back to the value that was saved", () => {
  it("Strong fit only, refused with an answer, reads Any new again", async () => {
    h.answer = "refused";
    mount();
    const bar = await screen.findByLabelText("Minimum fit for Nurse email alerts") as HTMLSelectElement;
    fireEvent.change(bar, { target: { value: "20" } });
    await waitFor(() => expect(writesOf("fit_threshold")).toHaveLength(1));
    await waitFor(() => expect((screen.getByLabelText("Minimum fit for Nurse email alerts") as HTMLSelectElement).value).toBe("0"));
    expect(h.toasts).toEqual([SAVE_FAILED]);
  });

  it("positive control: an accepted bar keeps Strong fit only", async () => {
    mount();
    const bar = await screen.findByLabelText("Minimum fit for Nurse email alerts") as HTMLSelectElement;
    fireEvent.change(bar, { target: { value: "20" } });
    await waitFor(() => expect(writesOf("fit_threshold")).toHaveLength(1));
    expect((screen.getByLabelText("Minimum fit for Nurse email alerts") as HTMLSelectElement).value).toBe("20");
    expect(h.toasts).toEqual([]);
  });
});
