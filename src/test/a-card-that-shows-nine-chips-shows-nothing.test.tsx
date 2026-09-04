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
// the employer. Not one GATE moved — REPOST_FLAG_MIN,
// ACTIVELY_HIRING_MIN_CLOSED and URGENT_FILL_MAX_DAYS are the same numbers.
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

// acme: fills fast AND relists often — qualifies for BOTH old chips, which is
// the case the single slot has to get right.
// beta: fills fast, no churn.
// gamma: fills, but slowly.
const HEALTH = [
  { company_token: "acme", open_roles: 12, closed_90d: 20, superseded_90d: 7, median_days_open: 12, median_days_to_close: 9, tracking_days: 90 },
  { company_token: "beta", open_roles: 4, closed_90d: 11, superseded_90d: 0, median_days_open: 10, median_days_to_close: 8, tracking_days: 90 },
  { company_token: "gamma", open_roles: 3, closed_90d: 6, superseded_90d: 1, median_days_open: 40, median_days_to_close: 45, tracking_days: 90 },
];

const FILL_SPEED = [
  { category: "engineering", closures: 4200, median_days_open: 18, p75_days_open: 34, window_days: 60 },
];

function mount(path = "/jobs") {
  window.history.replaceState({}, "", path);
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_company_hiring_health") return { data: HEALTH };
    if (fn === "get_category_fill_speed") return { data: FILL_SPEED };
    return { data: [] };
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
// words the cards do ("Actively hiring" is a control AND a chip; "Pay
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
    await waitFor(() => expect(text()).toContain("Relists roles often (7×)"), SLOW);
    await waitFor(() => expect(text()).toContain("Typically fills in ~8d"), SLOW);
    await waitFor(() => expect(text()).toContain("Actively hiring"), SLOW);
    // Acme fills in ~9 days AND relists 7 times. It qualified for both the
    // urgency chip and the repost chip; the caution is what a reader needs.
    expect(text(), "praise must not sit beside the caution about the same employer")
      .not.toContain("Typically fills in ~9d");
    // Beta has the same fast-fill record and no churn, so the slot speaks well
    // of it — proving the caution won on merit and not because the positive
    // branch is dead. Gamma fills, but not fast: the weakest true statement,
    // and the only one left for that slot. Both waited for above.
    // Delta has no closure record at all — the slot is simply empty. One
    // statement per card, four cards, three statements. Counted over the CARDS
    // only: "Actively hiring" is also a filter control on this page.
    expect(listHits("Relists roles often") + listHits("Typically fills in") + listHits("Actively hiring")).toBe(3);
    // And no card carries two of them.
    for (const c of cards()) {
      const t = c.textContent ?? "";
      const said = ["Relists roles often", "Typically fills in", "Actively hiring"].filter((x) => t.includes(x));
      expect(said.length, `two employer statements on one card: ${said.join(" + ")}`).toBeLessThanOrEqual(1);
    }
  });

  it("behaviour: the field-window comparison appears only on a posting the EMPLOYER dated", async () => {
    mount();
    await waitFor(() => expect(text()).toContain("Quiet Role"), SLOW);
    // Gamma is 400 days past its own stated date, against a field whose p75 is
    // 34 days over 4,200 tracked closings.
    await waitFor(() => expect(text()).toContain("Open longer than 75% of Engineering & IT roles"), SLOW);
    // Acme is 3 days old in the same field, and Delta is undated — an undated
    // posting must get silence, not a comparison built on our discovery time.
    expect(listHits("Open longer than 75%")).toBe(1);
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
    const slot = JOBS.slice(JOBS.indexOf("const churn = hh.superseded_90d ?? 0;"));
    const iChurn = slot.indexOf("churn >= REPOST_FLAG_MIN");
    const iFast = slot.indexOf("URGENT_FILL_MAX_DAYS");
    const iActive = slot.indexOf("isActivelyHiring(job.token)");
    expect(iChurn, "the caution branch is missing").toBeGreaterThan(-1);
    expect(iChurn, "praise is read before the caution").toBeLessThan(iFast);
    expect(iChurn).toBeLessThan(iActive);
    // And every gate is still the shared constant, not a number typed again.
    expect(JOBS).toMatch(/const REPOST_FLAG_MIN = 3;/);
    expect(JOBS).toMatch(/const ACTIVELY_HIRING_MIN_CLOSED = 3;/);
    expect(JOBS).toMatch(/const URGENT_FILL_MAX_DAYS = 14;/);
  });

  it("the reason the tiers exist is written down where the next tidy-up will read it", () => {
    // PROSE, so RAW.
    expect(RAW).toMatch(/THE CARD, IN THREE TIERS/);
    expect(RAW).toMatch(/ONE SLOT FOR WHAT THIS EMPLOYER ACTUALLY DOES/);
    expect(RAW).toMatch(/THE RIGHT RAIL IS ABOUT THE READER/);
    expect(RAW).toMatch(/AT A GLANCE: A LABELLED FACT LIST, NOT A CHIP CLOUD/);
  });
});
