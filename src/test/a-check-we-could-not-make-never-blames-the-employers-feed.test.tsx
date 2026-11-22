// A CHECK WE COULD NOT MAKE NEVER BLAMES THE EMPLOYER'S FEED (L2-15, the page's half).
//
// WHAT WAS WRONG. A reader reports a posting gone and the board re-checks it
// against the employer's own system. The server answers live:null whenever it
// could not decide, and the page read every null as "this employer's feed
// lists more roles than it lets us read in one pass". But the server answers
// null when its own fetch throws, when the employer's system answers anything
// but found or not found, when the board read fails and when the posting's
// board has left the catalogue. For Greenhouse, Lever and SmartRecruiters,
// which are asked for one posting at a time, a null can never be a page cap.
// A time-out of ours was published as a fact about a named employer.
//
// WHAT HOLDS NOW, on the mounted board, reporting a posting gone:
//   - a null with no reason says "We couldn't check it just now" and nothing
//     about the employer's feed;
//   - a null the server names as some other reason says the same;
//   - only a null the server names "page-capped" keeps the feed sentence.
// The server's half (the reason beside each null in job-board's verify) is
// the jobs build's; until it ships, every null reads as the neutral sentence.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { choosePostingMenuItem } from "./helpers/posting-menu";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
import { Toaster } from "@/components/ui/toaster";

vi.setConfig(MOUNT_TEST_BUDGET);

type Body = Record<string, unknown>;
// A Greenhouse posting: read one at a time, so no answer about it is a page cap.
const ROW = {
  id: "greenhouse:acme:4411", token: "acme", company: "Acme", title: "Staff Nurse",
  location: "Leeds, United Kingdom", salary: null, applyUrl: "https://x/1", source: "greenhouse",
  postedAt: new Date(Date.now() - 86400000).toISOString(),
  recheckedAt: new Date(Date.now() - 600_000).toISOString(),
};

async function reportGone(verifyAnswer: Record<string, unknown>) {
  invoke.mockImplementation(async (fn: string, o: { body?: Body } | undefined) => {
    if (fn !== "job-board") return { data: null, error: null };
    const b = o?.body ?? {};
    if (b.action === "verify") return { data: verifyAnswer, error: null };
    if (b.action === "report") return { data: { ok: true }, error: null };
    if (b.action === "list") {
      if (b.countOnly) return { data: { total: 1 }, error: null };
      if (b.facetCounts) return { data: { categories: {} }, error: null };
      return { data: { jobs: [ROW], total: 1, totalAllCompanies: 1, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false }, error: null };
    }
    return { data: null, error: null };
  });
  window.history.replaceState({}, "", "/jobs");
  render(<MemoryRouter><Jobs /><Toaster /></MemoryRouter>);
  await waitFor(() => expect(document.body.textContent).toContain("Staff Nurse"), SLOW);
  await act(async () => { await choosePostingMenuItem(document.querySelector<HTMLElement>("[data-job-id]")!, "Posting is gone"); });
}
const text = () => document.body.textContent ?? "";
const FEED = /feed lists more roles than it lets us read/;
const NEUTRAL = /We couldn't check it just now/;

beforeEach(() => {
  cleanup();
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  invoke.mockReset();
  clearBoardBudgetRefusal();
});

describe("the board could not decide whether a reported posting is gone", () => {
  it("a null with no reason says we could not check, and nothing about the employer's feed", async () => {
    await reportGone({ live: { [ROW.id]: null } });
    await waitFor(() => expect(text()).toMatch(NEUTRAL), SLOW);
    expect(text(), "our own undecided check was published as the size of a named employer's feed").not.toMatch(FEED);
    expect(text()).toMatch(/Your report is logged/);
  });

  it.each(["unreachable", "uncatalogued"])("a null the server names %s says the same", async (reason) => {
    await reportGone({ live: { [ROW.id]: null }, uncheckable: { [ROW.id]: reason } });
    await waitFor(() => expect(text()).toMatch(NEUTRAL), SLOW);
    expect(text()).not.toMatch(FEED);
  });

  it("a reason given for another posting does not speak for this one", async () => {
    await reportGone({ live: { [ROW.id]: null }, uncheckable: { "workday:other:1": "page-capped" } });
    await waitFor(() => expect(text()).toMatch(NEUTRAL), SLOW);
    expect(text()).not.toMatch(FEED);
  });

  it("control: a null the server names page-capped keeps the feed sentence, because there it is true", async () => {
    await reportGone({ live: { [ROW.id]: null }, uncheckable: { [ROW.id]: "page-capped" } });
    await waitFor(() => expect(text()).toMatch(FEED), SLOW);
    expect(text()).toContain("Acme's feed");
    expect(text()).not.toMatch(NEUTRAL);
  });

  it("control: a posting the employer still lists is still said to be listed", async () => {
    await reportGone({ live: { [ROW.id]: true } });
    await waitFor(() => expect(text()).toMatch(/own board still lists this role as open/), SLOW);
  });
});
