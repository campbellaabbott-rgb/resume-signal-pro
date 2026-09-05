// A FINDING BURIED IN ITS OWN METHOD.
//
// The detail panel's Pay block, as it read on the live board:
//
//   $92,000 – $110,000 (USD)
//   as stated in the posting
//   Field median floor: $114,000 (USD, from 17668 postings that state pay) ·
//   hourly, daily and monthly rates annualized (hourly ×2080, daily ×260);
//   part-time and casual rates are left un-annualized · 19% below the median
//   floor
//
// The comparison is the one thing on that page no competitor holds — what a
// field's advertised pay floor ACTUALLY is, computed live off the postings
// that state pay, not off a survey — and the sentence about THIS posting was
// the last clause of a fifty-word methodology paragraph, in the same 11px
// grey as the arithmetic in front of it. It was presented in the wrong order,
// not wrongly.
//
// ── WHAT CHANGED, AND WHAT DELIBERATELY DID NOT ─────────────────────────────
//
// Inverted, and nothing else. The finding leads, in its own weight and its own
// colour. The benchmark and its sample size sit directly under it, in plain
// sight, never folded. The annualization caveat moved one click down into a
// real <details> disclosure — present on every device and in the accessibility
// tree, which a title tooltip is not.
//
// NOT ONE CAVEAT WAS DROPPED, and this file is the mechanical proof: the
// sample size, the currency, "postings that state pay", the ×2080 and ×260
// multipliers and the un-annualized part-time exception are each asserted to
// still be on the page, under the same translation keys, in the same words.
//
// ── THE HOUSE RULES THIS BLOCK LIVES UNDER ──────────────────────────────────
//
// * EVERY NUMBER NAMES ITS BASIS. The finding is a percentage against a
//   benchmark, and the benchmark — its value, its currency, its population and
//   its sample size — is the very next line, never behind the fold.
// * A THIN SAMPLE DOES NOT APPEAR. get_salary_benchmarks self-gates at n>=30
//   and the client re-applies the same floor; below it there is no block at
//   all, not a hedged one.
// * NEVER CONVERTED, NEVER MIXED. A posting priced in a currency other than
//   the field's dominant one gets no comparison rather than a converted one.
// * A FIELD THE EMPLOYER DID NOT STATE RENDERS NOTHING. No stated pay, no
//   block — there is nothing to compare.
//
// The one behavioural addition: pct === 0 used to render the methodology and
// NO finding at all — the single arrangement in which the paragraph was pure
// basis. The percentage is rounded, so "about level" is what it can honestly
// say, and it now says it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const BENCH = [{ category: "engineering", currency: "USD", n: 17_668, median_annual_min: 114_000 }];

const job = (over: Record<string, unknown> = {}) => ({
  id: "j1", company: "Acme", token: "acme", title: "Backend Engineer", source: "greenhouse",
  location: "Austin, TX, USA", country: "US", category: "engineering",
  salary: "$92,000 – $110,000", salaryPeriod: "year", salaryCurrency: "USD",
  salaryMinAnnual: 92_000, salaryMaxAnnual: 110_000,
  applyUrl: "https://acme.example/apply",
  postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), ...over,
});

function mount(row: Record<string, unknown>, bench: unknown[] = BENCH) {
  window.history.replaceState({}, "", "/jobs?job=j1");
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "get_salary_benchmarks") return { data: bench };
    return { data: [] };
  });
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit") return { data: { terms: [], fits: {}, missing: {}, matched: {} } };
    if (fn === "job-board" && b.action === "detail") return { data: { job: row, description: "We need a backend engineer." } };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: 1 } };
      return {
        data: {
          jobs: [row], total: 1, totalAllCompanies: 1, companies: [], companiesCount: 0,
          categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const panel = () => screen.getAllByRole("dialog")[0] as HTMLElement;
const panelText = () => panel().textContent ?? "";

describe("a finding buried in its own method", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  it("behaviour: the finding lands BEFORE the method, not after fifty words of it", async () => {
    mount(job());
    await waitFor(() => expect(panelText()).toContain("below the median floor"), SLOW);
    const text = panelText();
    const finding = text.indexOf("19% below the median floor");
    const benchmark = text.indexOf("Field median floor:");
    const arithmetic = text.indexOf("hourly, daily and monthly rates annualized");
    expect(finding, "the finding did not render at all").toBeGreaterThanOrEqual(0);
    expect(benchmark, "the basis vanished with the reordering").toBeGreaterThanOrEqual(0);
    expect(arithmetic, "the annualization caveat vanished with the reordering").toBeGreaterThanOrEqual(0);
    // THE WHOLE FIX, IN ONE LINE.
    expect(finding, "the finding is still buried behind its own methodology").toBeLessThan(benchmark);
    expect(benchmark).toBeLessThan(arithmetic);
  });

  it("behaviour: the finding is the loud line and the basis is the quiet one", async () => {
    mount(job());
    await waitFor(() => expect(panelText()).toContain("below the median floor"), SLOW);
    const lead = Array.from(panel().querySelectorAll("p"))
      .find((p) => (p.textContent ?? "").trim() === "19% below the median floor")!;
    expect(lead, "the finding is not a line of its own").toBeTruthy();
    expect(lead.className, "a finding in the same weight as the arithmetic reads as arithmetic")
      .toContain("font-semibold");
    // Under, not over: below the floor is a caution, above it is not.
    expect(lead.className).toContain("text-warning");
  });

  it("behaviour: not one caveat was lost in the reordering", async () => {
    mount(job());
    await waitFor(() => expect(panelText()).toContain("below the median floor"), SLOW);
    const text = panelText();
    // The benchmark's own four facts.
    expect(text, "the median value").toContain("$114,000");
    expect(text, "the currency it is priced in").toContain("USD");
    expect(text, "the population it was computed over").toContain("postings that state pay");
    expect(text, "the sample size").toContain("17,668");
    // The arithmetic, in full and in the same words.
    expect(text).toContain("×2080");
    expect(text).toContain("×260");
    expect(text).toContain("part-time and casual rates are left un-annualized");
    // And the posting's own pay is still marked as the employer's statement.
    expect(text).toContain("as stated in the posting");
  });

  it("behaviour: the sample size is grouped like every other figure in the block", async () => {
    // "from 17668 postings" sat beside a median written "$114,000" — the one
    // number in the block printed raw.
    mount(job());
    await waitFor(() => expect(panelText()).toContain("below the median floor"), SLOW);
    expect(panelText()).toContain("17,668");
    expect(panelText(), "an ungrouped sample size").not.toContain("17668 postings");
  });

  it("behaviour: the method is a real disclosure — closed by default, never a tooltip", async () => {
    mount(job());
    await waitFor(() => expect(panelText()).toContain("below the median floor"), SLOW);
    const details = Array.from(panel().querySelectorAll("details"))
      .find((d) => (d.querySelector("summary")?.textContent ?? "").includes("How this median is measured"));
    expect(details, "the basis is no longer reachable from the panel").toBeTruthy();
    expect(details!.open, "the method should be available, not in the way").toBe(false);
    // Closed, and still in the text a reader can reach and a screen reader can
    // announce — which is exactly what a title attribute is not.
    expect(details!.textContent).toContain("part-time and casual rates are left un-annualized");
  });

  it("behaviour: a posting AT the median gets a finding too, not bare methodology", async () => {
    mount(job({ salary: "$114,000 – $130,000", salaryMinAnnual: 114_000 }));
    await waitFor(() => expect(panelText()).toContain("Field median floor:"), SLOW);
    expect(panelText()).toContain("About level with the median floor");
    expect(panelText()).not.toContain("% below the median floor");
    expect(panelText()).not.toContain("% above the median floor");
  });

  it("behaviour: a posting above the floor is not dressed as a caution", async () => {
    mount(job({ salary: "$140,000 – $170,000", salaryMinAnnual: 140_000 }));
    await waitFor(() => expect(panelText()).toContain("above the median floor"), SLOW);
    const lead = Array.from(panel().querySelectorAll("p"))
      .find((p) => /above the median floor/.test(p.textContent ?? ""))!;
    expect(lead.className).toContain("text-success");
    expect(lead.className).not.toContain("text-warning");
  });

  it("behaviour: a thin sample produces NO block — not a hedged one", async () => {
    // 29 is below the RPC's own floor and below the client's mirror of it.
    mount(job(), [{ category: "engineering", currency: "USD", n: 29, median_annual_min: 114_000 }]);
    // The panel is genuinely open and the benchmark request has answered, so
    // "absent" is a refusal rather than a race.
    await waitFor(() => expect(panelText()).toContain("Backend Engineer"), SLOW);
    await waitFor(() => expect(rpc.mock.calls.some((c) => c[0] === "get_salary_benchmarks")).toBe(true), SLOW);
    expect(panelText(), "a median over 29 postings is noise with a dollar sign")
      .not.toContain("Field median floor:");
    expect(panelText()).not.toContain("below the median floor");
    // The employer's own stated pay is a different fact and survives.
    expect(panelText()).toContain("$92,000");
  });

  it("behaviour: a posting in another currency is never converted into a comparison", async () => {
    mount(job({ salary: "€92,000 – €110,000", salaryCurrency: "EUR" }));
    await waitFor(() => expect(panelText()).toContain("Backend Engineer"), SLOW);
    await waitFor(() => expect(rpc.mock.calls.some((c) => c[0] === "get_salary_benchmarks")).toBe(true), SLOW);
    expect(panelText()).not.toContain("Field median floor:");
    expect(panelText()).not.toContain("median floor");
  });

  it("behaviour: a posting that states no pay gets no pay block at all", async () => {
    mount(job({ salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null }));
    await waitFor(() => expect(panelText()).toContain("Backend Engineer"), SLOW);
    await waitFor(() => expect(rpc.mock.calls.some((c) => c[0] === "get_salary_benchmarks")).toBe(true), SLOW);
    expect(panelText()).not.toContain("as stated in the posting");
    expect(panelText()).not.toContain("median floor");
  });

  it("the sample floor and the same-currency gate are still upstream of the render", () => {
    // Both refusals live in detailSalaryContext, so no arrangement of the JSX
    // below can print a thin or a converted comparison.
    expect(JOBS).toMatch(/if \(!p\?\.annualMin \|\| !p\.currency \|\| p\.currency !== b\.currency\) return null;/);
    expect(JOBS).toMatch(/r\.n >= 30/);
    // The finding branches on the sign and has an arm for every one of them.
    expect(JOBS).toMatch(/jobsPage\.salaryAbove/);
    expect(JOBS).toMatch(/jobsPage\.salaryBelow/);
    expect(JOBS).toMatch(/jobsPage\.salaryLevel/);
    expect(JOBS).toMatch(/detailSalaryContext\.n\.toLocaleString\(\)/);
  });

  it("every new string is translated in all nine locales, not defaulted into English", () => {
    for (const l of ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const j = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${l}.json`), "utf8"));
      for (const k of ["salaryLevel", "salaryContextBasisSummary", "factLocationRaw", "locationTidiedNote", "saveTip"]) {
        expect(j.jobsPage?.[k], `${l} is missing jobsPage.${k}`).toBeTruthy();
      }
      if (l === "en" || l === "en-GB") continue;
      // A "translation" identical to the English is a missing translation
      // wearing a key — the failure mode nine locale files exist to prevent.
      const en = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales/en.json"), "utf8"));
      for (const k of ["salaryLevel", "salaryContextBasisSummary", "factLocationRaw", "locationTidiedNote", "saveTip"]) {
        expect(j.jobsPage[k], `${l}.jobsPage.${k} is still the English string`).not.toBe(en.jobsPage[k]);
      }
    }
  });

  it("the reason the finding leads stays written down", () => {
    // PROSE, so raw source. Delete this and the block drifts back to reading
    // as methodology with a verdict tacked on the end.
    expect(RAW).toMatch(/THE FINDING FIRST, THE METHOD UNDERNEATH/);
    expect(RAW).toMatch(/NOT ONE CAVEAT WAS DROPPED/);
  });
});
