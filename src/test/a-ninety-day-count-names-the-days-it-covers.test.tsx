// A NINETY-DAY COUNT NAMES THE DAYS IT COVERS.
//
// closed_90d is every takedown in the last 90 days (refresh_ghost_stats,
// `closed_at > now() - interval '90 days'`). observed_days is something else:
// the age of the whole closure ledger, CEIL of now() minus its first row. The
// ledger's prune has been off since 20261001090000, and sat at 180 days before
// that, so the second number grows without limit and the first never covers
// more than 90 days of it.
//
// Two public sentences printed one beside the other as if they measured the
// same stretch. The Ghost Job Index opened its closure paragraph with "In the
// N days we've kept this record we've watched <closed_90d> roles come down",
// and the /data-api hero tile read "<closed_90d> closures logged in N days",
// N being observed_days both times. That was exact while the ledger was the
// younger of the two -- 79 days deep on 2026-10-01 -- and it goes false the
// day the ledger passes 90, between 2026-10-12 and 10-13: a 90-day count over
// "180 days" reads as everything we saw in 180, understating the record by
// whatever fell outside the window. The opener's fallback, for a row with no
// depth at all, said "since we started keeping this record", which claims the
// whole record outright. The re-review of the /hiring-trends ceiling fix found
// both sentences, after that fix capped the ceiling's own divisor at 90.
//
// So the span is one fact with one definition, closureCountSpanDays in
// src/lib/hiring-trends-trust.ts, which the ceiling divides by and both pages
// print. This file pins no wording. It finds the sentence each surface prints
// the count in and READS THE SPANS OF DAYS OUT OF IT; the smallest is the
// window the sentence gives the count (any depth it states beside it is at
// least that), and it must be the days the count actually covers: the whole
// record while the record is younger than 90 days, 90 once it is older, and
// 90 when the row carries no depth, because the count's own filter is then
// the only span anyone knows. A sentence that states no span fails too, and
// so does one that knows the record's depth and never says it: a correct
// window printed as "the 90 days we've kept this record" over a record of 180
// is the same understatement told about the record instead of the count. The
// prerender's Ghost Job Index label ("in the last 90 days, from a record N
// days deep") is read the same way, as the positive control: it was always
// right, so it shows the rule accepts honest wording it was not written from.
//
// Red on e9a56ed6 (the branch before this change): both React sentences
// disagree on every record deeper than 90 days and on the row with no depth,
// and pass on the rest; the crawler label passes throughout. Each run, and
// each mutation that turned this file red, is recorded in the commit.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => stubTable(),
    functions: { invoke: async () => ({ data: {} }) },
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

import GhostJobIndex from "../pages/GhostJobIndex";
import DataApi from "../pages/DataApi";
import {
  CLOSURE_RECORD_WINDOW_DAYS,
  closureCeiling,
  closureCountSpanDays,
} from "@/lib/hiring-trends-trust";

// ── the rule, and reading a span out of a sentence ──────────────────────────

const CLOSED = 1_852_789;
/** As both pages format it (Number#toLocaleString with the default locale). */
const SHOWN = CLOSED.toLocaleString();

/** A record by depth; `null` is a row that carries no depth at all, and
 *  `legacy` carries it under the column's pre-rename name. */
type Depth = number | null | { legacy: number };
const DEPTHS: Depth[] = [1, 12, 79, 89, 90, 91, 120, 180, 400, null, { legacy: 12 }, { legacy: 200 }];

const depthOf = (d: Depth) => (d === null ? null : typeof d === "number" ? d : d.legacy);
const labelOf = (d: Depth) => (d === null ? "no depth" : typeof d === "number" ? `${d} days deep` : `${d.legacy} days deep (tracking_days)`);
/** What the count covers: the record while it is younger than the window, the window after, the window when unknown. */
const covered = (d: Depth) => {
  const days = depthOf(d);
  return days === null ? CLOSURE_RECORD_WINDOW_DAYS : Math.min(days, CLOSURE_RECORD_WINDOW_DAYS);
};
const record = (d: Depth) => ({
  total_open: 752_314,
  total_companies: 9_100,
  total_company_names: 8_800,
  closed_90d: CLOSED,
  median_days_open: 9.4,
  median_days_to_close: null,
  posted_coverage_pct: 99.5,
  computed_at: "2026-10-01T23:05:00+00:00",
  ...(d === null ? {} : typeof d === "number" ? { observed_days: d } : { tracking_days: d.legacy }),
});

/** Every "N days" / "N-day" span a sentence states, as numbers. */
const spans = (sentence: string) =>
  [...sentence.matchAll(/(\d[\d,]*)(?:\s+|-)days?\b/gi)].map((m) => Number(m[1].replace(/,/g, "")));

/** Why a sentence printing the count disagrees with what the count covers, or null. */
function disagreement(sentence: string, d: Depth): string | null {
  const s = spans(sentence);
  if (s.length === 0) return `${labelOf(d)}: states no span of days for the count -- "${sentence}"`;
  const window = Math.min(...s);
  const want = covered(d);
  if (window !== want) return `${labelOf(d)}: gives the count a window of ${window} days; it covers ${want} -- "${sentence}"`;
  const depth = depthOf(d);
  return depth !== null && !s.includes(depth)
    ? `${labelOf(d)}: never says the record is ${depth} days deep, so the window reads as all of it -- "${sentence}"`
    : null;
}

/** The sentences in `root` that print the count, each cut from its block. */
function countSentences(root: ParentNode): string[] {
  const has = (e: Element) => (e.textContent ?? "").includes(SHOWN);
  const hits = [...root.querySelectorAll("*")].filter(has);
  const innermost = hits.filter((e) => ![...e.children].some(has));
  const blocks = [...new Set(innermost.map((e) => e.closest("p, li, div") ?? e))];
  return blocks.flatMap((b) =>
    (b.textContent ?? "").replace(/\s+/g, " ").trim().split(/(?<=\.)\s+/).filter((s) => s.includes(SHOWN)),
  );
}

// ── the surfaces, as each renders ───────────────────────────────────────────

function serve(d: Depth) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_stats_cache") return { data: { computed_at: "2026-10-01T23:12:00+00:00", stale_parts: [], ghost_stats: record(d) } };
    if (fn === "get_ghost_job_index_stats") return { data: [record(d)] };
    return { data: [] };
  });
}

async function sentencesOnPage(page: "ghost" | "data-api", d: Depth): Promise<string[]> {
  serve(d);
  render(<MemoryRouter>{page === "ghost" ? <GhostJobIndex /> : <DataApi />}</MemoryRouter>);
  await waitFor(() => expect(document.body.textContent).toContain(SHOWN), { timeout: 8000 });
  return countSentences(document.body);
}

const PRERENDER = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
const START = "// >>> DATA-PAGE FIGURE BUILDER START";
const END = "// <<< DATA-PAGE FIGURE BUILDER END";
function crawlerSentences(d: Depth): string[] {
  const a = PRERENDER.indexOf(START);
  const b = PRERENDER.indexOf(END);
  expect(a, "the builder's start marker moved").toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  const build = new Function(`${PRERENDER.slice(a, b)}; return dataPageFigures;`)() as (p: unknown) => { ghost: { html: string } };
  const html = build({ stats: { computed_at: "2026-10-01T22:12:00+00:00", stale_parts: [], ghost_stats: record(d) }, transparency: null, freshness: null }).ghost.html;
  return countSentences(new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body);
}

beforeEach(() => { rpc.mockReset(); });
afterEach(() => { cleanup(); });

// ── the cases ───────────────────────────────────────────────────────────────

describe("the span is one fact with one definition", () => {
  it("closureCountSpanDays: the record while younger than the window, the window after, nothing for a non-number", () => {
    expect([1, 12, 79, 89, 90].map(closureCountSpanDays)).toEqual([1, 12, 79, 89, 90]);
    expect([91, 120, 180, 400, 10_000].map(closureCountSpanDays)).toEqual([90, 90, 90, 90, 90]);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "79", null, undefined]) {
      expect(closureCountSpanDays(bad), String(bad)).toBeNull();
    }
  });

  it("the /hiring-trends ceiling divides by the same span the pages print", () => {
    for (const days of [1, 12, 79, 90, 91, 180, 400]) {
      const span = closureCountSpanDays(days)!;
      expect(closureCeiling({ closed_90d: CLOSED, observed_days: days })).toBeCloseTo((CLOSED / span) * 7 * 2, 6);
    }
  });
});

describe("every sentence that prints the 90-day count gives it the days it covers", () => {
  it.each(DEPTHS.map((d) => [labelOf(d), d] as const))("the Ghost Job Index, on a record %s", async (_l, d) => {
    const found = await sentencesOnPage("ghost", d);
    expect(found.length, "the page printed the count in no sentence").toBeGreaterThan(0);
    expect(found.map((s) => disagreement(s, d)).filter(Boolean)).toEqual([]);
  }, 20_000);

  it.each(DEPTHS.map((d) => [labelOf(d), d] as const))("the /data-api tile, on a record %s", async (_l, d) => {
    const found = await sentencesOnPage("data-api", d);
    expect(found.length, "the page printed the count in no sentence").toBeGreaterThan(0);
    expect(found.map((s) => disagreement(s, d)).filter(Boolean)).toEqual([]);
  }, 20_000);

  it("the crawler's Ghost Job Index label, on every record (the control: it was always right)", () => {
    // The builder reads the current column name only, so a row carrying the
    // pre-rename one is, to it, a row with no depth; those are left to the
    // React pages, which read both. No refresh has written that shape since
    // 20260721260000.
    const out: string[] = [];
    for (const d of DEPTHS.filter((x) => x === null || typeof x === "number")) {
      const found = crawlerSentences(d);
      if (found.length === 0) out.push(`${labelOf(d)}: the crawler printed the count in no sentence`);
      for (const s of found) {
        const why = disagreement(s, d);
        if (why) out.push(why);
      }
    }
    expect(out).toEqual([]);
  });
});

describe("teeth: the sentences this file replaced fail it, and only where they were wrong", () => {
  const OPENER = (n: number) => `In the ${n} days we've kept this record we've watched ${SHOWN} roles come down across the board.`;
  const TILE = (n: number) => `${SHOWN}closures logged in ${n} days`;

  it("the old opener and tile, printing the ledger's age, fail on every record deeper than 90 days", () => {
    for (const d of DEPTHS.filter((x): x is number => typeof x === "number")) {
      const wrong = d > CLOSURE_RECORD_WINDOW_DAYS;
      expect(disagreement(OPENER(d), d) !== null, `opener at ${d}`).toBe(wrong);
      expect(disagreement(TILE(d), d) !== null, `tile at ${d}`).toBe(wrong);
    }
  });

  it("the old fallback names no span, so it fails the row with no depth", () => {
    expect(disagreement(`Since we started keeping this record we've watched ${SHOWN} roles come down across the board.`, null))
      .toMatch(/states no span of days/);
    expect(disagreement(`${SHOWN}closures logged in — days`, null)).toMatch(/states no span of days/);
  });

  it("a right window called the whole record fails on a record deeper than it", () => {
    expect(disagreement(OPENER(90), 180)).toMatch(/never says the record is 180 days deep/);
    expect(disagreement(OPENER(90), 90)).toBeNull();
  });

  it("the 2026-07-27 tile, the requested window printed over a 12-day log, fails too", () => {
    expect(disagreement(TILE(90), 12)).toMatch(/window of 90 days; it covers 12/);
  });
});
