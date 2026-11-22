// CMD+K AND CTRL+J DO NOT MOVE THE SELECTED POSTING (S10-154).
//
// WHAT WAS WRONG. The board steers its list with j and k (and Enter applies to
// the open posting on a wide screen). Its window key handler never looked at
// the modifier keys. Cmd+K opens the command palette, and this handler, still
// holding the render in which the palette was closed, also moved the selected
// posting up one. Ctrl+J and Alt+K were taken the same way and their default
// was cancelled, so the browser's own shortcut on those keys was swallowed.
//
// WHAT HOLDS NOW, on the mounted board with the second posting selected:
//   - j or k pressed with Ctrl, Alt or Cmd leaves the selection where it is
//     and the key event uncancelled; Cmd+K is the palette's own chord, so it
//     opens the palette and still moves nothing;
//   - control: plain j and k still move it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async (fn: string) => rpcAnswer(fn),
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
let rpcAnswer: (fn: string) => unknown = () => ({ data: [], error: null });

import Jobs from "@/pages/Jobs";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
const row = (n: number) => ({
  id: `greenhouse:acme:${n}`, token: "acme", company: `Employer ${n}`, title: `Nurse ${n}`, location: "Austin, TX, USA", country: "US",
  salary: null, applyUrl: `https://x/${n}`, source: "greenhouse",
  postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), recheckedAt: new Date(Date.now() - 3600_000).toISOString(),
});
const ROWS = [row(1), row(2), row(3)];

function mount() {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "detail") return { data: { description: `About posting ${String(b.id)}.` }, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 3 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: ROWS, total: 3, totalAllCompanies: 3, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    if (b.action === "facets") return { data: { categories: {}, sources: {} }, error: null };
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", "/jobs");
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

/** The posting the board has open: the one its address names. */
const selected = () => new URLSearchParams(window.location.search).get("job");
/** A key pressed with nothing focused; false when the page cancelled it. */
const press = (init: KeyboardEventInit) => fireEvent.keyDown(document.body, init);

/** Two plain j presses: the second posting is the open one. */
async function selectTheSecond() {
  mount();
  await waitFor(() => expect(document.body.textContent).toContain("Nurse 3"), SLOW);
  press({ key: "j" });
  await waitFor(() => expect(selected()).toBe(ROWS[0].id), SLOW);
  press({ key: "j" });
  await waitFor(() => expect(selected()).toBe(ROWS[1].id), SLOW);
}

beforeEach(() => {
  // jsdom lays nothing out: the list's scroll to the moved-to card is a no-op here.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
});
afterEach(cleanup);

describe("a key pressed with a modifier", () => {
  it.each([
    ["Ctrl+J", { key: "j", ctrlKey: true }],
    ["Alt+K", { key: "k", altKey: true }],
    ["Cmd+J", { key: "j", metaKey: true }],
  ] as Array<[string, KeyboardEventInit]>)("%s leaves the selected posting where it is and is not cancelled", async (_name, init) => {
    await selectTheSecond();
    const notCancelled = press(init);
    await new Promise((r) => setTimeout(r, 150));
    expect(selected(), "the chord moved the selected posting").toBe(ROWS[1].id);
    expect(notCancelled, "the chord's own default was cancelled").toBe(true);
  });

  it("Cmd+K opens the palette, which owns that chord, and leaves the selected posting where it is", async () => {
    await selectTheSecond();
    press({ key: "k", metaKey: true });
    await waitFor(() => expect(document.querySelector('[role="dialog"][aria-label="Quick actions"]'), "the palette did not open").not.toBeNull(), SLOW);
    await new Promise((r) => setTimeout(r, 150));
    expect(selected(), "Cmd+K also moved the selected posting up").toBe(ROWS[1].id);
  });

  it("control: plain k moves up and plain j moves down, and both are the board's", async () => {
    await selectTheSecond();
    expect(press({ key: "k" }), "the board did not take plain k").toBe(false);
    await waitFor(() => expect(selected()).toBe(ROWS[0].id), SLOW);
    press({ key: "j" });
    press({ key: "j" });
    await waitFor(() => expect(selected()).toBe(ROWS[2].id), SLOW);
  });
});
