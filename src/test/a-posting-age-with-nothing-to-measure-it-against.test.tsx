// A POSTING AGE WITH NOTHING TO MEASURE IT AGAINST.
//
// The board printed "24d ago · company-stated" on a posting and stopped there,
// while holding — already fetched, already in client state — the two figures
// that make that number mean something:
//
//   * the field's own lifecycle curve: what actually happens to roles in THIS
//     FIELD, from a log of closures nobody else keeps. Fetched in Jobs.tsx,
//     reduced to one category's row on arrival, and rendered only on the
//     eighteen category landing pages. Never once beside a posting.
//   * the same curve for THIS EMPLOYER. Batch-fetched for every visible
//     company already, and spent on a badge.
//
// This is the one thing the product knows that a job board cannot: not what
// employers SAY, but what they DID after saying it. Two lines of it now sit on
// the detail panel.
//
// ── THE THREE RULES THIS COPY HAD TO CLEAR ──────────────────────────────────
//
// 1. THE AGE IS THE COMPANY'S OWN DATE OR THERE IS NO BLOCK. effective_posted
//    is coalesce(posted_at, first_seen), and substituting our discovery time
//    for the employer's date is the 2.8-day-median incident — already recorded
//    once and already reintroduced twice on other surfaces. An undated posting
//    gets silence here, not a flattering comparison.
//
// 2. A PUBLISHED RATE NAMES ITS SAMPLE AND THE WINDOW IT WAS WATCHED OVER, or
//    it does not appear. One predicate decides that for every surface.
//
// 3. THE TWO EMPLOYER COUNTS ARE NOT ONE COUNT, and this is the sharp edge. A
//    count drawn from one population must never be printed as another
//    estimate's sample size. The copy states the two as separate sentences,
//    and the assertion below is mechanical: the rate sentence carries no
//    count, the count sentence carries no rate.
//
// ── WHAT THE 2026-09-06 ESTIMATOR CHANGE DID TO THIS FILE ───────────────────
//
// Every rule above survived. The STATISTIC under them did not.
//
// Both benchmarks used to be percentiles of days-to-close, computed over a
// sample that could only contain roles lasting 7 to 30 days: a 30-day serving
// cap at the top, a 7-day floor in every fill query at the bottom. Roles that
// outlived the cap were not censored, they were ABSENT — which is truncation,
// not censoring, and it biases the answer down without bound. Eighteen fields
// spanning nursing, law, retail and ML research agreed to within 1.4 days over
// roughly 600,000 closures, which is not a fact about hiring.
//
// What replaced them is a SHARE AT A FIXED HORIZON from the Aalen-Johansen
// cumulative incidence, with age-outs and still-open roles censored and
// same-title re-listings held out as a competing event. So:
//
//   * `get_category_fill_speed` -> `get_category_fill_curve` (zero-argument),
//     `get_company_hiring_health` -> `get_company_fill_curve` ({ p_tokens }).
//   * p75 is gone from the contract entirely, and no percentile may be
//     reconstructed client-side — there is nothing to read it off.
//   * The category contract carries NO cohort column, so the field line prints
//     its window and no sample count at all. n_at_risk_14 is the day-14 RISK
//     SET, not a sample: printing it under "measured over N roles" is Rule 3
//     written out as a sentence, and the guards below forbid it in code.
//   * A count floor was replaced by the RPC's own `sufficient` (25 at risk, 5
//     observed fills, CI half-width <= 0.15) — strictly stricter. The
//     OBSERVATION-WINDOW half had no successor and was restored as
//     FILL_RATE_MIN_TRACKING_DAYS, because `sufficient` cannot imply it:
//     lifetimes run from the employer's stated posted_at rather than from our
//     first sighting, so a role stated 30 days ago that we have watched for 8
//     is a live censored observation at t=30 and counts toward the day-14 risk
//     set. A ten-day-deep record can pass every term of `sufficient` and then
//     publish a fourteen-day rate "across 10 days of tracking".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
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

import Jobs from "../pages/Jobs";

const ROOT = resolve(__dirname, "../..");
// CODE is asserted against comment-stripped source; PROSE against the raw file.
// Asserting a comment's own words against stripped source (or a code literal
// against raw source that also carries it in a comment) is this repo's oldest
// guard bug, and this file's fix writes comments containing its own identifiers.
const RAW = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const JOBS = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const EXPLORE_RAW = readFileSync(resolve(ROOT, "src/pages/Explore.tsx"), "utf8");
const EXPLORE = EXPLORE_RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const SLOW = { timeout: 4000 } as const;

const daysAgoIso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

// ── SENTINELS ───────────────────────────────────────────────────────────────
//
// Each names ONE line and appears nowhere else on the page, so an assertion
// about silence is about that line and not about a race.
const FIELD_LINE = "Measured over every role in this field that we watched in the last";
const EMPLOYER_LINE = "longer than this employer usually leaves a role up";
// "The company lookup has answered." verdictTakedownsObserved is gated on
// fills_90d >= 3 and nothing else — no rate, no coverage, no window — so it
// still fires while a rate is being REFUSED. That is what makes the employer
// line's absence a refusal rather than a request that has not landed.
const COMPANY_ANSWERED = "come off the board and stay off";

// serveList emits the client's own shape (see BoardJob) — camelCase, `token`
// for the company and `postedAt` for the employer's stated date.
type Row = {
  id: string; company: string; title: string; location: string; salary: null;
  applyUrl: string; source: string; token: string; category: string; postedAt: string | null;
};
const row = (over: Partial<Row> = {}): Row => ({
  id: "j0", company: "Acme", title: "Backend Engineer", location: "Remote", salary: null,
  applyUrl: "https://x/0", source: "greenhouse", token: "acme",
  category: "engineering", postedAt: daysAgoIso(24), ...over,
});

// One row of get_category_fill_curve. window_days is the OBSERVED depth of the
// log, which the RPC clamps to min(closed_at) rather than to the window that
// was requested — printing the requested 90 over 41 days of evidence is the
// defect 20260729100000 was written to fix, and it is still the honest basis.
// still_open_14 must be <= 0.5 for the comparison to mean anything.
type FieldCurve = {
  category: string; n_at_risk_14: number; fills_le_14: number;
  fill_rate_14: number; fill_rate_14_lo: number; fill_rate_14_hi: number;
  relist_rate_14: number; still_open_14: number;
  median_days_to_fill: number | null; median_censored: boolean;
  dated_coverage: number; window_days: number; sufficient: boolean;
};
const fieldCurve = (over: Partial<FieldCurve> = {}): FieldCurve => ({
  category: "engineering", n_at_risk_14: 900, fills_le_14: 640,
  fill_rate_14: 0.36, fill_rate_14_lo: 0.31, fill_rate_14_hi: 0.41,
  relist_rate_14: 0.17, still_open_14: 0.42,
  median_days_to_fill: null, median_censored: true,
  dated_coverage: 0.82, window_days: 41, sufficient: true, ...over,
});
const FIELD = [fieldCurve(), fieldCurve({ category: "design", n_at_risk_14: 400, window_days: 41 })];

// One row of get_company_fill_curve. dated_n is the COHORT the durations were
// computed from; n_at_risk_14 is the day-14 risk set and is deliberately
// different from it, so a guard can tell which one reached the copy.
type Curve = {
  company_token: string; n_at_risk_14: number; fills_le_14: number;
  fill_rate_14: number; fill_rate_14_lo: number; fill_rate_14_hi: number;
  relist_rate_14: number; still_open_14: number; fill_rate_7: number; fill_rate_30: number;
  median_days_to_fill: number | null; median_censored: boolean;
  dated_coverage: number; dated_n: number; undated_n: number;
  open_roles: number; fills_90d: number; relists_90d: number; ageouts_90d: number;
  fill_through: number; churn: number; absorption: number;
  tracking_days: number; sufficient: boolean;
};
const curve = (over: Partial<Curve> = {}): Curve => ({
  company_token: "acme", n_at_risk_14: 120, fills_le_14: 64,
  fill_rate_14: 0.55, fill_rate_14_lo: 0.47, fill_rate_14_hi: 0.62,
  relist_rate_14: 0.05, still_open_14: 0.40, fill_rate_7: 0.30, fill_rate_30: 0.70,
  median_days_to_fill: null, median_censored: true,
  dated_coverage: 0.78, dated_n: 210, undated_n: 59,
  open_roles: 5, fills_90d: 14, relists_90d: 0, ageouts_90d: 3,
  fill_through: 0.6, churn: 0, absorption: 0.1,
  tracking_days: 63, sufficient: true, ...over,
});

function mount(
  rows: Row[],
  opts: { field?: unknown[]; company?: unknown[]; fieldError?: unknown } = {},
) {
  // ORDERED ON PURPOSE, so every assertion below is deterministic. The two
  // lookups race in the real page (the company curve fires on the list, the
  // field curve on the panel opening), which would let an "it did not render"
  // assertion pass because a request had not landed yet — the false green this
  // repo has read twice. Holding the company answer until the field answer is
  // in means the employer sentence appearing PROVES the field table already
  // arrived, so its absence is a refusal rather than a race.
  let releaseCompany: () => void = () => {};
  const fieldLanded = new Promise<void>((r) => { releaseCompany = r; });
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_category_fill_curve") {
      releaseCompany();
      if (opts.fieldError) return { data: null, error: opts.fieldError };
      return { data: opts.field ?? FIELD, error: null };
    }
    if (fn === "get_company_fill_curve") {
      await fieldLanded;
      return { data: opts.company ?? [curve()], error: null };
    }
    return { data: [], error: null };
  });
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit") return { data: { terms: [], fits: {}, missing: {}, matched: {} } };
    if (fn === "job-board" && b.action === "detail") {
      return { data: { job: rows.find((r) => r.id === b.id) ?? null, description: "We need a backend engineer." } };
    }
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: rows.length } };
      return {
        data: {
          jobs: rows, total: rows.length, totalAllCompanies: rows.length, companies: [], companiesCount: 0,
          categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: {} };
  });
  window.history.replaceState({}, "", `/jobs?job=${rows[0].id}`);
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

/** The whole comparison block, or "" when it did not render. */
const panelText = () => document.body.textContent ?? "";
// SCOPED READS. Several of the board's own filter controls carry number-shaped
// text ("120k+ stated", "100k+ stated"), so a document-wide negative about a
// figure answers a different question from the one being asked — and would
// pass or fail for reasons that have nothing to do with the claim under test.
// `line()` is the one rendered paragraph that carries the given sentence.
const line = (sentinel: string) =>
  Array.from(document.querySelectorAll("p"))
    .map((el) => el.textContent ?? "")
    .find((tx) => tx.includes(sentinel)) ?? "";

describe("a posting age with nothing to measure it against", () => {
  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset();
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  });

  it("behaviour: the field's closure curve reaches a posting, not just its landing page", async () => {
    mount([row()]);
    await waitFor(() => expect(panelText()).toContain(FIELD_LINE), SLOW);
    const text = panelText();
    expect(text).toContain("Posted 24 days ago");
    // The comparison itself: this posting's age against what actually happened
    // to every role we watched in the same field.
    expect(text, "the share off the board within the horizon").toContain("58%");
    expect(text, "the fill arm alone, which is the smaller number").toContain("36%");
    expect(text, "the relist floor, stated separately").toContain("17%");
    // The window is the log's OBSERVED depth, which the RPC already clamps —
    // printing the requested 90 over 41 days of evidence is the defect
    // 20260729100000 was written to fix.
    expect(text).toContain("41");
    // THE COUNT THE OLD COPY PRINTED HAS NO HONEST SUCCESSOR. n_at_risk_14 is
    // the day-14 risk set: it excludes every role that already filled,
    // relisted or was censored before the horizon, so it shrinks as the rate
    // rises and can be smaller than the fills it would claim to cover. The
    // category contract carries no cohort column, so the count is DROPPED, not
    // relabelled — and the window is what the claim rests on.
    expect(line(FIELD_LINE), "the day-14 risk set was printed as a sample size").not.toContain("900");
    // …and the same rule in code, so no future copy edit can reintroduce it.
    // The line-level scope is what makes this catch the defect: n_at_risk_14
    // legitimately appears in the interfaces, the normalisers and the gates.
    const offenders = JOBS.split("\n").filter((l) => l.includes("n_at_risk_14") && l.includes('t("jobsPage'));
    expect(offenders, `n_at_risk_14 reached copy: ${offenders.join(" | ")}`).toEqual([]);
    // THE CENSORED MEDIAN IS A BOUND, NEVER A NUMBER. The curve never reached
    // half inside the days we can observe, so the honest rendering says so.
    expect(text).toContain("so there is no typical figure to give");
    expect(text, "a median was published where none exists inside the window")
      .not.toContain("Half of these roles are filled by day");
  });

  it("behaviour: the employer's own fill time is stated when this posting has outlived it", async () => {
    mount([row()]);
    await waitFor(() => expect(panelText()).toContain(EMPLOYER_LINE), SLOW);
    const text = panelText();
    expect(text, "the share off the board within the horizon").toContain("60%");
    expect(text, "the fill arm, as a ceiling").toContain("55%");
    expect(text, "the interval, because a point estimate alone overstates").toContain("47");
    expect(text).toContain("62%");
    // RULE 3, MECHANICAL, AGAINST THE NEW SHAPE. dated_n is the cohort the
    // durations were actually computed from and is what may be printed;
    // n_at_risk_14 is the day-14 survivor count and is what may not. The old
    // form of this assertion guarded closed_90d, which was only ever an UPPER
    // BOUND on the cohort — dated_n is the cohort itself, so this is the
    // stronger version of the same rule, not a weaker one.
    const p = line(EMPLOYER_LINE);
    expect(p, "the cohort the rate was estimated over").toContain("210");
    expect(p, "the day-14 survivors were printed as the rate's n").not.toContain("120");
    // The tracking span is a separate fact in a separate sentence.
    expect(p).toContain("63 days of tracking");
  });

  it("behaviour: an undated posting gets NO comparison, however much we know about its field", async () => {
    // first_seen is our discovery time and has never been a posting age here.
    // The stats are fully present; the age is not, so the block does not render.
    mount([row({ postedAt: null })]);
    // The panel is genuinely open (this string exists nowhere else on the page)
    // and both lookups have answered, so "absent" is a refusal.
    await waitFor(() => expect(panelText()).toContain("Apply on company site"), SLOW);
    await waitFor(() => expect(rpc.mock.calls.some((c) => c[0] === "get_company_fill_curve")).toBe(true), SLOW);
    const text = panelText();
    expect(text, "an age was invented from something the employer did not state")
      .not.toContain("by the date the company states");
    expect(text).not.toContain(FIELD_LINE);
    expect(text).not.toContain(EMPLOYER_LINE);
  });

  it("behaviour: a thin fill sample is refused, and the field line survives the refusal", async () => {
    // TWO INDEPENDENT REFUSALS, so exercising one cannot let the other be
    // deleted. The field figure is a different statistic with its own floor
    // inside the RPC, so neither refusal may be collateral on it.
    //
    // (a) The RPC's own sufficiency flag is false. The client no longer
    //     re-derives a floor from whatever count it happens to hold — that is
    //     how a rate over four dated closures reached the screen.
    const { unmount } = mount([row()], { company: [curve({ sufficient: false })] });
    await waitFor(() => expect(panelText()).toContain(COMPANY_ANSWERED), SLOW);
    expect(panelText()).toContain("Posted 24 days ago");
    expect(panelText(), "the field line is a different statistic and must survive").toContain(FIELD_LINE);
    expect(panelText(), "a rate the estimator will not stand behind reached the screen")
      .not.toContain(EMPLOYER_LINE);
    unmount();

    // (b) Sufficient, but fewer than 30% of the record carries a date from the
    //     employer. Durations are computed over dated roles and no others, so
    //     a rate over a third of a record is not a record — and nothing else
    //     in this file covers the coverage gate.
    invoke.mockReset(); rpc.mockReset();
    mount([row()], { company: [curve({ dated_coverage: 0.12 })] });
    await waitFor(() => expect(panelText()).toContain(COMPANY_ANSWERED), SLOW);
    expect(panelText()).toContain(FIELD_LINE);
    expect(panelText(), "a duration was published over a record that mostly carries our dates, not theirs")
      .not.toContain(EMPLOYER_LINE);
  });

  it("behaviour: a short observation window is refused too", async () => {
    // THE HALF OF THE OLD BAR THAT `sufficient` CANNOT SUPPLY. Lifetimes are
    // measured from the employer's stated posted_at, not from our first
    // sighting, so a role stated 30 days ago that we have watched for 8 days
    // is a live censored observation at t=30 and counts toward the day-14 risk
    // set. 25 at risk plus 5 fills is therefore fully reachable on a ten-day
    // record, and the page would print a fourteen-day rate "across 10 days of
    // tracking" — a number from a window that cannot hold it, which is the
    // exact defect the estimator was written to remove, on the other axis.
    const { unmount } = mount([row()], { company: [curve({ tracking_days: 10 })] });
    await waitFor(() => expect(panelText()).toContain(COMPANY_ANSWERED), SLOW);
    expect(panelText()).toContain("Posted 24 days ago");
    expect(panelText(), "ten days of tracking cannot support a fourteen-day rate")
      .not.toContain(EMPLOYER_LINE);
    unmount();

    // THE CONVERSE, so a floor set high enough to refuse everything fails here
    // rather than passing as caution.
    invoke.mockReset(); rpc.mockReset();
    mount([row()], { company: [curve({ tracking_days: 63 })] });
    await waitFor(() => expect(panelText()).toContain(EMPLOYER_LINE), SLOW);
  });

  it("behaviour: a posting that has NOT outlived the employer's pace is not accused of it", async () => {
    const { unmount } = mount([row({ postedAt: daysAgoIso(3) })]);
    await waitFor(() => expect(panelText()).toContain(COMPANY_ANSWERED), SLOW);
    expect(panelText()).toContain("Posted 3 days ago");
    expect(panelText()).not.toContain(EMPLOYER_LINE);
    unmount();

    // THE BOUNDARY. The predicate is a strict `age > URGENT_FILL_MAX_DAYS`, so
    // a posting exactly at the horizon has not outlived it. Pinning the
    // boundary is what stops the comparison being quietly widened to `>=`.
    invoke.mockReset(); rpc.mockReset();
    mount([row({ postedAt: daysAgoIso(14) })]);
    await waitFor(() => expect(panelText()).toContain(COMPANY_ANSWERED), SLOW);
    expect(panelText()).toContain("Posted 14 days ago");
    expect(panelText(), "a posting AT the horizon has not outlived it").not.toContain(EMPLOYER_LINE);
  });

  it("behaviour: a field with no qualifying row shows nothing rather than a guess", async () => {
    // The RPC's own floor is obs_n >= GREATEST(p_min_n, 25) — 300 by default —
    // and it returns NO ROW below it. An absent category must read as absent:
    // no interpolation, no neighbouring category, no guess.
    const { unmount } = mount([row({ category: "veterinary" })]);
    await waitFor(() => expect(panelText()).toContain("Posted 24 days ago"), SLOW);
    expect(panelText()).not.toContain(FIELD_LINE);
    // The employer half is a separate source and still answers.
    expect(panelText()).toContain(EMPLOYER_LINE);
    unmount();

    // PRESENT BUT THIN IS A DISTINCT STATE the old contract could not express,
    // and it must read exactly as absent — a row the estimator cannot stand
    // behind is not a weaker fact, it is no fact.
    invoke.mockReset(); rpc.mockReset();
    mount([row()], { field: [fieldCurve({ sufficient: false })] });
    await waitFor(() => expect(panelText()).toContain(EMPLOYER_LINE), SLOW);
    expect(panelText(), "a field row below its own bar was rendered anyway").not.toContain(FIELD_LINE);
  });

  it("behaviour: the field curve table is fetched at most once, however many postings are opened", async () => {
    // COUNTED, not read off a call site. The RPC takes no arguments and returns
    // every qualifying category, so a request per posting would be pure waste.
    mount([row(), row({ id: "j1", title: "Frontend Engineer", applyUrl: "https://x/1" })]);
    await waitFor(() => expect(panelText()).toContain(FIELD_LINE), SLOW);
    const fillCalls = rpc.mock.calls.filter((c) => c[0] === "get_category_fill_curve");
    expect(fillCalls.length).toBe(1);
    // "AT MOST ONE SUCCESSFUL FETCH" is the property, not "at most one attempt".
    // A RESOLVED PostgREST error is still an error — supabase-js hands failures
    // back through `error` rather than by throwing — so a deploy window in
    // which the function does not exist yet must not become the session's
    // answer. The ask-once ref is released on both failure paths, and this is
    // pinned in code rather than by loosening the count above.
    expect(JOBS, "a failed fetch must release the ask-once ref, not cache the failure")
      .toMatch(/if \(error \|\| !Array\.isArray\(rows\)\) \{ fillCurveAsked\.current = false; return; \}/);
  });

  it("behaviour: a failed field fetch is silence, not a manufactured figure", async () => {
    mount([row()], { fieldError: { code: "PGRST202", message: "function does not exist" } });
    await waitFor(() => expect(panelText()).toContain(COMPANY_ANSWERED), SLOW);
    expect(panelText()).toContain("Posted 24 days ago");
    expect(panelText(), "an outage of ours was rendered as a fact about the field")
      .not.toContain(FIELD_LINE);
    // The employer half comes from a different RPC and is unaffected.
    expect(panelText()).toContain(EMPLOYER_LINE);
  });

  it("the fill claim's floors are named constants, and they are the SAME bar Explore applies", () => {
    // TWO SURFACES, ONE BAR. This guard exists because /jobs and /explore can
    // otherwise publish and refuse the same employer: they used to declare the
    // coverage floor and the horizon under different names in different files,
    // so editing one was silent on the other — and the observation-window
    // floor existed in neither.
    //
    // The sample-size half of the old bar moved into the RPC's `sufficient`
    // and got stricter, which is right. The OBSERVATION-WINDOW half has no
    // successor there and must live here.
    expect(JOBS).toMatch(/const FILL_RATE_MIN_TRACKING_DAYS = 21;/);
    expect(JOBS).toMatch(/const FILL_COVERAGE_MIN = 0\.3;/);
    // Used, not merely declared — a floor nothing reads is not a floor.
    expect((JOBS.match(/FILL_RATE_MIN_TRACKING_DAYS/g) ?? []).length).toBeGreaterThan(1);
    expect((JOBS.match(/FILL_COVERAGE_MIN/g) ?? []).length).toBeGreaterThan(1);
    // …and both are read inside the ONE predicate every surface goes through,
    // rather than re-applied per call site where one site can forget.
    const at = JOBS.indexOf("export function canStateFillRate");
    expect(at, "canStateFillRate is gone — the shared predicate is the property here").toBeGreaterThan(-1);
    const body = JOBS.slice(at, JOBS.indexOf("\n}", at));
    expect(body, "the sufficiency flag is the RPC's own answer and must be read").toMatch(/c\.sufficient/);
    expect(body, "the coverage band decides whether the number may be said at all").toMatch(/coverageBand\(c\.dated_coverage\)/);
    expect(body, "the observation-window floor is the half `sufficient` cannot supply")
      .toMatch(/FILL_RATE_MIN_TRACKING_DAYS/);
    // ONE DECLARATION. Explore must consume these names rather than re-type
    // their values; a second literal is the drift this guard is really about.
    expect(EXPLORE, "Explore must import the bar from /jobs")
      .toMatch(/import \{[^}]*FILL_COVERAGE_MIN[^}]*\} from "@\/pages\/Jobs"/);
    expect(EXPLORE).toMatch(/import \{[^}]*FILL_RATE_MIN_TRACKING_DAYS[^}]*\} from "@\/pages\/Jobs"/);
    expect(EXPLORE, "Explore has declared its own copy of the bar again")
      .not.toMatch(/const FILL_(?:COVERAGE|HORIZON|RATE)_[A-Z_]+\s*=/);
    // And it actually applies the window floor, which it did not before.
    expect(EXPLORE).toMatch(/>= FILL_RATE_MIN_TRACKING_DAYS/);
  });

  it("the whole lander fetch is derived from the shared map, not a second request", () => {
    // Two fetches of the same zero-argument RPC would be the shape that let the
    // lander keep one row and throw the rest away in the first place.
    expect((JOBS.match(/rpc\("get_category_fill_curve"\)/g) ?? []).length).toBe(1);
    expect(JOBS).toMatch(/const fieldCurve = useMemo\(/);
    expect(JOBS).toMatch(/fillCurveByCategory\?\.\[landerCategory\] \?\? null/);
    // …and the DETAIL PANEL reads the same map, which is what makes "shared"
    // load-bearing rather than incidental: the whole point of keeping the map
    // instead of one row is that a posting can be measured against its field.
    expect(JOBS).toMatch(/fillCurveByCategory\?\.\[detailJob\.category\]/);
  });

  it("the reason a foreign count is never printed as an estimate's n stays written down", () => {
    // PROSE, so raw source. Delete this and the next person reads whichever
    // count is nearest as a sample size, which is the defect this file exists
    // for. The warning survived the rewrite and got SHARPER: it is now aimed
    // at the live trap (n_at_risk_14, the day-14 risk set) rather than at the
    // retired one (closed_90d), and it names the replacement.
    expect(RAW).toMatch(/never a number to print beside a rate/);
    expect(RAW).toMatch(/Print dated_n instead/);
    // A COMMENT IS NOT A GUARD. This repo has seven times shipped a green test
    // over dead code because the spelling it pinned lived in prose, so the
    // property is pinned in CODE as well: the cohort is what reaches the copy.
    expect(JOBS, "the basis sentence must interpolate the cohort, not the survivors")
      .toMatch(/n: employer!\.dated_n/);
    const offenders = JOBS.split("\n").filter((l) => l.includes("n_at_risk_14") && l.includes('t("jobsPage'));
    expect(offenders, `n_at_risk_14 reached copy: ${offenders.join(" | ")}`).toEqual([]);
  });

  it("every new string is translated in all nine locales, and the two employer samples stay separate", () => {
    // REPOINTED 2026-09-06. This test previously pinned fieldFillCompare,
    // fieldFillBasis, employerOutlived and employerOutlivedBasis — four keys
    // that no source file asks for any more. It was green over dead strings,
    // which is this repo's oldest failure shape and the reason the key list is
    // now checked against what the page actually renders.
    const dir = resolve(ROOT, "src/i18n/locales");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    const en = JSON.parse(readFileSync(resolve(dir, "en.json"), "utf8")) as { jobsPage: Record<string, string> };
    const KEYS = [
      "postingAgeLead",
      "fieldCurveCompareBounded",
      "fieldCurveBasis",
      "employerOutlivedCurveBounded",
      "employerOutlivedCurveBasisDated",
      "fieldMedianCensored",
      "fillCoverageQualifier",
    ];
    // A KEY NOTHING RENDERS IS NOT A GUARDED KEY. Locale values outlive their
    // call sites here by convention (a value overrides an inline default, so
    // deleting one mid-flight leaves nine translations rendering retired copy),
    // which means presence in en.json proves nothing about the page.
    for (const k of KEYS) {
      expect(JOBS.includes(`jobsPage.${k}`), `jobsPage.${k} is not rendered by any live call site`).toBe(true);
    }
    for (const f of files) {
      const j = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as { jobsPage?: Record<string, string> };
      const jp = j.jobsPage ?? {};
      for (const k of KEYS) {
        expect(typeof jp[k], `${f}: jobsPage.${k}`).toBe("string");
        // A real translation, not the English string copied across.
        if (f !== "en.json" && f !== "en-GB.json") {
          expect(jp[k], `${f}: jobsPage.${k} is still the English text`).not.toBe(en.jobsPage[k]);
        }
        // Every placeholder survives the translation, or the sentence renders a
        // number-shaped hole.
        for (const ph of en.jobsPage[k].match(/\{\{\w+\}\}/g) ?? []) {
          expect(jp[k], `${f}: jobsPage.${k} lost ${ph}`).toContain(ph);
        }
      }
      // THE MECHANICAL FORM OF RULE 3. The RATE sentence states no count and
      // the COUNT sentence states no rate, in every language — so no locale
      // can quietly reassemble them into "55% measured over 120 roles", which
      // names a population the estimate was never computed over.
      expect(jp.employerOutlivedCurveBounded, `${f}: the rate sentence has acquired a count`)
        .not.toContain("{{n}}");
      for (const ph of ["{{fillPct}}", "{{lo}}", "{{hi}}", "{{gone}}", "{{relistPct}}"]) {
        expect(jp.employerOutlivedCurveBasisDated, `${f}: the count sentence has acquired ${ph}`)
          .not.toContain(ph);
      }
    }
  });
});
