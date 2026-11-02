/**
 * A POSTING THE BOARD OPENED BY ITSELF IS NOT ONE THE READER CHOSE
 * (sweep S12-012 and S12-033, 2026-10-31).
 *
 * At 1024px and wider the board opens its top card so the right column is
 * never empty. That open was treated as a choice the reader made:
 *
 *   S12-012  it wrote ?job=<top> into the address by replace. A card clicked
 *            next pushed an entry on top of that one, so closing it popped
 *            back onto an entry that still said ?job=<top>, and the pop
 *            handler returned early on any ?job= entry: the address kept the
 *            stale posting and the filters from before, the "I pushed an
 *            entry" flag stayed up, the next open replaced instead of
 *            pushing, and its close called history.back() off the board.
 *            Arrowing (a replace write) before a click did the same.
 *   S12-033  it marked the top card viewed, put it in "Jump back in", kept it
 *            open across a new search, and Enter opened its application.
 *
 * Behavioural, with the board mocked and the media query answering desktop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [], error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}
import Jobs from "../pages/Jobs";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 6000 } as const;
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const row = (n: number, token: string, title: string, salary: boolean) => ({
  id: `greenhouse:${token}:${n}`, source: "greenhouse", token, company: token[0].toUpperCase() + token.slice(1),
  title, location: "Leeds, UK", country: "GB",
  salary: salary ? "£40,000" : null, salaryMinAnnual: salary ? 40000 : null, salaryMaxAnnual: null,
  salaryPeriod: salary ? "year" : null, salaryCurrency: salary ? "GBP" : null,
  workMode: "onsite", employmentType: "full_time", experienceBand: "mid", minYears: 3, category: "engineering", department: null,
  postedAt: ago(n), lastSeen: ago(0), recheckedAt: ago(0), applyUrl: `https://apply.example/${token}/${n}`, remote: false,
});
const ROWS = [
  row(1, "acme", "Staff Engineer", true),
  row(2, "beta", "Warehouse Associate", false),
  row(3, "gamma", "Quiet Role", true),
  row(4, "delta", "Data Analyst", true),
];
// Under "States pay" the mock answers a different order, so the list's top changes.
const PAY_ROWS = [ROWS[3], ROWS[2], ROWS[0]];

let matchMedia: typeof window.matchMedia;
let openSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  matchMedia = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: /min-width:\s*1024px/.test(q), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  // jsdom lays nothing out; the keyboard handler scrolls the new pick into view.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  invoke.mockReset();
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn !== "job-board") return { data: {} };
    if (b.action === "detail") return { data: { job: ROWS.find((r) => r.id === b.id) ?? null, description: "" } };
    if (b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: 4 } };
      const rows = b.hasStatedPay === true ? PAY_ROWS : ROWS;
      return { data: { jobs: rows, total: rows.length, totalAllCompanies: rows.length, companies: [], companiesCount: 4, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false } };
    }
    return { data: {} };
  });
});
afterEach(() => { cleanup(); window.matchMedia = matchMedia; openSpy.mockRestore(); });

/** Mounted on /jobs with an entry BEFORE it, so a Back taken one step too far is seen leaving the board. */
function mount() {
  window.history.replaceState({}, "", "/before");
  window.history.pushState({}, "", "/jobs");
  return render(<MemoryRouter initialEntries={["/jobs"]}><Jobs /></MemoryRouter>);
}
const search = () => new URLSearchParams(window.location.search);
const cards = () => Array.from(document.querySelectorAll<HTMLElement>("[data-job-id]"));
const cardFor = (needle: string) => cards().find((c) => (c.textContent ?? "").includes(needle));
const openCard = (needle: string) => {
  const card = cardFor(needle)!;
  const title = Array.from(card.querySelectorAll<HTMLElement>("h2, h3, a, button")).find((el) => (el.textContent ?? "").includes(needle)) ?? card;
  fireEvent.click(title);
};
const detailCalls = () => invoke.mock.calls.filter(([, o]) => (o as { body?: { action?: string } })?.body?.action === "detail").map(([, o]) => (o as { body: { id: string } }).body.id);
const viewed = () => { try { return JSON.parse(localStorage.getItem("rb_viewed_jobs") ?? "[]") as string[]; } catch { return []; } };
const recent = () => { try { return (JSON.parse(localStorage.getItem("rb_recent_jobs") ?? "[]") as Array<{ id: string }>).map((r) => r.id); } catch { return []; } };
const settle = () => new Promise((r) => setTimeout(r, 250));

describe("the posting a wide screen opens by itself", () => {
  it("S12-012: never writes the address, so closing a card the reader opened keeps the filters and the board", async () => {
    mount();
    await waitFor(() => expect(detailCalls()).toContain(ROWS[0].id), SLOW);
    await settle();
    expect(search().has("job"), "the auto-selected posting wrote ?job= into the address").toBe(false);
    // The reader opens B, then turns a filter on while it is open.
    openCard("Warehouse Associate");
    await waitFor(() => expect(search().get("job")).toBe(ROWS[1].id), SLOW);
    fireEvent.click(screen.getByLabelText("States pay"));
    await waitFor(() => expect(search().get("statedPay")).toBe("1"), SLOW);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(search().has("job"), "closing the card left a posting in the address").toBe(false), SLOW);
    await waitFor(() => expect(search().get("statedPay"), "closing the card rewound the filters").toBe("1"), SLOW);
    expect(window.location.pathname).toBe("/jobs");
    // A second open-then-close pushes and pops its own entry and stays on the board.
    await settle();
    openCard("Quiet Role");
    await waitFor(() => expect(search().get("job")).toBe(ROWS[2].id), SLOW);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(search().has("job")).toBe(false), SLOW);
    await settle();
    expect(window.location.pathname, "the second close took a Back off the board").toBe("/jobs");
    expect(search().get("statedPay")).toBe("1");
  });

  it("S12-012: arrowing (a replace write) and then clicking a card closes back to the board, twice", async () => {
    mount();
    await waitFor(() => expect(detailCalls()).toContain(ROWS[0].id), SLOW);
    await settle();
    // j moves the selection: a deliberate pick, written by replace.
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(search().get("job")).toBe(ROWS[1].id), SLOW);
    openCard("Quiet Role");
    await waitFor(() => expect(search().get("job")).toBe(ROWS[2].id), SLOW);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(search().has("job"), "the pop onto the arrowed entry kept its ?job=").toBe(false), SLOW);
    await settle();
    openCard("Data Analyst");
    await waitFor(() => expect(search().get("job")).toBe(ROWS[3].id), SLOW);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(search().has("job")).toBe(false), SLOW);
    await settle();
    expect(window.location.pathname, "a stuck flag turned the close into a Back off the board").toBe("/jobs");
  });

  it("S12-033: is not marked viewed, not in Jump back in, and Enter does not apply to it", async () => {
    mount();
    await waitFor(() => expect(detailCalls()).toContain(ROWS[0].id), SLOW);
    await settle();
    expect(viewed()).not.toContain(ROWS[0].id);
    expect(recent()).not.toContain(ROWS[0].id);
    expect(document.body.textContent ?? "").not.toContain("Jump back in");
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(openSpy, "Enter opened the application of a posting nobody chose").not.toHaveBeenCalled();
    // Positive control: a posting the reader moves to IS theirs.
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(search().get("job")).toBe(ROWS[1].id), SLOW);
    expect(viewed()).toContain(ROWS[1].id);
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(openSpy).toHaveBeenCalledWith(ROWS[1].applyUrl, "_blank", "noopener,noreferrer");
  });

  it("S12-033: a new search moves the board's own pick to the new top; a reader's pick stays", async () => {
    mount();
    await waitFor(() => expect(detailCalls()).toContain(ROWS[0].id), SLOW);
    await settle();
    fireEvent.click(screen.getByLabelText("States pay"));
    // The new list's top is Data Analyst: the pane follows it, because nobody chose Staff Engineer.
    await waitFor(() => expect(detailCalls().at(-1), "the auto-selected posting stayed open across a new search").toBe(ROWS[3].id), SLOW);
    expect(search().has("job")).toBe(false);
    // Positive control: a posting the reader opened is kept when the list changes.
    openCard("Quiet Role");
    await waitFor(() => expect(search().get("job")).toBe(ROWS[2].id), SLOW);
    const before = detailCalls().length;
    fireEvent.click(screen.getByLabelText("States pay"));
    await waitFor(() => expect(search().has("statedPay")).toBe(false), SLOW);
    await settle(); await settle();
    expect(detailCalls().length, "the reader's own pick was replaced by the list's top").toBe(before);
    expect(search().get("job")).toBe(ROWS[2].id);
  });
});
