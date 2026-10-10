// AN UNCOUNTED INDUSTRY IS NOT AN EMPTY ONE.
//
// The board's facet handler numbers the eighteen industries in chunks of six
// and races a wall-clock budget (FACET_DEADLINE — 1.5s once a text query is
// involved, because those per-category counts are the single largest cost of
// the request). When the budget runs out it BREAKS OUT of the loop and answers
// with the categories it finished. Its own comment says what that is meant to
// look like on screen: "Categories past it keep their chip and lose their
// number".
//
// The industry rail did the opposite. It read a missing count through `?? 0`
// and then filtered on `> 0`, so a category the clock never reached was
// DELETED — and the number it would have printed was "0". Typing anything into
// the search box therefore dropped most of the rail, including fields holding
// thousands of matching roles, and WHICH fields disappeared changed between
// two identical searches, because a server-side deadline decided it.
//
// The dropdown four hundred lines above has always had this right: it keeps
// every option and renders a number only when one exists. This guard holds the
// two controls to the same rule and — the part that matters — pins the
// distinction the bug erased: absent is not zero.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

// A full-page mount per case: the per-test budget comes from mount-budget.ts.
vi.setConfig(MOUNT_TEST_BUDGET);

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
const SERVER = strip(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));

// What a deadline-truncated facet answer actually looks like: the first chunk
// finished, the rest never ran. `engineering` is genuinely empty under this
// filter and says so; `design` and everything after it is simply unknown.
const FIRST_CHUNK_ONLY: Record<string, number> = {
  engineering: 0,
  data_ai: 4_210,
  healthcare: 31_884,
};
const ALL_KNOWN_EMPTY: Record<string, number> = { engineering: 0, data_ai: 0, healthcare: 0 };
const LIST_LATE_MS = 30;

function boardMock(categories: Record<string, number>) {
  invoke.mockImplementation(async (fn: string, opts: { body?: Record<string, unknown> } | undefined) => {
    const body = opts?.body ?? {};
    if (fn === "job-board" && body.action === "list") {
      // THE REPLY LANDS A TICK LATE, ON PURPOSE. Before it arrives the rail
      // shows every industry with no number (nothing counted yet), so a case
      // that read the rail as soon as the request went out read that state
      // and failed on 6 of the 15 red runs in main's last 20 (10-04..10-10). A fixed
      // delay makes that order deterministic here.
      await new Promise((r) => setTimeout(r, LIST_LATE_MS));
      return {
        data: {
          jobs: [], total: 0, totalAllCompanies: 0, companies: [], companiesCount: 0,
          categories, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: null };
  });
}

const railChips = () =>
  screen.queryAllByRole("button")
    .filter((b) => b.className.includes("rounded-full") && b.querySelector("span[aria-hidden='true']"));
const chipText = () => railChips().map((b) => b.textContent ?? "");

describe("an uncounted industry is not an empty one", () => {
  beforeEach(() => { invoke.mockReset(); });

  it("the server abandons per-category counts on a deadline, so absent is a state it really produces", () => {
    // The premise. If this ever stops being true the rail's rule can be
    // simplified — but it must be checked, not assumed.
    expect(SERVER).toMatch(/const FACET_DEADLINE = Date\.now\(\) \+ \(qText \? 1_500 : 4_000\);/);
    expect(SERVER, "the loop must be able to stop early, leaving categories uncounted")
      .toMatch(/if \(Date\.now\(\) > FACET_DEADLINE\) break;/);
  });

  it("behaviour: a category the count never reached keeps its chip and shows no number", async () => {
    boardMock(FIRST_CHUNK_ONLY);
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    // A NUMBER ON A CHIP, not just chips: before the reply the rail already
    // shows every industry, uncounted.
    await waitFor(() => expect(chipText().some((s) => s.includes("31,884"))).toBe(true), SLOW);
    const texts = chipText();
    // Counted and non-zero: chip plus number.
    expect(texts.some((s) => s.includes("Healthcare") && s.includes("31,884"))).toBe(true);
    // NEVER COUNTED: the chip survives, and it does not invent a number.
    const design = texts.find((s) => s.startsWith("Design"));
    expect(design, "an uncounted industry was deleted from the rail").toBeDefined();
    expect(design, "an uncounted industry was labelled 0").not.toMatch(/\d/);
    // Counted as zero: the one case that IS a removal.
    expect(texts.some((s) => s.startsWith("Engineering")), "a category the server counted as 0 must go").toBe(false);
  });

  it("behaviour: the rail is not silently truncated to whatever the budget happened to reach", async () => {
    // The user-visible shape of the defect — three of eighteen industries on
    // screen after typing a query. Derived from the response rather than a
    // hand-listed set, so a nineteenth category is covered the day it ships.
    boardMock(FIRST_CHUNK_ONLY);
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    // The reply on the rail, not the uncounted rail before it: that one also
    // holds seventeen chips, so the count below would pass on it unread.
    await waitFor(() => expect(chipText().some((s) => s.includes("31,884"))).toBe(true), SLOW);
    const zeroed = Object.values(FIRST_CHUNK_ONLY).filter((n) => n === 0).length;
    const counted = Object.keys(FIRST_CHUNK_ONLY).length;
    // 18 categories, minus the ones actually counted as zero.
    expect(railChips().length).toBe(18 - zeroed);
    expect(railChips().length).toBeGreaterThan(counted);
  });

  it("behaviour: when every count DID come back and every count is zero, the rail empties", async () => {
    // The inverse guard. "Keep the chip when absent" must not become "keep
    // every chip always" — a measured-empty field is still removed.
    boardMock(ALL_KNOWN_EMPTY);
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    // WAIT FOR THE REPLY TO BE ON THE RAIL, not for the request to leave.
    // Before the reply every chip is present uncounted, Engineering included,
    // so its absence beside a surviving uncounted Design is the reply on
    // screen; an empty rail cannot satisfy this.
    await waitFor(() => {
      expect(chipText().some((s) => s.startsWith("Design")), "the uncounted industry vanished too").toBe(true);
      expect(chipText().some((s) => s.startsWith("Engineering")), "the reply never reached the rail").toBe(false);
    }, SLOW);
    for (const label of ["Engineering", "Data", "Healthcare"]) {
      expect(chipText().some((s) => s.startsWith(label)), `${label} was counted as 0 and must not show`).toBe(false);
    }
  });

  it("the rail and the dropdown apply the SAME rule to a missing count", () => {
    const MULTI = strip(readFileSync(resolve(ROOT, "src/components/board/MultiSelectFilter.tsx"), "utf8"));
    // The dropdown: an option is never removed, and prints a number only when
    // it has one.
    expect(MULTI).toMatch(/typeof o\.count === "number" && o\.count > 0/);
    // The rail: a chip is removed only on a count that came back as 0, and
    // prints a number only when it has one.
    expect(JOBS).toMatch(/railCount\(c\) !== 0/);
    expect(JOBS).toMatch(/typeof n === "number" && <span className="opacity-70">\{fmtFacet\(n\)\}<\/span>/);
    // The exact shape of the defect, in either control.
    expect(JOBS, "a missing facet count is being read as zero again")
      .not.toMatch(/\(railCounts\[c\] \?\? 0\) > 0/);
    expect(JOBS, "a missing facet count must never be printed as 0")
      .not.toMatch(/fmtFacet\(railCounts\[c\] \?\? 0\)/);
  });

  it("no rail count reaches the screen except through fmtFacet", () => {
    // The capped-value rule this file's neighbour protects still holds: every
    // number the rail prints goes through the formatter that turns the cap
    // into "10,000+". Scoped to the rail block and COUNTED, rather than pinned
    // to one spelling of one line.
    const from = JOBS.indexOf("const railCounts =");
    const to = JOBS.indexOf("worthToggling && (", from);
    expect(from, "the rail block moved — re-point this guard").toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const RAIL = JOBS.slice(from, to);
    expect((RAIL.match(/fmtFacet\(/g) ?? []).length, "the rail prints exactly one count, through fmtFacet").toBe(1);
    expect(RAIL, "a rail count is being printed without fmtFacet").not.toMatch(/toLocaleString\(\)/);
  });
});
