// @vitest-environment jsdom
/**
 * "More roles at {employer}" costs one list call, made once, only when the
 * section is in view — and none at all without IntersectionObserver or under
 * a standing allowance refusal. Judged by the request the door sends.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import enListing from "@/i18n/shards/listing/en.json";
import { clearBoardBudgetRefusal, markBoardBudgetRefused } from "@/lib/board-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import { MoreRolesAtEmployer, MORE_ROLES_SHOWN } from "./MoreRolesAtEmployer";

type Watcher = { cb: IntersectionObserverCallback; disconnected: boolean };
let watchers: Watcher[] = [];
class FakeIO {
  w: Watcher;
  constructor(cb: IntersectionObserverCallback) { this.w = { cb, disconnected: false }; watchers.push(this.w); }
  observe() {}
  disconnect() { this.w.disconnected = true; }
  unobserve() {}
  takeRecords() { return []; }
}
const scrollIntoView = () => act(() => {
  for (const w of watchers) if (!w.disconnected) w.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
});
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `greenhouse:acme:${i}`, title: `Role ${i}`, company: "Acme", token: "acme", source: "greenhouse" }));
const mount = () => render(<MemoryRouter><MoreRolesAtEmployer token="acme" employer="Acme" excludeId="greenhouse:acme:0" /></MemoryRouter>);

beforeAll(() => { i18n.addResourceBundle("en", "translation", enListing, true, true); });
beforeEach(() => { invoke.mockReset(); watchers = []; clearBoardBudgetRefusal(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearBoardBudgetRefusal(); });

describe("one lazy read", () => {
  it("asks nothing until the section is in view, then asks once for this employer, and leaves this posting out", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    invoke.mockResolvedValue({ data: { jobs: rows(MORE_ROLES_SHOWN + 1) }, error: null });
    mount();
    expect(invoke).not.toHaveBeenCalled();
    scrollIntoView();
    scrollIntoView();
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 3 }).length).toBe(MORE_ROLES_SHOWN));
    expect(invoke).toHaveBeenCalledTimes(1);
    const [fn, opts] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(fn).toBe("job-board");
    expect(opts.body).toEqual({ action: "list", companies: ["acme"], limit: MORE_ROLES_SHOWN + 1, sort: "newest", includeFacets: false });
    expect(screen.queryByText("Role 0"), "the posting on screen is not offered as another role").toBeNull();
    expect(screen.getByRole("link", { name: "Role 1" }).getAttribute("href")).toBe("/jobs/posting/greenhouse/acme/1");
  });

  it("makes no call without IntersectionObserver, and still offers every role at the employer", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    mount();
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "See every open role at Acme" }).getAttribute("href")).toBe("/jobs/company/acme");
  });

  it("makes no call under a standing allowance refusal", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    markBoardBudgetRefused({ code: "address", limit: 10000, resetAt: new Date(Date.now() + 3600_000).toISOString() });
    mount();
    scrollIntoView();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("a failed read is silent: no error, and the link stays", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    invoke.mockResolvedValue({ data: null, error: { name: "FunctionsFetchError", message: "network" } });
    mount();
    scrollIntoView();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
    expect(screen.getByRole("link", { name: "See every open role at Acme" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/no other roles|couldn't/i);
  });
});
