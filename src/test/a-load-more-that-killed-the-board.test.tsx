// A "LOAD MORE" THAT KILLED THE BOARD.
//
// A filter change is deliberately non-destructive: the rows already on screen
// stay, and the replacement loads underneath them. That window is 400ms of
// debounce plus a request — seconds, on the queries that are slow enough to
// matter. "Load more" sat there enabled through all of it.
//
// Press it inside that window and both requests died:
//   * reqSeq — the load-more is NEWER, so the page-0 request for the filters
//     the reader actually chose was discarded as stale when it arrived;
//   * listSig — the load-more describes the NEW filters and cannot be appended
//     to rows built from the old ones, so it was refused too.
// The refusal was a bare `return`. Nothing was retried, nothing was said, and
// the board was left showing rows from one filter set with no pending request
// for the filters it was under. `listSig` could never be set again, so every
// subsequent click landed on the same line: the control was dead until the
// reader changed a filter, the one repair nobody thinks to try.
//
// Two fixes, and this guard holds both:
//   1. The button no longer claims it can extend a list that is being
//      replaced. `refreshing` now starts when the refetch is SCHEDULED rather
//      than when it is sent, so the disabled state covers the debounce too.
//   2. The signature refusal replaces what it discards instead of returning
//      into silence — it re-requests page 0 for the filters on screen.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [] }),
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

const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const JOBS = strip(readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8"));

type ListCall = { q: string; offset: number };
const page = (tag: string, offset: number) =>
  Array.from({ length: 6 }, (_, i) => ({
    id: `${tag}-${offset + i}`, company: `${tag} Employer ${offset + i}`, title: `${tag} Role ${offset + i}`,
    location: "Remote", salary: null, applyUrl: `https://x/${tag}/${offset + i}`, source: "greenhouse",
  }));

let listCalls: ListCall[] = [];
/** Holds every list response until released, so the in-flight window is real. */
let held: Promise<void> | null = null;
let release: (() => void) | null = null;
const holdResponses = () => { held = new Promise<void>((r) => { release = r; }); };
const releaseResponses = () => { release?.(); held = null; release = null; };

function boardMock() {
  invoke.mockImplementation(async (fn: string, opts: { body?: Record<string, unknown> } | undefined) => {
    const body = opts?.body ?? {};
    if (fn !== "job-board" || body.action !== "list") return { data: null };
    // The board also asks this action for numbers rather than rows — the
    // filtered category facet and the "what would relaxing this filter show"
    // probes. Neither is a page of the list, so neither belongs in listCalls.
    if (body.facetCounts) return { data: { categories: {} } };
    if (body.countOnly) return { data: { total: 0 } };
    const q = String(body.q ?? "");
    const offset = Number(body.offset ?? 0);
    listCalls.push({ q, offset });
    if (held) await held;
    return {
      data: {
        jobs: page(q || "all", offset), total: 500, totalAllCompanies: 500, companies: [], companiesCount: 0,
        categories: {}, failedSources: [], failedCount: 0, refreshedAt: null,
        hasMore: true, nextOffset: offset + 6,
      },
    };
  });
}

const loadMore = () => screen.getByRole("button", { name: /Load more|Try again/i });
const searchBox = () => screen.getByPlaceholderText(/Title or keyword/i);
// Every wait here sits behind a 400ms debounce; the default 1s leaves no room
// on a loaded machine.
const SLOW = { timeout: 4000 } as const;

describe("a load more that killed the board", () => {
  beforeEach(() => {
    // The board syncs its filters into the address bar with replaceState and
    // reads them back on mount, so a query typed in one test is the NEXT
    // test's initial state unless the URL is reset with everything else.
    window.history.replaceState({}, "", "/jobs");
    invoke.mockReset(); listCalls = []; held = null; release = null; boardMock();
  });

  it("behaviour: the board never offers to extend a list it is already replacing", async () => {
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    await waitFor(() => expect(loadMore()).toBeEnabled(), SLOW);
    expect(listCalls).toEqual([{ q: "", offset: 0 }]);

    // A filter change. The rows on screen are now the PREVIOUS filter set's,
    // and stay visible on purpose — but they can no longer be extended. The
    // replacement is held open so the window is a real one and not a race.
    holdResponses();
    fireEvent.change(searchBox(), { target: { value: "nurse" } });

    // Disabled IMMEDIATELY, i.e. through the 400ms debounce as well as the
    // request. This is the window the click used to fall into; before the fix
    // `refreshing` did not start until the request was actually sent.
    expect(loadMore(), "the debounce window left the button live").toBeDisabled();
    expect(listCalls.filter((c) => c.q === "nurse").length, "nothing has been requested yet").toBe(0);

    // ...and it stays disabled while the replacement is genuinely in flight.
    await waitFor(() => expect(listCalls.some((c) => c.q === "nurse")).toBe(true), SLOW);
    expect(loadMore(), "the in-flight window left the button live").toBeDisabled();

    // Once the new list lands, the control comes back and describes THAT list.
    releaseResponses();
    await waitFor(() => expect(loadMore()).toBeEnabled(), SLOW);
    expect(document.body.textContent).toContain("nurse Role 0");
    // The critical negative: no page beyond the first was ever requested while
    // the board was mid-change, so nothing could be refused and stranded.
    expect(listCalls.filter((c) => c.offset > 0)).toEqual([]);
  });

  it("behaviour: a click inside the in-flight window cannot fire, and the board still converges", async () => {
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    await waitFor(() => expect(loadMore()).toBeEnabled(), SLOW);

    // Hold the next response open so the replacement is provably in flight.
    holdResponses();
    fireEvent.change(searchBox(), { target: { value: "nurse" } });
    await waitFor(() => expect(listCalls.some((c) => c.q === "nurse")).toBe(true), SLOW);
    // Click anyway. A disabled control cannot dispatch, which is the point:
    // the request that used to be thrown away is never made.
    fireEvent.click(loadMore());
    expect(listCalls.filter((c) => c.offset > 0)).toEqual([]);

    releaseResponses();
    await waitFor(() => expect(loadMore()).toBeEnabled(), SLOW);
    // And the button works on the list it now describes.
    fireEvent.click(loadMore());
    await waitFor(() => expect(listCalls.some((c) => c.q === "nurse" && c.offset > 0)).toBe(true), SLOW);
    await waitFor(() => expect(loadMore()).toBeEnabled(), SLOW);
    expect(document.body.textContent).toContain("nurse Role 6");
  });

  it("behaviour: paging a settled list still works and still appends", async () => {
    // The fix must not cost the ordinary case.
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    await waitFor(() => expect(loadMore()).toBeEnabled(), SLOW);
    fireEvent.click(loadMore());
    await waitFor(() => expect(listCalls).toContainEqual({ q: "", offset: 6 }), SLOW);
    await waitFor(() => expect(loadMore()).toBeEnabled(), SLOW);
    expect(document.body.textContent).toContain("all Role 0");
    expect(document.body.textContent).toContain("all Role 6");
  });

  it("the signature refusal is no longer a dead end — it re-starts a list", () => {
    // Derived, not pinned to a name: read whatever the refusal branch sets,
    // then require that same state to be a dependency of the effect that
    // starts a list. A future rename passes; a future bare `return` does not.
    const branch = /if \(offset > 0 && listSig\.current !== sig\) \{([\s\S]*?)\n\s{8}\}/.exec(JOBS)?.[1];
    expect(branch, "the signature refusal moved — re-point this guard").toBeTruthy();
    expect(branch!.replace(/\s/g, ""), "the refusal is a silent dead end again").not.toBe("return;");
    const setter = /set([A-Z]\w*)\(/.exec(branch!);
    expect(setter, "the refusal discards a response and puts nothing in its place").toBeTruthy();
    const stateName = setter![1][0].toLowerCase() + setter![1].slice(1);
    // The one effect that issues page 0. Its dependency list must contain the
    // state the refusal bumps, or the bump reaches nothing.
    const effect = /const h = setTimeout\(\(\) => fetchJobs\(0\), 400\);[\s\S]*?\}, \[([^\]]*)\]\);/.exec(JOBS);
    expect(effect, "the debounced page-0 effect moved — re-point this guard").toBeTruthy();
    expect(
      effect![1].split(",").map((s) => s.trim()),
      `the refusal sets \`${stateName}\`, which nothing re-fetches on`,
    ).toContain(stateName);
  });

  it("`refreshing` means the visible list is out of date — including before the request goes out", () => {
    // The gate is only honest if it covers the debounce. Both must hold: the
    // effect flags it at SCHEDULE time, and the button reads it.
    const effect = /const h = setTimeout\(\(\) => fetchJobs\(0\), 400\);/.exec(JOBS);
    expect(effect).toBeTruthy();
    const before = JOBS.slice(Math.max(0, effect!.index - 200), effect!.index);
    expect(before, "the out-of-date flag must be raised before the debounce, not after it")
      .toMatch(/setRefreshing\(true\);/);
    expect(JOBS).toMatch(/disabled=\{loadingMore \|\| refreshing\}/);
  });
});
