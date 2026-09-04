// A SECOND RÉSUMÉ THE BOARD NEVER READ.
//
// `fits`, `misses` and `hits` are derived from ONE résumé and nothing cleared
// them, while the scoring effect only ever asks the scorer about rows it
// considers unscored — and after a first pass, every row on screen has a
// score. So a second résumé changed the toast, changed nothing else, and left
// the board rendering "ordered by fit to your résumé" over badges, matched
// keywords and missing keywords computed from the file the reader had
// replaced. The effect could not even re-run: it keys on `jobs`, and a second
// résumé only changes `jobs` if it also changes the query.
//
// WHAT THE DEFECT REPORT GOT WRONG, AND IT MATTERS. The gesture it describes —
// "drop a different résumé" — cannot be performed. The drop panel is the only
// route to handleBoardResumeFile and the only file input on the page, and it
// renders under `resumeAvailable === false && !fitRanking`; a successful drop
// sets both, so the panel closes behind the first résumé and never reopens.
// Verified in a mounted board below, not by reading. The defect is therefore
// LATENT, not live: real mechanism, no door.
//
// It is fixed anyway, and fixed at the ref rather than at the drop handler,
// because the door is the part most likely to change ("let me try a different
// résumé" is an obvious next feature) and because there are four routes a
// résumé can arrive by — the drop, the "For you" toggle, the auto-enable
// effect, and resolveFitResume's own four sources. A fix at one of them is a
// fix at one of them. So the guard below is COUNTED: there is exactly one
// assignment to fitResume.current in the file, and it is the one that clears
// what the previous résumé derived. A fifth route added tomorrow either goes
// through it or fails this test.
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

const NURSE = "registered nurse ".repeat(20);
const JOBS_ROWS = Array.from({ length: 3 }, (_, i) => ({
  id: `j${i}`, company: `Employer ${i}`, title: `Role ${i}`, location: "Remote",
  salary: null, applyUrl: `https://x/${i}`, source: "greenhouse",
}));

let fitBatches: Array<{ resume: string; ids: string[] }> = [];
const SLOW = { timeout: 4000 } as const;

function boardMock() {
  invoke.mockImplementation(async (fn: string, opts: { body?: Record<string, unknown> } | undefined) => {
    const b = opts?.body ?? {};
    if (fn === "job-fit" && b.action === "fit-terms") return { data: { terms: [] } };
    if (fn === "job-fit" && b.action === "fit-batch") {
      const resume = String(b.resumeText ?? "");
      const ids = (b.ids as string[]) ?? [];
      fitBatches.push({ resume, ids });
      const pct = resume.includes("nurse") ? 11 : 88;
      return { data: { fits: Object.fromEntries(ids.map((id) => [id, pct])), missing: {}, matched: {} } };
    }
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: 0 } };
      return {
        data: {
          jobs: JOBS_ROWS, total: 3, totalAllCompanies: 3, companies: [], companiesCount: 0,
          categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: null };
  });
}

/** The per-card coverage tooltip carries the exact percentage, so it says which
 *  résumé each badge on screen was actually computed from. */
const coverageTooltips = () =>
  Array.from(document.querySelectorAll("[title]"))
    .map((e) => e.getAttribute("title") ?? "")
    .filter((t) => t.includes("recognized keywords"));

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement | null;
const dropResume = (text: string, name: string) =>
  fireEvent.change(fileInput()!, { target: { files: [new File([text], name, { type: "text/plain" })] } });

describe("a second resume the board never read", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); } catch { /* blocked */ }
    fitBatches = [];
    invoke.mockReset();
    boardMock();
  });

  it("behaviour: a dropped résumé scores the board, once", async () => {
    // The ordinary path, which the fix must not cost. Clearing derived state on
    // a FIRST résumé would re-enter the scoring effect and pay for a second
    // identical round of batches, so the clear is conditional on there having
    // been a previous one.
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    await waitFor(() => expect(fileInput()).not.toBeNull(), SLOW);
    dropResume(NURSE, "nurse.txt");
    await waitFor(() => expect(coverageTooltips().length).toBe(3), SLOW);
    for (const t of coverageTooltips()) expect(t).toContain("11%");
    expect(fitBatches.map((b) => b.ids), "the first résumé must not be scored twice").toHaveLength(1);
    // The handler trims before storing, so compare against what it stores.
    expect(fitBatches[0].resume).toBe(NURSE.trim());
  });

  it("behaviour: the board offers no second drop — which is why this defect is latent, not live", async () => {
    // A TRIP-WIRE, NOT A PREFERENCE. If a future change reopens this door (and
    // "try a different résumé" is an obvious feature), the invariant below is
    // what makes it safe — read this file's header before deleting this.
    render(<MemoryRouter><Jobs /></MemoryRouter>);
    await waitFor(() => expect(fileInput()).not.toBeNull(), SLOW);
    dropResume(NURSE, "nurse.txt");
    await waitFor(() => expect(coverageTooltips().length).toBe(3), SLOW);
    expect(
      fileInput(),
      "a second résumé can now be dropped — confirm the derived-score clear covers that route",
    ).toBeNull();
    expect(screen.queryAllByText(/Drop your résumé here/)).toHaveLength(0);
  });

  it("there is exactly ONE place a résumé is adopted, and it clears what the last one derived", () => {
    // Counted, not named. Four routes reach a résumé today and the fix has to
    // survive a fifth.
    const assignments = [...JOBS.matchAll(/fitResume\.current\s*=\s*/g)];
    expect(
      assignments.length,
      "a résumé is assigned somewhere other than the one adopter — that route keeps the previous résumé's scores",
    ).toBe(1);
    const adopter = /const adoptFitResume = \(text: string\) => \{([\s\S]*?)\n {2}\};/.exec(JOBS)?.[1];
    expect(adopter, "the adopter moved — re-point this guard").toBeTruthy();
    expect(adopter).toContain("fitResume.current = text");
    // Everything the previous résumé produced.
    for (const setter of ["setFits({})", "setMisses({})", "setHits({})", "setFitFailedCount(0)"]) {
      expect(adopter, `${setter} is missing — that derived state survives a résumé change`).toContain(setter);
    }
    // ...and only when there WAS a previous one.
    expect(adopter, "a first résumé must not trigger a clear-and-rescore").toMatch(/if \(!prev \|\| prev === text\) return;/);
  });

  it("clearing the scores is useless unless it also re-runs the scorer", () => {
    // The clear alone changes nothing: the scoring effect does not depend on
    // `fits`, so emptying it re-renders and no request follows. Derived — read
    // the generation the adopter bumps and require the effect to depend on it.
    const adopter = /const adoptFitResume = \(text: string\) => \{([\s\S]*?)\n {2}\};/.exec(JOBS)![1];
    const bump = /set([A-Z]\w*)\(\(n\) => n \+ 1\)/.exec(adopter);
    expect(bump, "nothing re-runs the scorer after a résumé change").toBeTruthy();
    const stateName = bump![1][0].toLowerCase() + bump![1].slice(1);
    const deps = /\}, \[fitRanking, jobs, refreshing[^\]]*\]\);/.exec(JOBS)?.[0];
    expect(deps, "the scoring effect moved — re-point this guard").toBeTruthy();
    expect(deps, `the adopter bumps \`${stateName}\`, which the scoring effect ignores`).toContain(stateName);
  });

  it("a batch in flight cannot write scores for a résumé that has been replaced", () => {
    // Three batches take seconds. A résumé adopted inside them clears the
    // scores those calls are about to merge back in, so each merge has to
    // re-check — against the résumé itself, so there is no second counter to
    // keep in step.
    const effect = /const unscored = jobs\.filter[\s\S]*?\}, \[fitRanking, jobs, refreshing[^\]]*\]\);/.exec(JOBS)?.[0] ?? "";
    expect(effect, "the scoring effect moved — re-point this guard").not.toBe("");
    expect(
      (effect.match(/if \(fitResume\.current !== resume\) return;/g) ?? []).length,
      "every merge point must re-check: before each batch, and before the failure count",
    ).toBe(2);
  });
});
