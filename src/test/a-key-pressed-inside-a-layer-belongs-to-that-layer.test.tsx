/**
 * A KEY PRESSED INSIDE A LAYER BELONGS TO THAT LAYER (2026-10-18 review).
 *
 * The board listens on window for Escape (close the posting) and Enter (apply
 * to the posting in the desktop pane). Pass B put Radix layers on the page:
 * the ⋯ menus, the phone's posting sheet, the filter sheet. Two bugs came of
 * both acting on one keypress:
 *   - Enter on a ⋯ menu item also opened the pane's posting in a new tab and
 *     marked it applied (the 2026-07-26 sweep's bug, back through the menus);
 *   - Escape on the phone sheet ran history.back twice (the reader left the
 *     board), and Escape on a ⋯ menu also closed the posting under it.
 * Driven through Jobs.tsx's own handlers, not a harness.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { openPostingMenu } from "./helpers/posting-menu";
import { keyBelongsToALayer } from "@/lib/board-keys";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs from "../pages/Jobs";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 4000 } as const;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const job = (n: number) => ({
  id: `greenhouse:acme:${n}`, source: "greenhouse", token: "acme", company: "Acme",
  title: `Role ${n}`, location: "New York, NY, USA", country: "US",
  salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
  workMode: "onsite", employmentType: "full_time", experienceBand: "mid", minYears: 3,
  category: "engineering", department: null, agency: false,
  postedAt: ago(2 * DAY), lastSeen: ago(2 * DAY), recheckedAt: ago(60_000), applyUrl: `https://acme.example/jobs/${n}`, remote: false,
});
const JOBS = [job(1), job(2), job(3)];

const realMatchMedia = window.matchMedia;
function screenIs(kind: "desktop" | "phone") {
  window.matchMedia = ((q: string) => ({
    matches: kind === "desktop" ? /min-width:\s*1024px/.test(q) : /max-width:\s*640px/.test(q),
    media: q, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function mount() {
  window.history.replaceState({}, "", "/jobs");
  rpc.mockImplementation(async () => ({ data: [], error: null }));
  invoke.mockImplementation(async (fn: string, a: { body?: Record<string, unknown> } | undefined) => {
    const b = a?.body ?? {};
    if (fn === "job-fit") return { data: { terms: [] }, error: null };
    if (fn === "job-board" && b.action === "detail") return { data: { job: JOBS.find((j) => j.id === b.id) ?? JOBS[0], description: "A role." } };
    if (fn === "job-board" && b.action === "facets") return { data: { categories: {}, refreshedAt: ago(0), sources: {}, sourcesAt: ago(0) }, error: null };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: JOBS.length } };
      return { data: { jobs: JOBS, total: JOBS.length, hasMore: false, totalAllCompanies: JOBS.length, companies: [], companiesCount: 1, categories: {}, failedSources: [], refreshedAt: ago(0) }, error: null };
    }
    return { data: {} };
  });
  return render(
    <MemoryRouter initialEntries={["/jobs"]}>
      <Routes><Route path="/jobs" element={<Jobs />} /></Routes>
    </MemoryRouter>,
  );
}

const cardOf = (title: string) => Array.from(document.querySelectorAll<HTMLElement>("[data-job-id]"))
  .find((c) => (c.textContent ?? "").includes(title))!;
const pane = () => document.querySelector<HTMLElement>("[data-posting-detail]");
const applyClicks = () => invoke.mock.calls.filter(([fn, a]) => fn === "job-board" && (a as { body?: { action?: string } })?.body?.action === "click"
  && (a as { body?: { kind?: string } })?.body?.kind !== "open");

let back: ReturnType<typeof vi.spyOn>;
let open: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset(); rpc.mockReset();
  back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  open = vi.spyOn(window, "open").mockImplementation(() => null);
});
afterEach(() => {
  back.mockRestore(); open.mockRestore();
  window.matchMedia = realMatchMedia;
});

describe("the rule", () => {
  it("a handled keypress, or one aimed inside a menu, dialog or listbox, is the layer's; one on the page is the board's", () => {
    const menu = document.createElement("div"); menu.setAttribute("role", "menu");
    const item = document.createElement("div"); item.setAttribute("role", "menuitem"); menu.appendChild(item);
    document.body.appendChild(menu);
    expect(keyBelongsToALayer({ defaultPrevented: false, target: item })).toBe(true);
    expect(keyBelongsToALayer({ defaultPrevented: true, target: document.body })).toBe(true);
    expect(keyBelongsToALayer({ defaultPrevented: false, target: document.body })).toBe(false);
    menu.remove();
  });
});

describe("Escape has one owner", () => {
  it("on the phone sheet: one Escape closes it with exactly one history.back", async () => {
    screenIs("phone");
    mount();
    await waitFor(() => expect(cardOf("Role 2")).toBeTruthy(), SLOW);
    fireEvent.click(cardOf("Role 2"));
    const sheet = await waitFor(() => { const s = document.querySelector<HTMLElement>("[data-posting-sheet]"); if (!s) throw new Error("no sheet"); return s; }, SLOW);
    await waitFor(() => expect(window.location.search).toContain("job="), SLOW);
    back.mockClear();
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(document.querySelector("[data-posting-sheet]")).toBeNull(), SLOW);
    expect(back, "one Escape popped two history entries and left the board").toHaveBeenCalledTimes(1);
  });

  it("on the pane's ⋯ menu (desktop): Escape closes the menu and leaves the posting open", async () => {
    screenIs("desktop");
    mount();
    await waitFor(() => expect(cardOf("Role 2")).toBeTruthy(), SLOW);
    fireEvent.click(cardOf("Role 2"));
    await waitFor(() => expect(pane()?.textContent ?? "").toContain("Role 2"), SLOW);
    back.mockClear();
    const menu = await openPostingMenu(pane()!);
    fireEvent.keyDown(menu.querySelector<HTMLElement>("[role^='menuitem']") ?? menu, { key: "Escape" });
    await waitFor(() => expect(document.querySelector("[role='menu']")).toBeNull(), SLOW);
    expect(pane()?.textContent ?? "", "Escape on the menu closed the posting under it").toContain("Role 2");
    expect(back).not.toHaveBeenCalled();
  });

  it("positive control: Escape on the page itself still closes the desktop pane", async () => {
    screenIs("desktop");
    mount();
    await waitFor(() => expect(cardOf("Role 2")).toBeTruthy(), SLOW);
    fireEvent.click(cardOf("Role 2"));
    await waitFor(() => expect(pane()?.textContent ?? "").toContain("Role 2"), SLOW);
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(pane()?.textContent ?? "").not.toContain("Role 2"), SLOW);
  });
});

describe("Enter on a menu item is the item's", () => {
  it("Enter on another card's ⋯ menu item opens nothing and marks nothing applied", async () => {
    screenIs("desktop");
    mount();
    await waitFor(() => expect(cardOf("Role 1")).toBeTruthy(), SLOW);
    fireEvent.click(cardOf("Role 1"));
    await waitFor(() => expect(pane()?.textContent ?? "").toContain("Role 1"), SLOW);
    const menu = await openPostingMenu(cardOf("Role 3"));
    const item = within(menu).getByRole("menuitemcheckbox", { name: /Compare/ });
    fireEvent.keyDown(item, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 50));
    expect(open, "Enter on a menu item opened the pane's posting in a new tab").not.toHaveBeenCalled();
    expect(applyClicks(), "Enter on a menu item counted an apply").toEqual([]);
  });

  it("positive control: Enter on the page applies to the pane's posting", async () => {
    screenIs("desktop");
    mount();
    await waitFor(() => expect(cardOf("Role 1")).toBeTruthy(), SLOW);
    fireEvent.click(cardOf("Role 1"));
    await waitFor(() => expect(pane()?.textContent ?? "").toContain("Role 1"), SLOW);
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(open).toHaveBeenCalledWith("https://acme.example/jobs/1", "_blank", "noopener,noreferrer");
  });
});

describe("hiding a posting from its own pane", () => {
  it("closes the pane, which no longer shows the posting just hidden", async () => {
    screenIs("desktop");
    mount();
    await waitFor(() => expect(cardOf("Role 2")).toBeTruthy(), SLOW);
    fireEvent.click(cardOf("Role 2"));
    await waitFor(() => expect(pane()?.textContent ?? "").toContain("Role 2"), SLOW);
    const menu = await openPostingMenu(pane()!);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Hide this posting/ }));
    await waitFor(() => expect(cardOf("Role 2"), "the card left the list").toBeUndefined(), SLOW);
    await waitFor(() => expect(pane()?.textContent ?? "", "the pane still shows the hidden posting").not.toContain("Role 2"), SLOW);
    // The click pushed the posting's ?job= entry; closing pops it (history.back is stubbed here).
    expect(back).toHaveBeenCalledTimes(1);
  });
});
