/**
 * A FILL CLAIM WITHOUT ITS WINDOW, AND A DEDUPED COUNT WITH AN EQUALS SIGN.
 *
 * /explore's headline section published this, straight out of the cache the
 * page renders, 2026-09-06:
 *
 *   company           filled  days  open now   implied fills/day
 *   Advocate Health    6,406    11       420               582
 *   JLL                4,331    11       220               394
 *
 * JLL cannot fill 394 roles a day while holding 220 open. Those were closure
 * EVENTS — the same handful of roles leaving and coming back — rendered to a
 * job seeker as "4331 filled in 11d tracked". Two independent defects made that
 * sentence possible, and this file guards the properties that close both:
 *
 *   1. NO FILL CLAIM RENDERS WITHOUT ITS WINDOW AND ITS GATE. A figure about
 *      what happens to postings may appear only when the estimate itself is
 *      admissible (`sufficient`, honoured rather than re-derived), when enough
 *      of the record carries the poster's own date (FILL_COVERAGE_MIN), and
 *      when we have watched long enough to say anything about a fourteen-day
 *      horizon (FILL_RATE_MIN_TRACKING_DAYS) — with the span printed beside the
 *      figure, never in a tooltip.
 *
 *   2. A RELIST FIGURE NEVER RENDERS AS AN EQUALITY. The collector logs only
 *      the first superseded closure per normalised title per employer per 24h
 *      and DELETES the rest, so every re-listing count on this page is a lower
 *      bound. "2,242 re-postings" is a number the query could not have
 *      produced; "2,242+" is.
 *
 * WHAT THIS FILE STOPPED GUARDING, AND WHY THAT IS NOT A RETREAT.
 * The twelve-card employer sections these properties were written against are
 * GONE — deleted 2026-09-09, because twelve employer cards held 1,812 open
 * roles against ~938,000 served and could not exceed 11.09% of this board
 * however perfectly they were ranked. Every test here that mounted `?i=hiring`
 * and drove get_actively_hiring_companies rows was a guard over a section that
 * no longer exists, and a guard whose subject is dead does not protect anything
 * — it only blocks the removal. THE PROPERTIES THEMSELVES DID NOT MOVE OR
 * SOFTEN: property 1 now lives at FIELD grain, where the same estimator PASSES
 * the same gates on thousands of closures instead of three, and is guarded in
 * a-default-view-that-reached-two-tenths-of-a-percent.test.tsx against a real
 * render; property 2 still has a live renderer on this page — the churn warning
 * that follows an employer onto the employer check — and it is guarded below.
 * What remains here is exactly what still has a subject.
 *
 * Read off a REAL RENDER wherever a render can answer. A source guard cannot
 * tell a rendered figure from a well-spelled one, and this repo has been bitten
 * repeatedly by a guard that matched an explanation while the code it described
 * was dead. The teeth block at the foot proves each checker fails against the
 * behaviour that shipped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
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
import Explore from "../pages/Explore";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
/** Comments stripped: an assertion about what the code DOES must not be
 *  satisfiable by prose describing what it no longer does. */
const CODE = read("src/pages/Explore.tsx")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");

const mount = (cache: Record<string, unknown>) => {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_explore_cache") {
      return {
        data: {
          fields: { engineering: 41_203 },
          totals: {},
          repost_index: {},
          stale_parts: [],
          computed_at: new Date().toISOString(),
          ...cache,
        },
      };
    }
    return { data: [], error: null };
  });
  return render(<MemoryRouter initialEntries={["/explore?i=check"]}><Explore /></MemoryRouter>);
};

/** The whole rendered page as text. Both answers sit in the DOM — the inactive
 *  one under `hidden`, because /explore is prerendered and its links must stay
 *  crawlable — so a figure that leaks out of its gate is visible here wherever
 *  it leaks to. */
const pageText = () => document.body.textContent ?? "";

/** Every percentage on screen that could only have come from a fill measure.
 *  CASE-INSENSITIVE, AND THAT IS THE WHOLE POINT OF THE FLAG. R(14) was once a
 *  lowercase badge ("up to 62%"); it is now a mid-sentence clause and renders
 *  capitalised in some positions. A case-sensitive scanner returns [] for every
 *  page — INCLUDING A LEAKING ONE. */
const fillPercents = (txt: string): string[] =>
  [...txt.matchAll(/up to\s*(\d{1,3})%/gi)].map((m) => m[1]);

beforeEach(() => { rpc.mockReset(); document.body.innerHTML = ""; });

describe("a relist figure never renders as an equality", () => {
  it("the churn warning that follows an employer onto the employer check is a floor", async () => {
    // It reads "Re-lists roles: 2,242 re-postings across 182 roles in 49d" in
    // nine locales. The floor marker goes on the interpolated VALUE, so every
    // one of those translations becomes a floor at once rather than eight of
    // them stating an equality until a translation pass lands.
    //
    // THIS IS THE ONE RELIST RENDERER LEFT ON THE PAGE. The re-listing
    // leaderboard that carried the others is gone; repost_index survives
    // because the employer check still consumes it, which is why the cache
    // writer deliberately kept computing it.
    mount({ repost_index: { chr: [2242, 182, 49] } });
    // The warning renders per employer-lookup hit, so drive the builder the way
    // the page does: through a suggest result carrying that token.
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_explore_cache") {
        return { data: { fields: {}, totals: {}, repost_index: { chr: [2242, 182, 49] }, stale_parts: [], computed_at: new Date().toISOString() } };
      }
      if (fn === "get_company_suggest") return { data: [{ name: "Churny Co", tokens: ["chr"], open_roles: 60, feed_total: null, feed_total_at: null }], error: null };
      return { data: [], error: null };
    });
    document.body.innerHTML = "";
    const { container } = render(<MemoryRouter initialEntries={["/explore?i=check"]}><Explore /></MemoryRouter>);
    const input = container.querySelector("input[type=search]") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "churny");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor(() => expect(pageText()).toMatch(/Re-lists roles/), { timeout: 3000 });
    const warn = pageText().match(/Re-lists roles:[^·]*?49d/)?.[0] ?? "";
    expect(warn, "the churn warning did not render").not.toBe("");
    expect(warn, "the event count is stated as an equality").toMatch(/2,242\+/);
    expect(warn, "the affected-role count is stated as an equality").toMatch(/182\+/);
  });

  it("no rendered count anywhere on the page states a deduped quantity as an equality", () => {
    // THE CLASS, NOT THE INSTANCE. Every count this page prints beside the word
    // "re-list" comes from the same 24h-deduped log, so the marker belongs on
    // the interpolated VALUE and not in one sentence's wording.
    const at = CODE.indexOf('t("explore.repostWarn"');
    expect(at, "the churn warning must be rendered").toBeGreaterThanOrEqual(0);
    const call = CODE.slice(at, at + 400);
    expect(call, "the event count lost its floor marker").toMatch(/events:\s*`\$\{nf\(events\)\}\+`/);
    expect(call, "the affected-role count lost its floor marker").toMatch(/roles:\s*`\$\{nf\(roles\)\}\+`/);
  });
});

describe("the gate is the board's, not a second copy of it", () => {
  // WHERE THE BAR WENT, AND WHY THIS CHECK INVERTED.
  //
  // It existed because /explore PUBLISHED A FILL-RATE FIGURE: a field-grain
  // lifecycle line under every tile. Two surfaces publishing one statistic
  // under two copies of one gate is how a page comes to publish and refuse the
  // same record, so /explore was made to import /jobs' predicate and /jobs'
  // floors rather than re-type them.
  //
  // /explore no longer makes that claim. The line was flat by measurement —
  // R(14) 0.128-0.243 across eighteen fields, rendering as four distinct
  // strings, and medians of 27/28/29/30 pinned against the estimator's own
  // censoring cap — so it separated nothing; and its input was about to stop
  // being admissible besides, because get_category_fill_curve does not filter
  // absence_basis and a lap_backfill closure carries a closed_at that column's
  // own comment bars from any duration statistic.
  //
  // WITH NO CLAIM THERE IS NOTHING TO GATE, so requiring the import would pin a
  // spelling over dead code — the failure this repository has hit four times.
  // The honest successor is the inverse: the RETURN of any part of the bar to
  // /explore is the signal that a fill claim came back, and it must come back
  // through /jobs' single declaration or not at all.
  it("Explore makes no fill-rate claim, so it holds no copy of the bar", () => {
    expect(CODE, "a fill claim has returned to /explore — it must import the bar from /jobs")
      .not.toMatch(/\bcanStateFillRate\b/);
    expect(CODE, "Explore declared its own copy of the bar again")
      .not.toMatch(/const FILL_(?:COVERAGE|HORIZON|RATE|SUPPORT)_[A-Z_]+\s*=/);
    for (const name of ["FILL_COVERAGE_MIN", "FILL_RATE_MIN_TRACKING_DAYS",
      "FILL_SUPPORT_MAX_DAYS", "URGENT_FILL_MAX_DAYS", "coverageBand"]) {
      expect(CODE, `${name} is read on /explore again — a fill claim came back with it`)
        .not.toMatch(new RegExp(`\\b${name}\\b`));
    }
    // AND THE BAR ITSELF IS UNTOUCHED. Removing a claim from one page is not
    // permission to loosen the gate on the page that still makes it.
    const jobs = read("src/pages/Jobs.tsx");
    expect(jobs, "canStateFillRate is gone — the shared predicate is the property here")
      .toMatch(/export function canStateFillRate/);
    expect(jobs).toMatch(/const FILL_RATE_MIN_TRACKING_DAYS = 21;/);
    expect(jobs).toMatch(/const FILL_COVERAGE_MIN = 0\.3;/);
  });

  it("the legacy closure count is not read anywhere in the page", () => {
    // get_actively_hiring_companies still returns `closed_90d` for four
    // consumers that read by column name — it is the count that published
    // "4,331 filled". Nothing on this page may read it, and with the section
    // that once did it gone, nothing may read its successor column either.
    expect(CODE, "the count that published 4,331 fills is being read again")
      .not.toMatch(/\bclosed_90d\b/);
    expect(CODE, "a deleted section's payload column is being read again")
      .not.toMatch(/filled_roles_ceiling/);
  });

  it("the field curve is fetched by the surface that still publishes it, and by no other", () => {
    // WHERE PROPERTY 1 LIVES NOW. /jobs' field lander reads
    // get_category_fill_curve, honours the RPC's own `sufficient`, and does not
    // rebuild the three thresholds out of n_at_risk_14 and fills_le_14 — which
    // is how two surfaces come to publish and refuse the same record.
    const jobs = read("src/pages/Jobs.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
    expect(jobs).toMatch(/rpc\("get_category_fill_curve"\)/);
    const gate = /export function canStateFillRate\([\s\S]*?\n\}/.exec(jobs)?.[0] ?? "";
    expect(gate, "the gate must read the RPC's own sufficiency finding").toMatch(/\.sufficient\b/);
    for (const code of [jobs, CODE]) {
      expect(code, "the estimator's own thresholds are being re-derived")
        .not.toMatch(/n_at_risk_14\s*[<>]=/);
      expect(code, "the estimator's own thresholds are being re-derived")
        .not.toMatch(/fills_le_14\s*[<>]=/);
    }
    // …and /explore does not ask for the curve at all any more, which is the
    // whole reason it holds no gate: it was paying for a 44-second scan to
    // print one sentence twelve times.
    expect(CODE, "/explore is fetching the field curve again")
      .not.toMatch(/get_category_fill_curve/);
  });
});

/**
 * TEETH — each checker above, run against the behaviour that actually shipped.
 * A guard that cannot fail is a comment.
 */
describe("teeth", () => {
  it("the window checker fails on a card with no span beside its figure", () => {
    // Both spellings of the span, against the widened checker: the old compact
    // "50d" and the shipped "· 56-day closure log".
    const shipped = "half of these roles were gone within 22 days and did not come back · 56-day closure log";
    const legacy = "4324 filled in 50d tracked · 172 open now";
    const noWindow = "Up to 63% of its roles came down within 14 days and stayed down";
    const win = /\b(?:56|50)[\s-]*(?:d\b|day)/;
    expect(win.test(noWindow), "the checker passes a figure with no window").toBe(false);
    expect(win.test(shipped)).toBe(true);
    expect(win.test(legacy)).toBe(true);
  });

  it("the ceiling checker fails on a share published as a point estimate", () => {
    // The honesty breach this guards, in the shape the rebuild could have
    // produced: the figure demoted into a sentence with the marker dropped.
    const marked = "up to 62% were gone within 14 days and stayed gone";
    const bare = "62% were gone within 14 days and stayed gone";
    expect(/up to\s*62%/i.test(bare), "the ceiling checker passes a point estimate").toBe(false);
    expect(/up to\s*62%/i.test(marked)).toBe(true);
    // …and the negative half, which is what catches a marker that survived
    // somewhere else on the line while the figure itself went bare.
    const both = "It reads “up to” · 62% were gone within 14 days";
    expect(/(?<!up to\s*)\b62%/i.test(both), "the bare-figure checker was satisfied by a stray marker").toBe(true);
    expect(/(?<!up to\s*)\b62%/i.test(marked)).toBe(false);
  });

  it("the equality checker fails on the sentence that shipped", () => {
    const shipped = "Re-lists roles: 2,242 re-postings across 182 roles in 49d";
    expect(/2,242\+/.test(shipped), "the floor checker passes an equality").toBe(false);
    expect(/2,242/.test(shipped)).toBe(true);
  });

  it("the fill-percent scanner would have caught a rate published over a short log", () => {
    expect(fillPercents("we did not see half of these roles come down inside 30 days · up to 63% were gone within 14 days")).toEqual(["63"]);
    // The old badge's lowercase form still has to be caught — the scanner is
    // for any leak, not for one section's current wording.
    expect(fillPercents("4324 filled in 11d tracked · Up to 63% taken down for good within 14d")).toEqual(["63"]);
    expect(fillPercents("4324 filled in 11d tracked · 172 open now")).toEqual([]);
    // And the method drawer's prose, which contains the marker with no figure
    // after it, must not register as a published rate.
    expect(fillPercents("which is why it reads “up to”. The interval beside it is an approximation")).toEqual([]);
  });
});
