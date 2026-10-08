// THE PALETTE'S SCAN ENTRY REACHES THE UPLOADER.
//
// "Scan my resume (free)" in the board's command palette set
// window.location.href = "/#scan". No element carries id="scan" -- the
// uploader is id="upload" (ResumeUploader) and Index's hash handler reads only
// "#upload" -- so the visitor landed at the top of the homepage, after a full
// reload, with the tool they asked for nowhere in view. Every other entry
// point on the board navigates to "/#upload". Judged by where the router goes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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

function Landing() {
  const loc = useLocation();
  return <div data-testid="landed">{`${loc.pathname}${loc.hash}`}</div>;
}

beforeEach(() => {
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "list" && !b.countOnly && !b.facetCounts) {
      return { data: { jobs: [], total: 0, totalAllCompanies: 0, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    return { data: null, error: null };
  });
});

describe("the palette's scan entry reaches the uploader", () => {
  it("routes to /#upload, the anchor the uploader carries", async () => {
    window.history.replaceState({}, "", "/jobs");
    render(
      <MemoryRouter initialEntries={["/jobs"]}>
        <Routes>
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/" element={<Landing />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelector("main h1")).toBeTruthy(), SLOW);
    await act(async () => { fireEvent.keyDown(window, { key: "k", ctrlKey: true }); });
    const entry = await screen.findByText("Scan my resume (free)");
    try { fireEvent.click(entry); } catch { /* a full-page navigation is not implemented in jsdom */ }
    await waitFor(() => expect(screen.getByTestId("landed").textContent, "the entry did not reach the uploader's anchor").toBe("/#upload"), SLOW);
  });
});
