/**
 * EVERY VENDOR WALL MOUNTED AT ONCE SHARES ONE READ
 * (cost audit 2026-11-08, "Small facets_head row": memoise useBoardVendorCounts).
 *
 * The résumé checker's page mounts AtsCoverage twice -- the strip near the top
 * and the full wall below -- and each mount sent its own
 * get_board_vendor_counts. A read already in flight is now shared by every
 * mount that starts while it is pending, and forgotten once it settles (or
 * after five seconds unanswered), so a later mount always asks again.
 *
 * The response shape is the one get_board_vendor_counts gives both before and
 * after migration 20261109175000, so the hook needs nothing from the database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

import { AtsCoverage } from "../components/AtsCoverage";
import { useBoardVendorCounts } from "../hooks/useBoardVendorCounts";

const WALL = {
  data: { sourcesFacet: { greenhouse: 48_102, workday: 305_380 }, openTotal: 353_482, as_of: "2026-11-08T15:07:00+00:00", cached: true },
  error: null,
};
const reads = (fn = "get_board_vendor_counts") => rpc.mock.calls.filter((c) => c[0] === fn).length;
/** Every vendor read answers `reply`; anything else the page asks answers false. */
const answer = (reply: (fn: string) => Promise<unknown>) =>
  rpc.mockImplementation((fn: string) =>
    fn === "get_board_vendor_counts" || fn === "get_job_board_facets" ? reply(fn) : Promise.resolve({ data: false, error: null }));

beforeEach(() => rpc.mockReset());
afterEach(() => vi.useRealTimers());

describe("one read per moment, not per mount", () => {
  it("the strip and the full wall mounted together send one read and both print its counts", async () => {
    answer(() => Promise.resolve(WALL));
    render(<><AtsCoverage variant="strip" /><AtsCoverage /></>);
    await waitFor(() => expect(screen.getAllByText("48,102")).toHaveLength(2));
    expect(reads()).toBe(1);
  });

  it("two hooks mounted while one read is pending both take its answer", async () => {
    let settle: (v: unknown) => void = () => {};
    answer(() => new Promise((r) => { settle = r; }));
    const a = renderHook(() => useBoardVendorCounts());
    const b = renderHook(() => useBoardVendorCounts());
    expect(reads()).toBe(1);
    settle(WALL);
    await waitFor(() => expect(a.result.current.ready && b.result.current.ready).toBe(true));
    expect(b.result.current.counts).toEqual({ greenhouse: 48_102, workday: 305_380 });
    expect(reads()).toBe(1);
  });

  it("the deploy-window fallback is shared too: one slim attempt, one wide read", async () => {
    answer((fn) => Promise.resolve(fn === "get_board_vendor_counts" ? { data: null, error: { code: "PGRST202" } } : WALL));
    const a = renderHook(() => useBoardVendorCounts());
    const b = renderHook(() => useBoardVendorCounts());
    await waitFor(() => expect(a.result.current.ready && b.result.current.ready).toBe(true));
    expect([reads(), reads("get_job_board_facets")]).toEqual([1, 1]);
  });
});

describe("a shared read is never an old answer", () => {
  it("a mount after the read settled asks again, and gets the new answer", async () => {
    answer(() => Promise.resolve(WALL));
    const a = renderHook(() => useBoardVendorCounts());
    await waitFor(() => expect(a.result.current.ready).toBe(true));
    const later = { ...WALL, data: { ...WALL.data, openTotal: 400_000 } };
    answer(() => Promise.resolve(later));
    const b = renderHook(() => useBoardVendorCounts());
    await waitFor(() => expect(b.result.current.openTotal).toBe(400_000));
    expect(reads()).toBe(2);
  });

  it("a failed read is not shared with the next mount", async () => {
    answer(() => Promise.resolve({ data: null, error: { code: "57014" } }));
    const a = renderHook(() => useBoardVendorCounts());
    await waitFor(() => expect(reads()).toBe(1));
    await Promise.resolve();
    expect(a.result.current.ready).toBe(false);
    answer(() => Promise.resolve(WALL));
    const b = renderHook(() => useBoardVendorCounts());
    await waitFor(() => expect(b.result.current.ready).toBe(true));
    expect(reads()).toBe(2);
  });

  it("a read that never answers is forgotten after five seconds, so the next wall is not held at names only", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    answer(() => new Promise(() => {}));
    renderHook(() => useBoardVendorCounts());
    vi.advanceTimersByTime(4_999);
    renderHook(() => useBoardVendorCounts());
    expect(reads(), "still inside the five seconds: shared").toBe(1);
    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    answer(() => Promise.resolve(WALL));
    const c = renderHook(() => useBoardVendorCounts());
    await waitFor(() => expect(c.result.current.ready).toBe(true));
    expect(reads()).toBe(2);
  });
});
