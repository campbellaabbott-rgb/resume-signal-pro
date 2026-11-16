/**
 * A SAVED SEARCH'S RHYTHM CAN BE CHANGED WHERE IT IS SHOWN (RC-S13-083).
 *
 * WHAT WAS WRONG. /account said which rhythm each saved-search email mails on
 * (daily for "Alert me" and company watches, weekly for the rest) and offered
 * no way to change it: the only switch was on or off.
 *
 * WHAT HOLDS NOW, mounted with the database faked: the saved-searches card
 * (beside the fit bar, on a row whose email is on) and the emails panel (in
 * place of the old label) each show a daily/weekly select set to the row's
 * rhythm; choosing the other writes digest_cadence with the page's language,
 * as every other write to a saved search does, and a refused write puts the
 * select back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ patch: Record<string, unknown>; id: unknown }>,
  refuse: false,
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
      if (patch) h.updates.push({ patch, id });
      return Promise.resolve(h.refuse && patch && "digest_cadence" in patch ? { data: null, error: { code: "42501", message: "permission denied" } } : { data: null, error: null });
    };
    q.delete = () => q;
    return q;
  };
  return { supabase: { from: (t: string) => chain(t) } };
});
vi.mock("@/lib/invoke-job-board", () => ({ invokeJobBoard: vi.fn(async () => ({ data: { total: 0 } })) }));

import { SavedSearchesCard } from "@/components/account/SavedSearchesCard";
import { NotificationsPanel } from "@/components/account/NotificationsPanel";

beforeEach(() => {
  h.rows = [
    { id: "w", name: "Nurse", params: { q: "nurse" }, last_seen_at: "2026-11-01T00:00:00Z", digest_opt_in: true, fit_threshold: 0, digest_cadence: "weekly" },
    { id: "off", name: "Porter", params: { q: "porter" }, last_seen_at: "2026-11-01T00:00:00Z", digest_opt_in: false, fit_threshold: 0, digest_cadence: "weekly" },
  ];
  h.updates = [];
  h.refuse = false;
});
afterEach(cleanup);

const cadenceWrites = () => h.updates.filter((u) => "digest_cadence" in u.patch);

describe("the saved-searches card", () => {
  it("an emailed weekly search can be switched to daily, written with the page's language", async () => {
    render(<MemoryRouter><SavedSearchesCard /></MemoryRouter>);
    const select = await screen.findByLabelText("How often to email about Nurse") as HTMLSelectElement;
    expect(select.value).toBe("weekly");
    fireEvent.change(select, { target: { value: "daily" } });
    await waitFor(() => expect(cadenceWrites()).toEqual([{ patch: { digest_cadence: "daily", locale: "en" }, id: "w" }]));
    expect(screen.getByLabelText("Turn off daily email for Nurse"), "the bell still says weekly").toBeTruthy();
  });

  it("a search whose email is off shows no rhythm to pick", async () => {
    render(<MemoryRouter><SavedSearchesCard /></MemoryRouter>);
    await screen.findByLabelText("How often to email about Nurse");
    expect(screen.queryByLabelText("How often to email about Porter")).toBeNull();
  });

  it("a refused write puts the select back", async () => {
    h.refuse = true;
    render(<MemoryRouter><SavedSearchesCard /></MemoryRouter>);
    const select = await screen.findByLabelText("How often to email about Nurse") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "daily" } });
    await waitFor(() => expect(cadenceWrites().length).toBeGreaterThan(0));
    await waitFor(() => expect((screen.getByLabelText("How often to email about Nurse") as HTMLSelectElement).value).toBe("weekly"));
  });
});

describe("the emails panel", () => {
  it("each row's rhythm is a select, and choosing daily writes it", async () => {
    render(<NotificationsPanel />);
    const select = await screen.findByLabelText("How often to email about Porter") as HTMLSelectElement;
    expect(select.value).toBe("weekly");
    fireEvent.change(select, { target: { value: "daily" } });
    await waitFor(() => expect(cadenceWrites()).toEqual([{ patch: { digest_cadence: "daily", locale: "en" }, id: "off" }]));
    expect(screen.getByLabelText("Daily email for Porter")).toBeTruthy();
  });
});
