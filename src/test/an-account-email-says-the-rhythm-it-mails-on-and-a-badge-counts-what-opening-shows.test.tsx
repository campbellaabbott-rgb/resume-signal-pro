/**
 * AN ACCOUNT EMAIL SAYS THE RHYTHM IT MAILS ON, AND A BADGE COUNTS WHAT
 * OPENING THE SEARCH SHOWS (S13-083, S13-118).
 *
 * S13-083. The "Alert me" and watch-company saves on /jobs are stored with
 * digest_cadence 'daily', and the digest mails each row on its own cadence.
 * /account called every one of them "weekly": the panel's summary and row
 * label, and the bell's label and title on the saved-searches card.
 *
 * S13-118. A search saved under the board's old "agent-ready" filter carries
 * sendableOnly. The board drops that filter from a link, so opening the
 * search shows the whole board, while the "new since your last visit" badge
 * counted the narrowed one. The badge and the link now read the same params.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  selects: [] as string[],
  bodies: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    const result = () => (table === "user_job_searches" ? { data: h.rows, error: null } : { data: null, error: null });
    q.select = (cols: string) => { h.selects.push(`${table}:${cols}`); return q; };
    q.order = () => q;
    q.limit = () => Promise.resolve(result());
    q.maybeSingle = () => Promise.resolve({ data: null, error: null });
    q.update = () => q;
    q.eq = () => Promise.resolve({ data: null, error: null });
    q.delete = () => q;
    return q;
  };
  return { supabase: { from: (t: string) => chain(t) } };
});
vi.mock("@/lib/invoke-job-board", () => ({
  invokeJobBoard: vi.fn(async ({ body }: { body: Record<string, unknown> }) => { h.bodies.push(body); return { data: { total: 7 } }; }),
}));

import { SavedSearchesCard } from "@/components/account/SavedSearchesCard";
import { NotificationsPanel } from "@/components/account/NotificationsPanel";

beforeEach(() => {
  h.rows = [
    { id: "a", name: "Watch: Acme", params: { company: "acme" }, last_seen_at: "2026-10-30T00:00:00Z", digest_opt_in: true, fit_threshold: 0, digest_cadence: "daily" },
    { id: "b", name: "nurse · agent-ready", params: { q: "nurse", sendableOnly: true }, last_seen_at: "2026-10-30T00:00:00Z", digest_opt_in: true, fit_threshold: 0, digest_cadence: "weekly" },
  ];
  h.selects = [];
  h.bodies = [];
});
afterEach(cleanup);

describe("the saved-searches card (S13-083, S13-118)", () => {
  it("reads each row's cadence and says daily on a daily row and weekly on a weekly one", async () => {
    render(<MemoryRouter><SavedSearchesCard /></MemoryRouter>);
    expect(await screen.findByLabelText("Turn off daily email for Watch: Acme")).toBeTruthy();
    expect(screen.getByLabelText("Turn off weekly email for nurse · agent-ready")).toBeTruthy();
    expect(screen.getByTitle("Daily email on — click to turn off")).toBeTruthy();
    expect(h.selects.some((s) => /user_job_searches:.*digest_cadence/.test(s))).toBe(true);
    expect(screen.queryByText(/to get a weekly email when fresh jobs match/)).toBeNull();
  });

  it("counts an old agent-ready search on the board its link opens, not the narrowed one", async () => {
    render(<MemoryRouter><SavedSearchesCard /></MemoryRouter>);
    await waitFor(() => expect(h.bodies.length).toBe(2));
    const nurse = h.bodies.find((b) => b.q === "nurse")!;
    expect(nurse.sendableOnly).toBeUndefined();
    expect(nurse.countOnly).toBe(true);
    // The employer scope is untouched.
    expect(h.bodies.find((b) => Array.isArray(b.companies))?.companies).toEqual(["acme"]);
  });
});

describe("the emails panel (S13-083)", () => {
  it("labels each search with the rhythm it mails on, and the summary names no rhythm", async () => {
    render(<NotificationsPanel />);
    expect(await screen.findByText("daily digest")).toBeTruthy();
    expect(screen.getByText("weekly digest")).toBeTruthy();
    expect(screen.getByLabelText("Daily email for Watch: Acme")).toBeTruthy();
    expect(screen.getByText("2 of 2 search emails on")).toBeTruthy();
    expect(screen.queryByText(/weekly digests on/)).toBeNull();
  });
});
