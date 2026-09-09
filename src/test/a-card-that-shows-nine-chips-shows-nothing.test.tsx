// A CARD THAT SHOWS NINE CHIPS SHOWS NOTHING.
//
// Measured on the board before the 2026-09-04 redesign: a single result card
// could render FOURTEEN separate elements, all at 10–11px, all in the same
// grey, spread across two columns with no ordering between them.
//
//   left column   close-match · related-by-meaning · in-description ·
//                 experience band · "Verified direct from X" · "N open roles" ·
//                 "Actively hiring" · "Typically fills in ~9d" ·
//                 "Relists roles often (5×)" · "Agent can apply"
//
// (Those last three chips no longer read that way — see the note at the foot
// of this block. The list above is the board as it was, kept verbatim because
// it is the evidence for the compression.)
//   right column  fit tier · work mode · employment type · staffing agency ·
//                 applied · saved · posting age · first seen · checked 4m ago
//
// Nothing read first, and three of those chips ("Actively hiring", "Typically
// fills in ~9d", "Relists roles often") are three readings of ONE closure log
// printed side by side about the same employer.
//
// ── THE THREE TIERS, AND THE ONE RULE THAT ORDERS THEM ──────────────────────
//
// 1. WHAT IS THIS?   title (a step larger than everything else), employer,
//                    place — with the country added only where the location
//                    text has not already answered.
// 2. WHY CARE?       pay with its basis and its currency, work mode,
//                    employment type, seniority, how long it has been open.
// 3. WHY BELIEVE IT? the hiring system the posting was read out of, when we
//                    last re-read that system, what this employer actually DID
//                    after posting, and whether the form can be sent for you.
//
// Tier 3 is the differentiator and it is deliberately the quietest of the
// three. It survives compact density, because a compact card that has dropped
// its evidence is indistinguishable from an aggregator's.
//
// ── THE SHARP EDGE: ONE SLOT, AND THE CAUTION TAKES IT ──────────────────────
//
// Collapsing the three employer chips into one slot is a compression that can
// very easily become an edit. A company that both fills roles fast AND relists
// them often qualified for two of the old chips; if the positive one wins the
// single slot, the board has quietly stopped telling readers the thing they
// would most want to know, and it has done so in the name of design.
//
// So the precedence is fixed and asserted below: the repost caution takes the
// slot whenever it fires, and only in its absence does the slot speak well of
// the employer.
//
// ── WHAT THE 2026-09-06 ESTIMATOR CHANGE DID TO THIS FILE ───────────────────
//
// The PRECEDENCE did not move. The GATES got stricter, and the copy moved with
// the statistic underneath it.
//
//   • The praise branch used to fire on a median days-to-close under 14 — a
//     number that could only ever land near 15 for any employer on this board,
//     because the observable support was [7, 30] by construction. It now needs
//     URGENT_FILL_RATE_MIN (a fourth gate, 0.5), the RPC's own `sufficient`
//     flag, a dated-coverage band above "none", and an observation window at
//     least FILL_RATE_MIN_TRACKING_DAYS deep. Four new refusals stand in front
//     of "apply early" where there used to be one coin toss.
//   • The caution chip is a FLOOR now: "Re-lists roles often (7×+)". The old
//     "(7×)" printed an exact count over a collector that logs at most one
//     relist per title per day, which was itself a live breach of this repo's
//     ">=N, never =N" rule. The guard below REQUIRES the floor marker.
//   • The field comparison dropped "75%". The Aalen-Johansen curve does not
//     produce that quantile, and reconstructing one client-side would be
//     inventing it. The chip states the comparison; its title states the
//     observation window and the horizon the share was read at.
//
// The three original constants are untouched: REPOST_FLAG_MIN,
// ACTIVELY_HIRING_MIN_CLOSED and URGENT_FILL_MAX_DAYS are the same numbers,
// read in the same order.
//
// Behavioural, with the board mocked, because a grep for a class name proves
// nothing about what a reader sees.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
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
const RAW = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const JOBS = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const SLOW = { timeout: 4000 } as const;

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

// One posting per fact under test. Each row states EXACTLY what its case needs
// and leaves the rest null, so an assertion about silence is an assertion about
// a row that genuinely says nothing rather than one we forgot to fill in.
const ROWS = [
  {
    // Everything stated, and none of it already said in the free text: the
    // pay basis, the currency and the country all have work to do.
    id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme",
    title: "Staff Engineer", location: "Cambridge", country: "GB",
    salary: "$120,000 – $150,000", salaryMinAnnual: 120000, salaryMaxAnnual: 150000,
    salaryPeriod: "year", salaryCurrency: "USD",
    workMode: "remote", employmentType: "full_time", experienceBand: "senior", minYears: 6,
    category: "engineering", department: "Platform",
    postedAt: ago(3), lastSeen: ago(3), recheckedAt: ago(0), applyUrl: "https://x/1", remote: true,
  },
  {
    // The employer already said "per hour" and "USD", and the location already
    // says the country. Every suppressing helper must stay quiet here.
    id: "lever:beta:2", source: "lever", token: "beta", company: "Beta",
    title: "Warehouse Associate", location: "Austin, TX, USA", country: "US",
    salary: "USD 32.00 per hour", salaryMinAnnual: 66560, salaryMaxAnnual: null,
    salaryPeriod: "hour", salaryCurrency: "USD",
    workMode: "onsite", employmentType: "part_time", experienceBand: null, minYears: null,
    category: "operations", department: null,
    postedAt: ago(1), lastSeen: ago(1), recheckedAt: null, applyUrl: "https://x/2", remote: false,
  },
  {
    // States almost nothing, and is 400 days past its own posted date — the
    // field-window comparison's one true case on this page.
    id: "workday:gamma:3", source: "workday", token: "gamma", company: "Gamma",
    title: "Quiet Role", location: "Berlin, Germany", country: "DE",
    salary: null, salaryMinAnnual: null, salaryMaxAnnual: null,
    salaryPeriod: null, salaryCurrency: null,
    workMode: null, employmentType: null, experienceBand: null, minYears: null,
    category: "engineering", department: null,
    postedAt: ago(400), lastSeen: ago(400), recheckedAt: null, applyUrl: "https://x/3", remote: false,
  },
  {
    // A source the board serves but holds no label for, and no employer date.
    // Both fallbacks in one row.
    id: "brandnewats:delta:4", source: "brandnewats", token: "delta", company: "Delta",
    title: "Undated Role", location: "Remote", country: null,
    salary: null, salaryMinAnnual: null, salaryMaxAnnual: null,
    salaryPeriod: null, salaryCurrency: null,
    workMode: null, employmentType: null, experienceBand: null, minYears: null,
    category: "other", department: null,
    postedAt: null, lastSeen: ago(9), recheckedAt: null, applyUrl: "https://x/4", remote: true,
  },
];

// get_company_fill_curve rows. Every field the gates read must be present: the
// three branches consult relists_90d, fills_90d, sufficient, dated_coverage,
// fill_rate_14 and tracking_days, and a row missing one of them is refused for
// the wrong reason — which would make this guard pass on a broken fixture.
//
// acme: fills fast AND relists often — it qualifies for BOTH the caution and
//       the praise, which is the one case the single slot has to get right.
// beta: the same fast-fill record with no churn, so the slot speaks well of it
//       — which is how we know the caution won on merit rather than because
//       the praise branch is dead.
// gamma: a real takedown record, but a fill rate BELOW URGENT_FILL_RATE_MIN.
//       It falls through to the count-only branch, and it is there to prove
//       the new 0.5 rate gate is live. Refusing gamma via `sufficient: false`
//       instead would have proved only that a thin row is silent, which was
//       already true before the change.
// delta: THE WINDOWED TENANT, and the row the deployed RPC actually returns for
//       one. get_company_fill_curve is `FROM toks t LEFT JOIN ...` with
//       COALESCE(...,0), so an employer whose board is bigger than one visit can
//       read — no closure of theirs ever observable — comes back 0/0 rather than
//       absent. Measured live 2026-09-09, seventeen of the thirty largest
//       employers on the board looked exactly like this, and the slot rendered
//       NOTHING for them: an empty slot beside Beta's green one reads as "not
//       hiring" about the employer with 34,000 open roles. The third state has
//       the slot now.
const CURVE = [
  {
    company_token: "acme", open_roles: 12, fills_90d: 20, relists_90d: 7, ageouts_90d: 2,
    n_at_risk_14: 60, fills_le_14: 14,
    fill_rate_14: 0.62, fill_rate_14_lo: 0.55, fill_rate_14_hi: 0.69,
    relist_rate_14: 0.10, still_open_14: 0.28, fill_rate_7: 0.30, fill_rate_30: 0.80,
    median_days_to_fill: 11, median_censored: false,
    dated_coverage: 0.80, dated_n: 40, undated_n: 10,
    fill_through: 0.70, churn: 0.26, absorption: 0.10, tracking_days: 90, sufficient: true,
  },
  {
    company_token: "beta", open_roles: 4, fills_90d: 11, relists_90d: 0, ageouts_90d: 1,
    n_at_risk_14: 45, fills_le_14: 12,
    fill_rate_14: 0.58, fill_rate_14_lo: 0.52, fill_rate_14_hi: 0.64,
    relist_rate_14: 0.02, still_open_14: 0.40, fill_rate_7: 0.25, fill_rate_30: 0.75,
    median_days_to_fill: 12, median_censored: false,
    dated_coverage: 0.80, dated_n: 33, undated_n: 8,
    fill_through: 0.90, churn: 0, absorption: 0.05, tracking_days: 90, sufficient: true,
  },
  {
    company_token: "gamma", open_roles: 3, fills_90d: 6, relists_90d: 1, ageouts_90d: 4,
    n_at_risk_14: 38, fills_le_14: 6,
    fill_rate_14: 0.18, fill_rate_14_lo: 0.12, fill_rate_14_hi: 0.25,
    relist_rate_14: 0.04, still_open_14: 0.78, fill_rate_7: 0.05, fill_rate_30: 0.35,
    median_days_to_fill: null, median_censored: true,
    dated_coverage: 0.80, dated_n: 29, undated_n: 7,
    fill_through: 0.50, churn: 0.14, absorption: 0.20, tracking_days: 90, sufficient: true,
  },
  {
    company_token: "delta", open_roles: 900, fills_90d: 0, relists_90d: 0, ageouts_90d: 0,
    n_at_risk_14: 0, fills_le_14: 0,
    fill_rate_14: 0, fill_rate_14_lo: 0, fill_rate_14_hi: 0,
    relist_rate_14: 0, still_open_14: 0, fill_rate_7: 0, fill_rate_30: 0,
    median_days_to_fill: null, median_censored: true,
    dated_coverage: 0, dated_n: 0, undated_n: 0,
    fill_through: 0, churn: 0, absorption: 0, tracking_days: 90, sufficient: false,
  },
];

// get_category_fill_curve rows. still_open_14 must be <= 0.5 or
// outstaysFieldHorizon refuses by design — most of the field has to resolve
// inside the horizon before "up longer than most" means anything.
const FIELD_CURVE = [
  {
    category: "engineering", n_at_risk_14: 900, fills_le_14: 400,
    fill_rate_14: 0.44, fill_rate_14_lo: 0.40, fill_rate_14_hi: 0.48,
    relist_rate_14: 0.12, still_open_14: 0.44,
    median_days_to_fill: 16, median_censored: false,
    dated_coverage: 0.70, window_days: 60, sufficient: true,
  },
];

function mount(path = "/jobs", field: unknown[] = FIELD_CURVE) {
  window.history.replaceState({}, "", path);
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_company_fill_curve") return { data: CURVE, error: null };
    if (fn === "get_category_fill_curve") return { data: field, error: null };
    return { data: [], error: null };
  });
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-board" && b.action === "detail") {
      return { data: { job: ROWS.find((r) => r.id === b.id) ?? null, description: "" } };
    }
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: ROWS.length } };
      return {
        data: {
          jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length,
          companies: [{ token: "acme", name: "Acme", count: 12 }],
          companiesCount: 1, categories: {}, failedSources: [], failedCount: 0,
          refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const text = () => document.body.textContent ?? "";
const hits = (s: string) => text().split(s).length - 1;
// SCOPED READS. The board's own filter controls carry several of the same
// words the cards do ("Takes roles down" is a control AND a chip; "Pay
// Transparency Index" lives in the footer), so a document-wide count answers a
// different question from the one being asked. `list()` is the rendered cards
// and nothing else; `panel()` is the open detail pane.
const cards = () => Array.from(document.querySelectorAll("[data-job-id]"));
const list = () => cards().map((c) => c.textContent ?? "").join("\u0000");
const listHits = (s: string) => list().split(s).length - 1;
const panel = () => (screen.getAllByRole("dialog")[0]?.textContent ?? "");

describe("a card that shows nine chips shows nothing", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  it("behaviour: the trust claim finally names the hiring system, and falls back when it cannot", async () => {
    mount();
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    // The differentiator, made checkable: a reader can go and look at Acme's
    // Greenhouse board in ten seconds. "Verified direct from Acme" could not
    // be checked at all.
    expect(text()).toContain("Direct from Acme on Greenhouse");
    expect(text()).toContain("Direct from Beta on Lever");
    expect(text()).toContain("Direct from Gamma on Workday");
    // A source we hold no vendor label for keeps the un-named sentence rather
    // than printing "brandnewats" at the reader.
    expect(text()).toContain("Verified direct from Delta");
    expect(text(), "a raw column value reached the page").not.toContain("brandnewats");
  });

  it("behaviour: the pay basis and the currency are stated — and only where the employer has not stated them", async () => {
    mount();
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    // Acme states an annual figure in dollars and says neither of those things
    // in its own text, so the card says both.
    expect(text()).toContain("annual rate");
    expect(text()).toContain("(USD)");
    // Beta's own words are "USD 32.00 per hour". Repeating either would be
    // noise on the line the reader is scanning.
    expect(hits("hourly rate"), "a basis the employer already stated").toBe(0);
    expect(hits("(USD)"), "a currency the employer already stated").toBe(1);
    // Gamma and Delta state no pay at all: no basis, no currency, no "—".
    expect(text()).not.toContain("Not specified");
  });

  it("behaviour: the country is added where the place name is ambiguous, and nowhere else", async () => {
    mount();
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    // "Cambridge" is two countries and the card now says which.
    expect(text()).toContain("Cambridge · United Kingdom");
    // "Austin, TX, USA" and "Berlin, Germany" have already answered.
    expect(hits("United States"), "the location line already said USA").toBe(0);
    expect(hits("Germany"), "the location line already said Germany").toBe(1);
  });

  it("behaviour: the employer track record gets ONE slot, and a caution takes it from praise", async () => {
    mount();
    // The closure-log lookup is a SECOND async hop after the list lands, so
    // every assertion here waits for the chip itself rather than for a card
    // that has not been told about its employer yet.
    // THE COUNT IS A FLOOR. The collector logs at most one re-list per title
    // per company per day, so the true number can only be higher — "(7×)" was
    // an equality claim over a deduped count and the "×+" is the correction,
    // not decoration. If the marker ever goes away this must fail.
    await waitFor(() => expect(text()).toContain("Re-lists roles often (7×+)"), SLOW);
    await waitFor(() => expect(text()).toContain("Fills fast — 58% within 14d"), SLOW);
    // SCOPED TO THE CARDS, not the document: "Takes roles down" is the filter
    // control's label as well as the chip's, and a document-wide wait would be
    // satisfied by a control that renders before the closure lookup has even
    // been made — the exact way a chip guard goes vacuous.
    await waitFor(() => expect(list()).toContain("Takes roles down"), SLOW);
    // Acme fills 62% of its roles inside the horizon AND re-lists at least 7
    // times. It qualifies for both branches; the caution is what a reader
    // needs. Asserted on ACME'S OWN CARD rather than document-wide, for the
    // same reason.
    const acme = cards().find((c) => (c.textContent ?? "").includes("Acme"));
    expect(acme, "Acme's card is not on the page").toBeTruthy();
    const acmeText = acme!.textContent ?? "";
    expect(acmeText, "the caution must take the slot").toContain("Re-lists roles often");
    expect(acmeText, "praise must not sit beside the caution about the same employer")
      .not.toContain("Fills fast");
    expect(acmeText, "praise must not sit beside the caution about the same employer")
      .not.toContain("Takes roles down");
    // Beta has the same fast-fill record and no churn, so the slot speaks well
    // of it — proving the caution won on merit and not because the positive
    // branch is dead. Gamma has a real takedown record but a fill rate under
    // URGENT_FILL_RATE_MIN, so it falls through to the count-only branch: the
    // weakest true statement, and the only one left for that slot. Both waited
    // for above. Delta's closure ledger is EMPTY — a board too big to read in
    // one visit — and that is the third state, not a fourth positive: it takes
    // the slot with a muted "No closure record" and is asserted separately
    // below. Three positive-or-caution statements over four cards. Counted over
    // the CARDS only, for the reason above.
    expect(listHits("Re-lists roles often") + listHits("Fills fast") + listHits("Takes roles down")).toBe(3);
    // And no card carries two of them.
    for (const c of cards()) {
      const t = c.textContent ?? "";
      const said = ["Re-lists roles often", "Fills fast", "Takes roles down"].filter((x) => t.includes(x));
      expect(said.length, `two employer statements on one card: ${said.join(" + ")}`).toBeLessThanOrEqual(1);
    }
    // ── THE THIRD STATE HAS THE SLOT IT USED TO LEAVE EMPTY ────────────────
    // Delta's row is 0/0: we have never watched one of its postings come off
    // the board, because its feed is bigger than one visit can read. That is
    // OUR instrument, and until this branch existed the card said nothing at
    // all — which, next to Beta's green chip, is a claim about Delta. It must
    // say "we cannot read this", and it must NOT say the positive thing.
    const delta = cards().find((c) => (c.textContent ?? "").includes("Delta"));
    expect(delta, "Delta's card is not on the page").toBeTruthy();
    const deltaText = delta!.textContent ?? "";
    await waitFor(() => expect(delta!.textContent ?? "").toContain("No closure record"), SLOW);
    expect(deltaText, "an unreadable record must never render as the positive one")
      .not.toContain("Takes roles down");
    expect(deltaText).not.toContain("Fills fast");
    expect(deltaText).not.toContain("Re-lists roles often");
  });

  it("behaviour: the field-window comparison appears only on a posting the EMPLOYER dated", async () => {
    const { unmount } = mount();
    await waitFor(() => expect(text()).toContain("Quiet Role"), SLOW);
    // Gamma is 400 days past its own stated date, in a field where 56% of
    // roles are off the board inside the 14-day horizon.
    //
    // The claim no longer names a percentile. "Open longer than 75% of X" was
    // a quantile the Aalen-Johansen curve does not produce, and the old
    // p75_days_open it came from was computed over a sample that could only
    // contain roles lasting 7–30 days.
    await waitFor(() => expect(text()).toContain("Up longer than most Engineering & IT roles last"), SLOW);
    // A COUNT OF 1 CAN BE SATISFIED BY THE WRONG CARD. Name both sides: the
    // posting the employer dated gets the comparison, and the undated one gets
    // silence rather than a comparison built on our discovery time.
    const chip = "Up longer than most";
    const cardFor = (title: string) => (cards().find((c) => (c.textContent ?? "").includes(title))?.textContent ?? "");
    expect(cardFor("Quiet Role"), "a dated posting past its field's horizon must be told so").toContain(chip);
    expect(cardFor("Undated Role"), "first_seen is our discovery date and is never a posting age")
      .not.toContain(chip);
    // Acme is 3 days old in the same field and must also stay silent.
    expect(listHits(chip)).toBe(1);
    // A PUBLISHED DURATION NAMES THE WINDOW IT WAS MEASURED INSIDE. The chip's
    // visible text names neither — dropping "75%" was right, but it took the
    // basis with it — so the standing honesty rule now rests entirely on the
    // title, and the title is therefore load-bearing rather than a courtesy.
    const chipEl = Array.from(document.querySelectorAll("[title]"))
      .find((e) => (e.textContent ?? "").includes(chip));
    expect(chipEl, "the comparison chip carries no tooltip at all").toBeTruthy();
    const tip = chipEl!.getAttribute("title") ?? "";
    expect(tip, "the tooltip must name the observation window").toContain("last 60 days");
    expect(tip, "the tooltip must name the horizon the share was read at").toContain("within 14 days");
    expect(tip, "the tooltip must state the share it is comparing against").toContain("56%");
    unmount();

    // AND THE HONESTY FLOOR IS LIVE, not merely absent-by-accident. Without
    // this second render the guard cannot tell a working gate from a deleted
    // one: every assertion above would still pass if `sufficient` were ignored.
    invoke.mockReset(); rpc.mockReset();
    mount("/jobs", [{ ...FIELD_CURVE[0], sufficient: false }]);
    await waitFor(() => expect(text()).toContain("Quiet Role"), SLOW);
    expect(listHits(chip), "a field the estimator cannot stand behind must say nothing").toBe(0);
  });

  it("behaviour: the company-level open-role count is gone from the card", async () => {
    mount();
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    // It was the highest-frequency element on the board — every card of any
    // employer with eight or more openings carried the same company-level
    // number, in the row where a reader is trying to tell those postings
    // APART. The fact survives in the panel, attached to the control that
    // acts on it.
    expect(text()).not.toContain("12 open roles");
    expect(JOBS, "the map that fed it is gone too").not.toMatch(/companyCounts\.get\(/);
    expect(JOBS).not.toMatch(/jobsPage\.openRoles/);
  });

  it("behaviour: compact density still hides the actions and keeps the evidence", async () => {
    mount();
    await waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
    const toggle = document.querySelector('[aria-pressed][title="Switch list density"]') as HTMLElement | null;
    expect(toggle, "the density toggle must survive the redesign").not.toBeNull();
    expect(toggle!.getAttribute("aria-pressed")).toBe("false");
    // The action row is present and shown in the roomy view.
    const actions = () => cards()[0].querySelector<HTMLElement>(".mt-3");
    expect(actions()?.textContent).toContain("Check my fit");
    expect(actions()?.className, "the roomy view shows the actions").not.toContain("hidden");
    fireEvent.click(toggle!);
    await waitFor(() => expect(toggle!.getAttribute("aria-pressed")).toBe("true"), SLOW);
    // Rows are genuinely denser: the per-card action row folds away.
    expect(actions()?.className, "compact must still fold the actions away").toContain("hidden");
    // The differentiator is not a luxury of the roomy view.
    expect(list()).toContain("Direct from Acme on Greenhouse");
  });

  it("behaviour: the detail panel answers in labelled rows, and omits the rows it cannot fill", async () => {
    mount("/jobs?job=greenhouse:acme:1");
    await waitFor(() => expect(panel()).toContain("Work mode"), SLOW);
    // The panel is READ, not skimmed: every fact carries the label that says
    // WHICH fact it is. An unlabelled "Contract" pill could be the employment
    // type or the seniority; a labelled row cannot be.
    for (const label of ["Pay", "Work mode", "Job type", "Experience", "Country", "Field", "Posted"]) {
      expect(panel(), `the panel must label ${label}`).toContain(label);
    }
    // The panel states the annualization's arithmetic in full rather than in a
    // tooltip the reader may never open.
    expect(panel()).toContain("as stated in the posting");
    // A fact the employer did not state has NO ROW — not a dash, not "—", not
    // "Not specified". The absence of a row is the absence of a STATEMENT.
    expect(panel()).not.toContain("Not specified");
    expect(panel()).not.toContain("Not stated");
  });

  it("behaviour: a posting that states almost nothing gets almost no rows", async () => {
    mount("/jobs?job=workday:gamma:3");
    await waitFor(() => expect(panel()).toContain("Quiet Role"), SLOW);
    // Gamma states no pay, no work mode, no employment type and no seniority.
    // Every one of those labels must be absent — a fact list that prints empty
    // rows is the aggregator behaviour this board exists to refuse.
    for (const label of ["Pay", "Work mode", "Job type", "Experience"]) {
      expect(panel(), `${label} was rendered for a posting that states none`).not.toContain(label);
    }
    // What it DOES state still shows.
    expect(panel()).toContain("Country");
    expect(panel()).toContain("Posted");
  });

  it("the precedence that keeps a caution from losing its slot is code, not a comment", () => {
    // The repost branch must be read BEFORE either positive branch, or the
    // compression silently becomes an edit.
    //
    // NEVER SLICE ON AN UNCHECKED indexOf HERE. This guard was anchored to
    // `const churn = hh.superseded_90d ?? 0;`, which the estimator change
    // rewrote to read relists_90d. indexOf returned -1, `slice(-1)` silently
    // reduced the search space to the file's LAST CHARACTER, and the guard
    // then truthfully reported "the caution branch is missing" about a branch
    // sitting four lines below its own anchor. A precedence guard that can
    // become vacuous by a rename is worse than no guard: it reports a lost
    // behaviour that was never lost, and next time it will report nothing.
    const anchor = JOBS.indexOf("const churn = hh.relists_90d;");
    expect(anchor, "the one-slot IIFE moved — RE-ANCHOR this guard, do not delete it").toBeGreaterThan(-1);
    const slot = JOBS.slice(anchor);
    const iChurn = slot.indexOf("churn >= REPOST_FLAG_MIN");
    // Anchored on the BRANCH CONDITION, not on a constant name: the praise
    // branch's tooltip interpolates URGENT_FILL_MAX_DAYS too, so the old
    // anchor found the copy rather than the gate and an ordering assertion
    // against it was measuring the wrong thing.
    const iFast = slot.indexOf("hh.fills_90d >= ACTIVELY_HIRING_MIN_CLOSED");
    const iActive = slot.indexOf("isActivelyHiring(job.token)");
    expect(iChurn, "the caution branch is missing").toBeGreaterThan(-1);
    // A vanished PRAISE branch must be reported as itself. Without these the
    // ordering assertions below would fail with "0 is not less than -1", which
    // reads as a precedence bug and sends the next reader to the wrong place.
    expect(iFast, "the fills-fast branch is missing").toBeGreaterThan(-1);
    expect(iActive, "the actively-hiring branch is missing").toBeGreaterThan(-1);
    expect(iChurn, "praise is read before the caution").toBeLessThan(iFast);
    expect(iChurn).toBeLessThan(iActive);
    // And every gate is still the shared constant, not a number typed again.
    // NOTE these read JOBS (comment-stripped) and not RAW: the block comment
    // directly above the slot spells `churn >= REPOST_FLAG_MIN` out in prose,
    // so a raw-source assertion would pass over a deleted branch.
    expect(JOBS).toMatch(/const REPOST_FLAG_MIN = 3;/);
    expect(JOBS).toMatch(/const ACTIVELY_HIRING_MIN_CLOSED = 3;/);
    expect(JOBS).toMatch(/const URGENT_FILL_MAX_DAYS = 14;/);
    // THE GATE THE CHANGE ADDED IN FRONT OF THE PRAISE BRANCH. The old chip
    // fired on a median that could only ever land near 15 for anyone; the rate
    // floor and the shared sufficiency predicate are what now stand between a
    // thin record and an "apply early" nudge, so they are pinned here with the
    // three that were already load-bearing.
    expect(JOBS).toMatch(/const URGENT_FILL_RATE_MIN = 0\.5;/);
    expect(
      slot.slice(iFast, iFast + 200),
      "the fills-fast branch must go through the shared sufficiency predicate and the rate floor",
    ).toMatch(/canStateFillRate\(hh, hh\.tracking_days\)[\s\S]*hh\.fill_rate_14 >= URGENT_FILL_RATE_MIN/);
  });

  it("the reason the tiers exist is written down where the next tidy-up will read it", () => {
    // PROSE, so RAW.
    expect(RAW).toMatch(/THE CARD, IN THREE TIERS/);
    expect(RAW).toMatch(/ONE SLOT FOR WHAT THIS EMPLOYER ACTUALLY DOES/);
    expect(RAW).toMatch(/THE RIGHT RAIL IS ABOUT THE READER/);
    expect(RAW).toMatch(/AT A GLANCE: A LABELLED FACT LIST, NOT A CHIP CLOUD/);
  });
});
