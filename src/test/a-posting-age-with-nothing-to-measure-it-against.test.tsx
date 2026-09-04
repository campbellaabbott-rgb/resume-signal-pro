// A POSTING AGE WITH NOTHING TO MEASURE IT AGAINST.
//
// The board printed "24d ago · company-stated" on a posting and stopped there,
// while holding — already fetched, already in client state — the two figures
// that make that number mean something:
//
//   * get_category_fill_speed: how long roles in THIS FIELD actually stay open,
//     from a log of closures nobody else keeps. Fetched in Jobs.tsx, reduced to
//     one category's row on arrival, and rendered only on the eighteen category
//     landing pages. Never once beside a posting.
//   * get_company_hiring_health.median_days_to_close: how long THIS EMPLOYER'S
//     own roles stayed up before coming down. Batch-fetched for every visible
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
// 2. A MEDIAN NAMES ITS SAMPLE AND ITS WINDOW, or it does not appear. Explore
//    gates the same statistic at dated_n >= 10 and tracking_days >= 21; the
//    panel uses the same two numbers.
//
// 3. THE TWO EMPLOYER COUNTS ARE NOT ONE COUNT, and this is the sharp edge.
//    get_company_hiring_health computes median_days_to_close over the fills
//    where the employer STATED posted_at, and closed_90d over every
//    non-superseded fill that stayed posted 7+ days, dated on
//    COALESCE(posted_at, first_seen). The dated set is a SUBSET, so closed_90d
//    gates the median honestly and can never be printed as its n — the RPC
//    returns no dated_n to print instead. The copy therefore states the two as
//    separate sentences, and the assertion below is mechanical: the median
//    sentence carries no count, the count sentence carries no median.
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
const SLOW = { timeout: 4000 } as const;

const daysAgoIso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

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

const FILL_SPEED = [
  { category: "engineering", closures: 4102, median_days_open: 8.2, p75_days_open: 12.4, window_days: 41 },
  { category: "design", closures: 900, median_days_open: 6.1, p75_days_open: 9.9, window_days: 41 },
];
type Health = {
  company_token: string; open_roles: number; closed_90d: number; superseded_90d: number;
  median_days_open: number | null; median_days_to_close: number | null; tracking_days: number;
};
const health = (over: Partial<Health> = {}): Health => ({
  company_token: "acme", open_roles: 5, closed_90d: 14, superseded_90d: 0,
  median_days_open: 4, median_days_to_close: 9, tracking_days: 63, ...over,
});

function mount(rows: Row[], opts: { fillSpeed?: unknown[]; health?: Health[] } = {}) {
  // ORDERED ON PURPOSE, so every assertion below is deterministic. The two
  // lookups race in the real page (health fires on the list, fill-speed on the
  // panel opening), which would let an "it did not render" assertion pass
  // because a request had not landed yet — the false green this repo has read
  // twice today. Holding the health answer until the fill-speed answer is in
  // means the employer sentence appearing PROVES the field table already
  // arrived, so its absence is a refusal rather than a race.
  let releaseHealth: () => void = () => {};
  const fillLanded = new Promise<void>((r) => { releaseHealth = r; });
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_category_fill_speed") { releaseHealth(); return { data: opts.fillSpeed ?? FILL_SPEED }; }
    if (fn === "get_company_hiring_health") { await fillLanded; return { data: opts.health ?? [health()] }; }
    return { data: [] };
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

describe("a posting age with nothing to measure it against", () => {
  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset();
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
  });

  it("behaviour: the field's closure curve reaches a posting, not just its landing page", async () => {
    mount([row()]);
    await waitFor(() => expect(panelText()).toContain("closings we tracked"), SLOW);
    const text = panelText();
    expect(text).toContain("Posted 24 days ago");
    // The comparison itself: this posting's age against what actually happened
    // to 4,102 tracked closings in the same field.
    expect(text).toContain("4,102");
    expect(text).toContain("12.4");
    expect(text).toContain("8.2");
    // The window is the log's OBSERVED depth, which the RPC already clamps —
    // printing the requested 90 over 41 days of evidence is the defect
    // 20260729100000 was written to fix.
    expect(text).toContain("41");
  });

  it("behaviour: the employer's own fill time is stated when this posting has outlived it", async () => {
    mount([row()]);
    await waitFor(() => expect(panelText()).toContain("past this employer's own pace"), SLOW);
    const text = panelText();
    expect(text).toContain("9 days");          // the employer's median
    expect(text).toContain("14 roles");        // fills logged — its own sentence
    expect(text).toContain("63 days of tracking");
  });

  it("behaviour: an undated posting gets NO comparison, however much we know about its field", async () => {
    // first_seen is our discovery time and has never been a posting age here.
    // The stats are fully present; the age is not, so the block does not render.
    mount([row({ postedAt: null })]);
    // The panel is genuinely open (this string exists nowhere else on the page)
    // and both lookups have answered, so "absent" is a refusal.
    await waitFor(() => expect(panelText()).toContain("Apply on company site"), SLOW);
    await waitFor(() => expect(rpc.mock.calls.some((c) => c[0] === "get_company_hiring_health")).toBe(true), SLOW);
    const text = panelText();
    expect(text, "an age was invented from something the employer did not state")
      .not.toContain("by the date the company states");
    expect(text).not.toContain("closings we tracked");
    expect(text).not.toContain("past this employer's own pace");
  });

  it("behaviour: a thin fill sample is refused, and the field line survives the refusal", async () => {
    // Four fills is not a pace. The field figure is a different statistic with
    // its own 300-closing floor inside the RPC, so it must not be collateral.
    mount([row()], { health: [health({ closed_90d: 4 })] });
    // Both answers are in — "genuinely fills roles" comes only from the health
    // lookup — so the missing sentence is a refusal, not a pending request.
    await waitFor(() => expect(panelText()).toContain("genuinely fills roles"), SLOW);
    expect(panelText()).toContain("Posted 24 days ago");
    expect(panelText()).toContain("4,102");
    expect(panelText(), "a median over four fills is noise wearing a deadline")
      .not.toContain("past this employer's own pace");
  });

  it("behaviour: a short observation window is refused too", async () => {
    mount([row()], { health: [health({ tracking_days: 10 })] });
    await waitFor(() => expect(panelText()).toContain("genuinely fills roles"), SLOW);
    expect(panelText()).toContain("Posted 24 days ago");
    expect(panelText(), "ten days of tracking cannot support a 9-day median")
      .not.toContain("past this employer's own pace");
  });

  it("behaviour: a posting that has NOT outlived the employer's pace is not accused of it", async () => {
    mount([row({ postedAt: daysAgoIso(3) })]);
    await waitFor(() => expect(panelText()).toContain("genuinely fills roles"), SLOW);
    expect(panelText()).toContain("Posted 3 days ago");
    expect(panelText()).not.toContain("past this employer's own pace");
  });

  it("behaviour: a field with no qualifying row shows nothing rather than a guess", async () => {
    // The RPC's own floor is 300 closings per category and it returns NO ROW
    // below it. An absent category must read as absent.
    mount([row({ category: "veterinary" })]);
    await waitFor(() => expect(panelText()).toContain("Posted 24 days ago"), SLOW);
    expect(panelText()).not.toContain("closings we tracked");
    // The employer half is a separate source and still answers.
    expect(panelText()).toContain("past this employer's own pace");
  });

  it("behaviour: the fill-speed table is fetched at most once, however many postings are opened", async () => {
    // COUNTED, not read off a call site. The RPC takes no arguments and returns
    // every qualifying category, so a request per posting would be pure waste.
    mount([row(), row({ id: "j1", title: "Frontend Engineer", applyUrl: "https://x/1" })]);
    await waitFor(() => expect(panelText()).toContain("closings we tracked"), SLOW);
    const fillCalls = rpc.mock.calls.filter((c) => c[0] === "get_category_fill_speed");
    expect(fillCalls.length).toBe(1);
  });

  it("the median's sample floors are constants, mirroring the bar Explore applies", () => {
    expect(JOBS).toMatch(/const FILL_MEDIAN_MIN_TRACKING_DAYS = 21;/);
    expect(JOBS).toMatch(/const FILL_MEDIAN_MIN_FILLS = 10;/);
    // Used, not merely declared — a floor nothing reads is not a floor.
    expect((JOBS.match(/FILL_MEDIAN_MIN_TRACKING_DAYS/g) ?? []).length).toBeGreaterThan(1);
    expect((JOBS.match(/FILL_MEDIAN_MIN_FILLS/g) ?? []).length).toBeGreaterThan(1);
  });

  it("the whole lander fetch is derived from the shared map, not a second request", () => {
    // Two fetches of the same zero-argument RPC would be the shape that let the
    // lander keep one row and throw the rest away in the first place.
    expect((JOBS.match(/rpc\("get_category_fill_speed"\)/g) ?? []).length).toBe(1);
    expect(JOBS).toMatch(/const fillSpeed = useMemo\(/);
    expect(JOBS).toMatch(/fillSpeedByCategory\?\.\[landerCategory\] \?\? null/);
  });

  it("the reason closed_90d is never printed as the median's n stays written down", () => {
    // PROSE, so raw source. Delete this comment and the next person re-reads
    // closed_90d as a sample size, which is the defect this file exists for.
    expect(RAW).toMatch(/UPPER BOUND on the sample the/);
    expect(RAW).toMatch(/never PRINTED as that median's n/);
  });

  it("every new string is translated in all nine locales, and the two employer samples stay separate", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    const en = JSON.parse(readFileSync(resolve(dir, "en.json"), "utf8")) as { jobsPage: Record<string, string> };
    for (const f of files) {
      const j = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as { jobsPage?: Record<string, string> };
      const jp = j.jobsPage ?? {};
      for (const k of ["postingAgeLead", "fieldFillCompare", "fieldFillBasis", "employerOutlived", "employerOutlivedBasis"]) {
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
      // THE MECHANICAL FORM OF RULE 3. The median sentence states no count and
      // the count sentence states no median, in every language — so no locale
      // can quietly reassemble them into "median of 14 fills", which names a
      // sample the RPC never measured.
      expect(jp.employerOutlived, `${f}: the median sentence has acquired a count`).not.toContain("{{n}}");
      expect(jp.employerOutlivedBasis, `${f}: the count sentence has acquired the median`).not.toContain("{{median}}");
    }
  });
});
