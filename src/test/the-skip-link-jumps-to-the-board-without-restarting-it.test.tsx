// THE SKIP LINK JUMPS TO THE BOARD WITHOUT RESTARTING IT.
//
// index.html ships <a href="#main-content"> as the first focusable element on
// every page. A fragment jump adds a history entry with no state and fires
// popstate, which React Router reports as a POP to a new location. The board
// remounts on any pop onto an entry it did not stamp, so the skip link
// restarted it: a second counted list read, the open panel closed, loaded
// pages dropped, a new <main>, and the new board's address sync stripped the
// hash. Back from the jump restarted it again.
//
// Mounted in a real browser history (BrowserRouter on jsdom) and judged by
// the reads the jump causes and by the <main> node surviving it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
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
      const rows = [row(0, "acme", "Acme"), row(1, "globex", "Globex"), row(2, "initech", "Initech")];
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
const settle = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

/** The skip link exactly as index.html ships it, outside the React root. */
function skipLink(): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = "#main-content";
  a.textContent = "Skip to main content";
  document.body.prepend(a);
  return a;
}
/** Counts fragment jumps as the browser reports them, independent of what
 *  the page later writes into the address. */
function countJumps() {
  const c = { n: 0, stop: () => window.removeEventListener("hashchange", on) };
  const on = (e: HashChangeEvent) => { if (e.newURL.endsWith("#main-content")) c.n += 1; };
  window.addEventListener("hashchange", on);
  return c;
}
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

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
  mock();
});

describe("the skip link jumps to the board without restarting it", () => {
  it("a jump to #main-content, and Back from it, keep the board, its reads and its <main>", async () => {
    mountBrowser("/jobs");
    await waitFor(() => expect(document.body.textContent).toContain("Globex Engineer 1"), SLOW);
    // A search typed after mount: the board rewrites its own address, which
    // the router never sees, so the jump copies an address the router's last
    // location does not carry.
    fireEvent.change(document.getElementById("board-search") as HTMLInputElement, { target: { value: "engineer" } });
    await waitFor(() => expect(listBodies().some((b) => b.q === "engineer")).toBe(true), SLOW);
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("q")).toBe("engineer"), SLOW);
    await waitFor(() => expect(document.body.textContent).toContain("Globex Engineer 1"), SLOW);
    await settle(300);
    const main = document.getElementById("main-content");
    expect(main, "no #main-content on the board -- re-anchor").toBeTruthy();
    const before = listBodies().length;

    const jumps = countJumps();
    const a = skipLink();
    await act(async () => { fireEvent.click(a); await new Promise((r) => setTimeout(r, 300)); });
    await settle(300);
    expect(jumps.n, "the jump never happened -- the test proves nothing").toBe(1);
    expect(listBodies().length, "the skip link restarted the board and re-read the list").toBe(before);
    expect(document.getElementById("main-content"), "the skip link replaced the board's <main>").toBe(main);
    expect(window.location.hash, "a restarted board's address sync stripped the jump's hash").toBe("#main-content");
    expect(new URLSearchParams(window.location.search).get("q")).toBe("engineer");

    await act(async () => { window.history.back(); await new Promise((r) => setTimeout(r, 300)); });
    await settle(300);
    expect(window.location.hash).toBe("");
    expect(listBodies().length, "Back from the jump restarted the board").toBe(before);
    expect(document.getElementById("main-content")).toBe(main);
    jumps.stop();
    a.remove();
  });

  it("a jump with the posting panel open keeps the panel and the board", async () => {
    mountBrowser("/jobs");
    await waitFor(() => expect(document.body.textContent).toContain("Globex Engineer 1"), SLOW);
    const title = Array.from(document.querySelectorAll("a")).find((x) => x.textContent === "Globex Engineer 1")!;
    await act(async () => { fireEvent.click(title); });
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("job")).toBe("greenhouse:globex:1001"), SLOW);
    await settle(300);
    const main = document.getElementById("main-content");
    const before = listBodies().length;
    const jumps = countJumps();
    const a = skipLink();
    await act(async () => { fireEvent.click(a); await new Promise((r) => setTimeout(r, 300)); });
    await settle(300);
    expect(jumps.n, "the jump never happened -- the test proves nothing").toBe(1);
    expect(listBodies().length, "the skip link restarted the board under an open panel").toBe(before);
    expect(document.getElementById("main-content")).toBe(main);
    expect(document.querySelector('[role="dialog"]'), "the skip link closed the posting panel").toBeTruthy();
    expect(window.location.hash).toBe("#main-content");
    jumps.stop();
    a.remove();
  });
});
