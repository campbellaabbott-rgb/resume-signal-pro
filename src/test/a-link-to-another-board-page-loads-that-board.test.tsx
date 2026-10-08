// A LINK TO ANOTHER BOARD PAGE LOADS THAT BOARD.
//
// /jobs, /jobs/company/:token and /jobs/field/:category render the same page,
// and React Router reuses the instance across them. Every filter was seeded
// once, in a useState initialiser, so clicking a card's employer (or the
// panel's employer, "Also hiring in", the header's Jobs) changed the address
// and nothing else: no list request went out, the lander's H1 never rendered,
// and the URL-sync effect then wrote the old board's filters back over the
// new address. The only way back to the full board was a reload.
//
// Mounted here exactly as App.tsx mounts it -- one <Jobs/> element on all
// three routes -- and judged by the request body the click causes and the
// heading that follows, never by the address alone.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [], error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.single = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs from "@/pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
const row = (i: number, token: string, company: string) => ({
  id: `greenhouse:${token}:${1000 + i}`, token, company, title: `${company} Engineer ${i}`,
  location: "Austin, Texas, United States", salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
function mock() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 3 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      const companies = b.companies as string[] | undefined;
      const rows = companies?.[0] === "acme"
        ? Array.from({ length: 3 }, (_, i) => row(i, "acme", "Acme"))
        : [row(0, "acme", "Acme"), row(1, "globex", "Globex"), row(2, "initech", "Initech")];
      return { data: { jobs: rows, total: rows.length, totalAllCompanies: 3, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
}
const listBodies = () => invoke.mock.calls
  .filter(([fn, o]) => fn === "job-board" && (o as { body?: Body })?.body?.action === "list"
    && !(o as { body?: Body }).body?.countOnly && !(o as { body?: Body }).body?.facetCounts)
  .map(([, o]) => (o as { body: Body }).body);
const h1 = () => document.querySelector("main h1")?.textContent ?? "";

function mount(url: string) {
  window.history.replaceState({}, "", url);
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/field/:category" element={<Jobs />} />
        <Route path="/jobs/company/:companyToken" element={<Jobs />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
  mock();
});

describe("a link to another board page loads that board", () => {
  it("a card's employer link asks for that employer and renders its lander", async () => {
    mount("/jobs");
    await waitFor(() => expect(document.body.textContent).toContain("Globex Engineer 1"), SLOW);
    expect(h1()).toBe("Live job board");
    const before = listBodies().length;
    const link = screen.getAllByRole("link", { name: "Globex" })[0];
    await act(async () => { fireEvent.click(link); });
    // The click must cause a list read FOR THAT EMPLOYER -- the address
    // changing is not the board changing.
    await waitFor(() => {
      const after = listBodies().slice(before);
      expect(after.some((b) => JSON.stringify(b.companies) === JSON.stringify(["globex"])),
        "the employer link changed the address and sent no request for the employer").toBe(true);
    }, SLOW);
    await waitFor(() => expect(h1()).toMatch(/Open roles at Globex/), SLOW);
    // And the URL-sync effect writes the NEW board's address, not the old one's.
    await waitFor(() => expect(window.location.pathname).toBe("/jobs/company/globex"), SLOW);
  });

  it("the way back to the full board asks for the full board", async () => {
    mount("/jobs/company/acme");
    await waitFor(() => expect(h1()).toMatch(/Open roles at Acme/), SLOW);
    const before = listBodies().length;
    // The header's Jobs link: the one way back every page offers.
    const jobsLink = screen.getAllByRole("link").find((a) => a.getAttribute("href") === "/jobs");
    expect(jobsLink, "no link to /jobs on the lander -- re-anchor").toBeTruthy();
    await act(async () => { fireEvent.click(jobsLink!); });
    await waitFor(() => {
      const after = listBodies().slice(before);
      expect(after.length, "the link to /jobs sent no request").toBeGreaterThan(0);
      expect(after.at(-1)!.companies, "the full board was asked for with the old employer still in it").toBeUndefined();
    }, SLOW);
    await waitFor(() => expect(h1()).toBe("Live job board"), SLOW);
    await waitFor(() => expect(window.location.pathname).toBe("/jobs"), SLOW);
  });

  // ── Back and Forward, in a real browser history (BrowserRouter on jsdom) ──
  //
  // The remount must not fire on the board's OWN history entries: the detail
  // panel pushes one, and Back closes the panel over the same list. Only a
  // pop onto an entry another board wrote is another board.
  function mountBrowser(url: string) {
    window.history.replaceState(null, "", url);
    return render(
      <BrowserRouter>
        <Routes>
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/field/:category" element={<Jobs />} />
          <Route path="/jobs/company/:companyToken" element={<Jobs />} />
        </Routes>
      </BrowserRouter>,
    );
  }

  it("Back from a posting panel keeps the board it was opened over", async () => {
    mountBrowser("/jobs");
    await waitFor(() => expect(document.body.textContent).toContain("Globex Engineer 1"), SLOW);
    // A search typed AFTER mount: the board rewrites its own address, which
    // the router never sees, so the entry Back lands on differs from the
    // router's last location -- the case the board's stamp exists for.
    fireEvent.change(document.getElementById("board-search") as HTMLInputElement, { target: { value: "engineer" } });
    await waitFor(() => expect(listBodies().some((b) => b.q === "engineer")).toBe(true), SLOW);
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("q")).toBe("engineer"), SLOW);
    await waitFor(() => expect(document.body.textContent).toContain("Globex Engineer 1"), SLOW);
    const title = screen.getAllByRole("link", { name: "Globex Engineer 1" })[0];
    await act(async () => { fireEvent.click(title); });
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("job")).toBe("greenhouse:globex:1001"), SLOW);
    const before = listBodies().length;
    await act(async () => { window.history.back(); await new Promise((r) => setTimeout(r, 300)); });
    await waitFor(() => expect(new URLSearchParams(window.location.search).has("job")).toBe(false), SLOW);
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    expect(listBodies().length, "closing the panel with Back remounted the board and re-read the list").toBe(before);
    expect(new URLSearchParams(window.location.search).get("q")).toBe("engineer");
    expect(document.body.textContent).toContain("Globex Engineer 1");
  });

  // The panel a click opened sits on a history entry of its own. Its employer
  // link used to close the panel with a queued Back and then push the lander:
  // the Back landed AFTER the push, on the old board's ?job= entry, and the
  // board that came back was the full one with the panel reopened.
  it("the posting panel's employer link reaches the employer when a click opened the panel", async () => {
    // Chromium keeps a Back queued before a push in the same task and runs it
    // after the push; jsdom's pushState cancels it. Deferring Back past the
    // push reproduces the browser's order here.
    const nativeBack = window.history.back.bind(window.history);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => { setTimeout(nativeBack, 0); });
    try {
      await panelEmployerLink();
    } finally {
      back.mockRestore();
    }
  });
  async function panelEmployerLink() {
    mountBrowser("/jobs");
    await waitFor(() => expect(document.body.textContent).toContain("Globex Engineer 1"), SLOW);
    await act(async () => { fireEvent.click(screen.getAllByRole("link", { name: "Globex Engineer 1" })[0]); });
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("job")).toBe("greenhouse:globex:1001"), SLOW);
    const before = listBodies().length;
    const panel = await screen.findByRole("dialog");
    await act(async () => { fireEvent.click(within(panel).getByRole("link", { name: "Globex" })); });
    // Let every queued history traversal land before judging.
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    await waitFor(() => expect(h1()).toMatch(/Open roles at Globex/), SLOW);
    expect(window.location.pathname, "the panel's employer link ended somewhere other than the employer").toBe("/jobs/company/globex");
    expect(new URLSearchParams(window.location.search).has("job")).toBe(false);
    const after = listBodies().slice(before);
    expect(after.some((b) => JSON.stringify(b.companies) === JSON.stringify(["globex"]))).toBe(true);
    expect(after.at(-1)!.companies, "the last read was not the employer's").toEqual(["globex"]);
    // And Back from the employer returns to the board the panel was opened
    // over, without the panel.
    await act(async () => { window.history.back(); await new Promise((r) => setTimeout(r, 300)); });
    await waitFor(() => expect(h1()).toBe("Live job board"), SLOW);
    expect(window.location.pathname).toBe("/jobs");
    expect(new URLSearchParams(window.location.search).has("job")).toBe(false);
  }

  it("Back from an employer's lander returns to the full board", async () => {
    mountBrowser("/jobs");
    await waitFor(() => expect(document.body.textContent).toContain("Globex Engineer 1"), SLOW);
    await act(async () => { fireEvent.click(screen.getAllByRole("link", { name: "Acme" })[0]); });
    await waitFor(() => expect(h1()).toMatch(/Open roles at Acme/), SLOW);
    const before = listBodies().length;
    await act(async () => { window.history.back(); await new Promise((r) => setTimeout(r, 300)); });
    await waitFor(() => expect(h1()).toBe("Live job board"), SLOW);
    await waitFor(() => {
      const after = listBodies().slice(before);
      expect(after.length, "Back to /jobs sent no request").toBeGreaterThan(0);
      expect(after.at(-1)!.companies).toBeUndefined();
    }, SLOW);
  });
});
