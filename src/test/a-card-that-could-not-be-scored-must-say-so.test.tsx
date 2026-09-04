// A CARD THAT COULD NOT BE SCORED MUST SAY SO.
//
// job-fit answers `fits[id] = null` — a deliberate, honest null — for a posting
// it holds no stored description for. The board turned that into a tier:
//
//     const tier = typeof fit === "number" ? (…) : null;
//
// and rendered the chip on `tier &&`. So `null` (we could not measure this) and
// `undefined` (the batch is still in flight) both fell through to NO CHIP, and
// an unscorable card was pixel-identical to one that genuinely scored 4%. On a
// board whose whole promise is "ranked against YOUR résumé", the reader had no
// way to tell "your résumé is a poor match for this" from "we never compared
// them" — and only one of those is a statement about them.
//
// The absence of a measurement is not a low measurement. It gets its own chip,
// deliberately shaped so it cannot be misread as the muted "Stretch" pill that
// occupies the same slot: outlined and dashed rather than filled and bold.
//
// The board-wide note already said "postings without stored descriptions show
// no score". It is true, it is one line under a control row, and it does not
// tell you WHICH of the twenty cards in front of you it is about.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
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
const RAW = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
// Code literals against comment-stripped source; a comment's prose against RAW.
const JOBS = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const SLOW = { timeout: 4000 } as const;
const RESUME = "registered nurse ".repeat(20);

// j0 has no stored description on the server: the scorer answers null for it.
// j1 scores 4% — a genuinely poor match, which is the card the null one used to
// be indistinguishable from.
const ROWS = [
  { id: "j0", company: "Acme", title: "Undescribed Role", location: "Remote", salary: null, applyUrl: "https://x/0", source: "greenhouse", token: "acme", postedAt: null },
  { id: "j1", company: "Beta", title: "Described Role", location: "Remote", salary: null, applyUrl: "https://x/1", source: "greenhouse", token: "beta", postedAt: null },
];
const FITS: Record<string, number | null> = { j0: null, j1: 4 };

/** Release valve for the fit batch, so "no chip yet" can be tested against a
 *  request genuinely still in flight rather than one that already answered. */
let releaseFit: () => void = () => {};

function mount(opts: { holdFit?: boolean } = {}) {
  const gate = new Promise<void>((r) => { releaseFit = r; });
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit" && b.action === "fit-terms") return { data: { terms: [] } };
    if (fn === "job-fit" && b.action === "fit-batch") {
      if (opts.holdFit) await gate;
      const ids = (b.ids as string[]) ?? [];
      return { data: { fits: Object.fromEntries(ids.map((id) => [id, FITS[id] ?? null])), missing: {}, matched: {} } };
    }
    if (fn === "job-board" && b.action === "detail") {
      return { data: { job: ROWS.find((r) => r.id === b.id) ?? null, description: "" } };
    }
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: ROWS.length } };
      return {
        data: {
          jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length, companies: [], companiesCount: 0,
          categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement | null;
const dropResume = () =>
  fireEvent.change(fileInput()!, { target: { files: [new File([RESUME], "cv.txt", { type: "text/plain" })] } });
const chips = (label: string) => screen.queryAllByText(label);

describe("a card that could not be scored must say so", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset();
  });

  it("behaviour: an unscorable card is labelled, and a genuinely low one is still a Stretch", async () => {
    mount();
    await waitFor(() => expect(fileInput()).not.toBeNull(), SLOW);
    dropResume();
    await waitFor(() => expect(chips("Not scored").length).toBe(1), SLOW);
    // COUNTED: one null in the batch, one chip. Two would mean the low score
    // had been swept into "not scored", which is the opposite mistake.
    expect(chips("Stretch").length, "the 4% card must keep its honest tier").toBe(1);
    // And the two are not the same element wearing two labels.
    const notScored = chips("Not scored")[0];
    const stretch = chips("Stretch")[0];
    expect(notScored.className, "the not-scored chip is a filled tier pill again")
      .toContain("border-dashed");
    expect(stretch.className, "a real tier must stay a filled pill").not.toContain("border-dashed");
  });

  it("behaviour: a batch still in flight shows no chip — undefined is not null", async () => {
    // The distinction the old code collapsed. A pending score must not be
    // announced as unmeasurable.
    mount({ holdFit: true });
    await waitFor(() => expect(fileInput()).not.toBeNull(), SLOW);
    dropResume();
    await waitFor(() => expect(screen.queryAllByText("Described Role").length).toBeGreaterThan(0), SLOW);
    expect(chips("Not scored").length).toBe(0);
    releaseFit();
    await waitFor(() => expect(chips("Not scored").length).toBe(1), SLOW);
  });

  it("behaviour: with ranking off, no card claims anything about scoring", async () => {
    mount();
    await waitFor(() => expect(screen.queryAllByText("Undescribed Role").length).toBeGreaterThan(0), SLOW);
    expect(chips("Not scored").length).toBe(0);
    expect(chips("Stretch").length).toBe(0);
  });

  it("behaviour: the detail panel says it too, in words, not by omission", async () => {
    window.history.replaceState({}, "", "/jobs?job=j0");
    mount();
    await waitFor(() => expect(fileInput()).not.toBeNull(), SLOW);
    dropResume();
    await waitFor(
      () => expect(document.body.textContent).toContain("Not scored — we hold no description for this posting"),
      SLOW,
    );
    expect(document.body.textContent).toContain("the absence of a measurement");
    // The scoring spinner is for a request in flight and must not linger over
    // an answered null.
    expect(document.body.textContent).not.toContain("Scoring this posting against your resume");
  });

  it("the null branch is read explicitly, not left to fall out of the tier test", () => {
    expect(JOBS).toMatch(/const unscorable = fitRanking && fits\[job\.id\] === null;/);
    expect(JOBS, "the detail panel needs its own explicit null branch")
      .toMatch(/\{fitRanking && fits\[detailJob\.id\] === null && \(/);
    // The three fit states are each read by identity somewhere in the panel:
    // number (a score), undefined (in flight), null (unmeasurable).
    expect(JOBS).toMatch(/fits\[detailJob\.id\] === undefined/);
    expect(JOBS).toMatch(/typeof fits\[detailJob\.id\] === "number"/);
  });

  it("the reason a null is not a tier stays written down", () => {
    // PROSE, so RAW source. Without it the next tidy-up folds `unscorable` back
    // into `tier` and the chip becomes a fourth band.
    expect(RAW).toMatch(/AN HONEST NULL IS NOT A LOW SCORE/);
    expect(RAW).toMatch(/Deliberately NOT a tier/);
  });

  it("every new string is translated in all nine locales", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    const en = JSON.parse(readFileSync(resolve(dir, "en.json"), "utf8")) as { jobsPage: Record<string, string> };
    for (const f of files) {
      const jp = (JSON.parse(readFileSync(resolve(dir, f), "utf8")) as { jobsPage?: Record<string, string> }).jobsPage ?? {};
      for (const k of ["notScoredChip", "notScoredTip", "detailNotScored", "detailNotScoredBody"]) {
        expect(typeof jp[k], `${f}: jobsPage.${k}`).toBe("string");
        expect(jp[k]!.trim().length, `${f}: jobsPage.${k} is empty`).toBeGreaterThan(0);
        if (f !== "en.json" && f !== "en-GB.json") {
          expect(jp[k], `${f}: jobsPage.${k} is still the English text`).not.toBe(en.jobsPage[k]);
        }
      }
    }
  });
});
