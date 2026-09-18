// A FILING IS PRINTED AS A FILING, WITH ITS SOURCE LINK -- OR NOT AT ALL.
//
// The three board surfaces and the Ghost Index section that carry a layoff
// filing (SPEC §7), judged the way the live click-through memo judges every
// control: by the request record and the rendered element, never by pixels.
// The rpc hook is installed BEFORE the mount -- mount() sets the mock and
// only then renders -- so the batch the page sent is in the record.
//
// What is pinned here, each beside a positive control so no assertion is
// satisfiable by a surface that renders nothing at all:
//
//   1. One matched filing → the card chip renders with the filer's name
//      VERBATIM as the source spells it, the filing's own date, and an href
//      that is the source URL; the token was asked for in one batch with
//      every other visible token.
//   2. The reader's answer for an ambiguous or single-token filer is a row
//      with a NULL source; that renders nothing. A row that carries a source
//      but flags itself ambiguous, or names a matched_via the matcher does
//      not admit, renders nothing too (the client mirror of the never-surface
//      rule) -- and the same row without the flag renders, which is the
//      proof the refusal is doing the hiding.
//   3. A state notice hides on a posting whose stated country is not the US;
//      an 8-K on the same posting prints, named as an SEC filing.
//   4. The detail panel line prints the sentence with the filer verbatim,
//      both dates, the count and the source anchor.
//   4b. The employer page's Hiring Health card lists every qualifying filing
//      under "Also on record:", newest first, each with its own link -- and
//      it does not live in the header beside the pill.
//   5. The Ghost Index section on a sufficient_30=false fixture renders the
//      unavailable sentence with the reason in words and the gate it did not
//      clear, and never a share, an interval or either arm's figure; the same
//      fixture with both arms sufficient prints the sentence with both arms
//      side by side and no ratio.
//   6. Every layoff.* key carries every placeholder its English value carries,
//      in all nine locales -- a translator cannot drop a number or a date.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
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
import { LayoffPartitionSection } from "../components/ghost/LayoffPartitionSection";
import { readLayoffRow, layoffLineText } from "../components/jobs/LayoffFilingLine";
import { LAYOFF_MIN_ARM_EMPLOYERS, LAYOFF_PARTITION_MIN_N_AT_RISK_30 } from "../config/layoffs";

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 4000 } as const;
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

type Body = Record<string, unknown>;

const ROWS = [
  {
    id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme",
    title: "Staff Engineer", location: "Fremont, CA, USA", country: "US",
    salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
    workMode: "onsite", employmentType: "full_time", experienceBand: "senior", minYears: 6,
    category: "engineering", department: null, agency: false,
    postedAt: ago(3), lastSeen: ago(3), recheckedAt: ago(0), applyUrl: "https://x/1", remote: false,
  },
  {
    id: "lever:beta:2", source: "lever", token: "beta", company: "Beta",
    title: "Warehouse Associate", location: "Manchester, UK", country: "GB",
    salary: null, salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: null, salaryCurrency: null,
    workMode: "onsite", employmentType: "part_time", experienceBand: null, minYears: null,
    category: "operations", department: null, agency: false,
    postedAt: ago(1), lastSeen: ago(1), recheckedAt: null, applyUrl: "https://x/2", remote: false,
  },
];

// A WARN fixture in the shape of the reader's row: the filer as the state
// spells it (upper case, the LLC kept), a notice date, a stamp, the bar.
const WARN_ACME = {
  lf_company_token: "acme", lf_source: "state_warn", lf_relation: "filer",
  lf_filer: "ACME LOGISTICS LLC", lf_event_date: "2026-09-10", lf_event_basis: "warn_notice_date",
  lf_public_date: "2026-09-12", lf_public_basis: "state_received", lf_state: "CA", lf_site: "Fremont",
  lf_workers: 120, lf_event_type: "layoff", lf_effective_date: "2026-11-09", lf_pct: null, lf_headcount: null,
  lf_form: null, lf_source_url: "https://edd.ca.gov/en/jobs_and_training/Layoff_Services_WARN/",
  lf_source_name: "California EDD", lf_read_at: new Date(Date.now() - 3 * 3_600_000).toISOString(), lf_more_n: 0,
};
const SEC_BETA = {
  lf_company_token: "beta", lf_source: "sec_8k_205", lf_relation: "filer",
  lf_filer: "Beta Holdings, Inc.", lf_event_date: "2026-09-08", lf_event_basis: "sec_report_date",
  lf_public_date: "2026-09-11", lf_public_basis: "sec_filed", lf_state: null, lf_site: null,
  lf_workers: null, lf_event_type: null, lf_effective_date: null, lf_pct: 12.5, lf_headcount: null,
  lf_form: "8-K", lf_source_url: "https://www.sec.gov/Archives/edgar/data/1/000000000126000001/beta-8k.htm",
  lf_source_name: "SEC EDGAR", lf_read_at: new Date(Date.now() - 40 * 60_000).toISOString(), lf_more_n: 2,
};
const NONE = (tok: string) => ({
  lf_company_token: tok, lf_source: null, lf_relation: null, lf_filer: null, lf_event_date: null, lf_event_basis: null,
  lf_public_date: null, lf_public_basis: null, lf_state: null, lf_site: null, lf_workers: null, lf_event_type: null,
  lf_effective_date: null, lf_pct: null, lf_headcount: null, lf_form: null, lf_source_url: null, lf_source_name: null,
  lf_read_at: null, lf_more_n: 0,
});

function mount(filings: (tokens: string[]) => unknown[]) {
  window.history.replaceState({}, "", "/jobs");
  rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === "get_employer_layoff_filings") return { data: filings((args?.p_tokens as string[]) ?? []), error: null };
    return { data: [], error: null };
  });
  invoke.mockImplementation(async (fn: string, a: { body?: Body } | undefined) => {
    const b = a?.body ?? {};
    if (fn === "job-fit") return { data: { terms: [] }, error: null };
    if (fn === "job-board" && b.action === "detail") return { data: { job: ROWS.find((r) => r.id === b.id) ?? null, description: "A role." } };
    if (fn === "job-board" && b.action === "facets") return { data: { categories: {}, refreshedAt: ago(0), sources: {}, sourcesAt: ago(0) }, error: null };
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: ROWS.length } };
      return { data: { jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length, companies: [], companiesCount: 0, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false } };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}
const text = () => document.body.textContent ?? "";
const settled = async () => waitFor(() => expect(text()).toContain("Staff Engineer"), SLOW);
const card = (needle: string) => Array.from(document.querySelectorAll<HTMLElement>("[data-job-id]")).find((c) => (c.textContent ?? "").includes(needle))!;
const chipIn = (el: HTMLElement | null | undefined) => el?.querySelector<HTMLAnchorElement>('[data-layoff-filing="chip"]') ?? null;
const layoffCalls = () => rpc.mock.calls.filter(([fn]) => fn === "get_employer_layoff_filings");

describe("a filing is printed as a filing, with its source link -- or not at all", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  it("1. one matched filing renders the chip with the filer verbatim, the date and the source href, and the tokens were asked in one batch", async () => {
    mount((toks) => toks.map((t) => (t === "acme" ? WARN_ACME : NONE(t))));
    await settled();
    await waitFor(() => expect(chipIn(card("Staff Engineer"))).toBeTruthy(), SLOW);
    const chip = chipIn(card("Staff Engineer"))!;
    expect(chip.getAttribute("href")).toBe(WARN_ACME.lf_source_url);
    expect(chip.getAttribute("target")).toBe("_blank");
    expect(chip.getAttribute("rel")).toContain("noopener");
    expect(chip.textContent).toContain("Layoff notice on file");
    const tip = chip.getAttribute("title") ?? "";
    expect(tip, "the filer is the source's spelling, never the tenant's name").toContain("ACME LOGISTICS LLC");
    expect(tip).not.toMatch(/\bAcme made\b/);
    expect(tip).toContain("2026-09-10");
    expect(tip).toContain("California EDD");
    expect(chip.getAttribute("data-layoff-event-date")).toBe("2026-09-10");
    // The request record: one batch, every visible token, no per-card call.
    const calls = layoffCalls();
    expect(calls.length).toBe(1);
    const asked = (calls[0][1] as { p_tokens: string[] }).p_tokens;
    expect([...asked].sort()).toEqual(["acme", "beta"]);
    // The unmatched token's card carries no chip -- and no sentence about it.
    expect(chipIn(card("Warehouse Associate"))).toBeNull();
    expect(text()).not.toMatch(/no filings|no layoffs/i);
  });

  it("2. the reader's NULL-source answer renders nothing; a row flagged ambiguous renders nothing; the same row unflagged renders", async () => {
    // (a) what the reader actually returns for an ambiguous or single-token filer
    mount((toks) => toks.map((t) => NONE(t)));
    await settled();
    await waitFor(() => expect(layoffCalls().length).toBe(1), SLOW);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-layoff-filing]')).toBeNull();
    cleanup(); invoke.mockReset(); rpc.mockReset();
    // (b) the client mirror of the never-surface rule
    mount((toks) => toks.map((t) => (t === "acme" ? { ...WARN_ACME, lf_ambiguous: true } : NONE(t))));
    await settled();
    await waitFor(() => expect(layoffCalls().length).toBe(1), SLOW);
    await new Promise((r) => setTimeout(r, 50));
    expect(chipIn(card("Staff Engineer")), "an ambiguous row must never reach the card").toBeNull();
    cleanup(); invoke.mockReset(); rpc.mockReset();
    // (c) positive control: the identical row without the flag renders
    mount((toks) => toks.map((t) => (t === "acme" ? WARN_ACME : NONE(t))));
    await settled();
    await waitFor(() => expect(chipIn(card("Staff Engineer"))).toBeTruthy(), SLOW);
  });

  it("2b. readLayoffRow refuses every shape the matcher does not admit, and admits the control", () => {
    expect(readLayoffRow(WARN_ACME)).not.toBeNull();
    expect(readLayoffRow(NONE("acme"))).toBeNull();
    expect(readLayoffRow({ ...WARN_ACME, lf_ambiguous: true })).toBeNull();
    expect(readLayoffRow({ ...WARN_ACME, lf_matched_via: "trigram" })).toBeNull();
    expect(readLayoffRow({ ...WARN_ACME, lf_matched_via: "alias" })).not.toBeNull();
    expect(readLayoffRow({ ...WARN_ACME, lf_matched_via: "exact_multitoken" })).not.toBeNull();
    expect(readLayoffRow({ ...WARN_ACME, lf_source_url: "http://edd.ca.gov/" }), "a non-https source never prints").toBeNull();
    expect(readLayoffRow({ ...WARN_ACME, lf_workers: null }), "NULL workers never prints as 0").toBeNull();
    expect(readLayoffRow({ ...SEC_BETA, lf_form: "8-K/A" }), "an 8-K/A never carries a line").toBeNull();
    expect(readLayoffRow({ ...WARN_ACME, lf_source: "sec_8k" }), "an unknown source value is refused").toBeNull();
  });

  it("3. a state notice hides on a posting whose stated country is not the US; an 8-K on the same posting prints as an SEC filing", async () => {
    // Beta is a GB posting. A WARN row for it must not print...
    mount((toks) => toks.map((t) => (t === "beta" ? { ...WARN_ACME, lf_company_token: "beta" } : NONE(t))));
    await settled();
    await waitFor(() => expect(layoffCalls().length).toBe(1), SLOW);
    await new Promise((r) => setTimeout(r, 50));
    expect(chipIn(card("Warehouse Associate"))).toBeNull();
    cleanup(); invoke.mockReset(); rpc.mockReset();
    // ...and an 8-K for it must.
    mount((toks) => toks.map((t) => (t === "beta" ? SEC_BETA : NONE(t))));
    await settled();
    await waitFor(() => expect(chipIn(card("Warehouse Associate"))).toBeTruthy(), SLOW);
    const chip = chipIn(card("Warehouse Associate"))!;
    expect(chip.textContent).toContain("Workforce reduction filed");
    expect(chip.getAttribute("href")).toBe(SEC_BETA.lf_source_url);
    expect(chip.getAttribute("title")).toContain("Beta Holdings, Inc.");
  });

  it("4. the detail panel prints the sentence with the filer verbatim, both dates, the count and the source anchor", async () => {
    mount((toks) => toks.map((t) => (t === "acme" ? WARN_ACME : t === "beta" ? SEC_BETA : NONE(t))));
    await settled();
    await waitFor(() => expect(chipIn(card("Staff Engineer"))).toBeTruthy(), SLOW);
    fireEvent.click(card("Staff Engineer"));
    const line = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-layoff-filing="line"]');
      expect(el).toBeTruthy();
      return el!;
    }, SLOW);
    const s = line.textContent ?? "";
    expect(s).toContain("ACME LOGISTICS LLC filed a layoff notice with California dated 2026-09-10: 120 positions at Fremont, effective 2026-11-09");
    expect(s).toContain("listed by California EDD on 2026-09-12");
    expect(s).toMatch(/read from California EDD \d+h ago/);
    const a = line.querySelector<HTMLAnchorElement>('a[data-layoff-source="state_warn"]');
    expect(a?.getAttribute("href")).toBe(WARN_ACME.lf_source_url);
    expect(a?.textContent).toBe("California EDD ↗");
    // No verdict, no adjective, no absence.
    expect(s).not.toMatch(/\b(ghost|fake|real|quality|legit|live|now)\b/i);
    // The SEC shape, through the pure renderer: percentage, both dates, the
    // link label, and a "+N more" only when the reader counted more.
    const t = (_k: string, d: string, o?: Record<string, unknown>) => d.replace(/\{\{(\w+)\}\}/g, (_, k) => String(o?.[k] ?? ""));
    const sec = layoffLineText(readLayoffRow(SEC_BETA)!, t);
    expect(sec.text).toContain("Beta Holdings, Inc. reported a workforce reduction of about 12.5% in an 8-K (Item 2.05) dated 2026-09-08, filed with the SEC on 2026-09-11");
    expect(sec.linkLabel).toBe("SEC filing");
    // A subsidiary_site relation prints the FILER and the parent sentence.
    const sub = layoffLineText(readLayoffRow({ ...SEC_BETA, lf_relation: "subsidiary_site" })!, t);
    expect(sub.text).toMatch(/^Beta Holdings, Inc\., the parent company of this board's employer, reported a workforce reduction/);
  });

  it("4b. the employer page lists every qualifying filing under 'Also on record:', newest first, each with its own link", async () => {
    const CURVE = {
      company_token: "acme", open_roles: 12, fills_90d: 20, relists_90d: 7, ageouts_90d: 2,
      n_at_risk_14: 60, fills_le_14: 14, fill_rate_14: 0.62, fill_rate_14_lo: 0.55, fill_rate_14_hi: 0.69,
      relist_rate_14: 0.10, still_open_14: 0.28, fill_rate_7: 0.30, fill_rate_30: 0.80,
      median_days_to_fill: 11, median_censored: false, dated_coverage: 0.80, dated_n: 40, undated_n: 10,
      fill_through: 0.70, churn: 0.26, absorption: 0.10, tracking_days: 90, sufficient: true,
    };
    const la = (o: Record<string, unknown>) => Object.fromEntries(Object.entries({ ...WARN_ACME, ...o }).map(([k, v]) => [k.replace(/^lf_/, "la_"), v]));
    const ALL = [
      la({ lf_event_date: "2026-09-10", lf_site: "Fremont" }),
      la({ ...SEC_BETA, lf_company_token: "acme", lf_event_date: "2026-08-20" }),
    ].map((r) => ({ ...r, la_total_n: 2 }));
    window.history.replaceState({}, "", "/jobs/company/acme");
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_company_fill_curve") return { data: [CURVE], error: null };
      if (fn === "get_employer_layoff_filings_all") return { data: ALL, error: null };
      if (fn === "get_employer_layoff_filings") return { data: [WARN_ACME], error: null };
      return { data: [], error: null };
    });
    invoke.mockImplementation(async (fn: string, a: { body?: Body } | undefined) => {
      const b = a?.body ?? {};
      if (fn === "job-fit") return { data: { terms: [] }, error: null };
      if (fn === "job-board" && b.action === "facets") return { data: { categories: {}, refreshedAt: ago(0), sources: {}, sourcesAt: ago(0) }, error: null };
      if (fn === "job-board" && b.action === "list") {
        if (b.facetCounts) return { data: { categories: {} } };
        if (b.countOnly) return { data: { total: 1 } };
        return { data: { jobs: [ROWS[0]], total: 1, totalAllCompanies: 1, companies: [{ token: "acme", name: "Acme", open: 12 }], companiesCount: 1, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false } };
      }
      return { data: {} };
    });
    render(
      <MemoryRouter initialEntries={["/jobs/company/acme"]}>
        <Routes><Route path="/jobs/company/:companyToken" element={<Jobs />} /></Routes>
      </MemoryRouter>,
    );
    const item = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-layoff-filing="record"]');
      expect(el).toBeTruthy();
      return el!;
    }, SLOW);
    expect(item.tagName).toBe("LI");
    expect(item.textContent).toContain("Also on record:");
    const anchors = Array.from(item.querySelectorAll<HTMLAnchorElement>("a[data-layoff-source]"));
    expect(anchors.map((x) => x.getAttribute("href"))).toEqual([WARN_ACME.lf_source_url, SEC_BETA.lf_source_url]);
    expect(item.textContent).toContain("ACME LOGISTICS LLC filed a layoff notice with California dated 2026-09-10");
    expect(item.textContent).toContain("Beta Holdings, Inc. reported a workforce reduction of about 12.5%");
    // The reader asked for THIS token and nothing else, once.
    const calls = rpc.mock.calls.filter(([fn]) => fn === "get_employer_layoff_filings_all");
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toEqual({ p_token: "acme" });
    // Never in the header beside the pill: the item sits inside the card's list.
    expect(item.closest("ul")?.tagName).toBe("UL");
    expect(item.closest("h2")).toBeNull();
    // And the line reads as a list item, not a "+N more" back-link to itself.
    expect(item.textContent).not.toMatch(/more on the employer page/);
  });

  // ── THE GHOST INDEX SECTION ─────────────────────────────────────────────

  const ARM = (arm: "filed" | "control", o: Record<string, unknown>) => ({
    lp_arm: arm, lp_sufficient_30: false, lp_reason: "n",
    lp_taken_down_30: 0.5123, lp_still_open_30: 0.3877, lp_still_open_30_lo: 0.3301, lp_still_open_30_hi: 0.4453,
    lp_half_width_30: 0.0576, lp_relist_rate_30: 0.1, lp_n_at_risk_30: 30, lp_employers_n: 3, lp_max_employer_share: 0.5,
    lp_gate_share_30: 0.9, lp_sum_check_30: 1, lp_cohort_from: "2026-08-07", lp_cohort_to: "2026-08-19", lp_separated: false,
    lp_newest_filing_event_date: "2026-09-15", lp_warn_lag_p50_days: 3, lp_warn_lag_n: 412,
    lp_computed_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), lp_filings_read_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    lp_min_n: 25, lp_max_half_width: 0.15, lp_min_employers: 10, lp_max_employer_share_cap: 0.4, lp_stale_hours: 48,
    ...o,
  });
  const mountSection = (rows: unknown[] | null) => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "get_layoff_partition") return rows ? { data: rows, error: null } : { data: null, error: { message: "boom" } };
      return { data: [], error: null };
    });
    return render(<MemoryRouter><LayoffPartitionSection /></MemoryRouter>);
  };
  const section = () => document.querySelector<HTMLElement>("[data-layoff-partition]");
  const sectionText = () => section()?.textContent ?? "";

  it("5. on a sufficient_30=false fixture the section renders the unavailable sentence with its reason and gate, and never a share or an interval", async () => {
    mountSection([
      ARM("filed", { lp_sufficient_30: false, lp_reason: "employers" }),
      ARM("control", { lp_sufficient_30: true, lp_reason: null, lp_taken_down_30: 0.7012, lp_n_at_risk_30: 700, lp_employers_n: 90 }),
    ]);
    await waitFor(() => expect(section()?.getAttribute("data-layoff-partition")).toBe("unavailable"), SLOW);
    const s = sectionText();
    expect(s).toContain("Roles at employers with a recent layoff filing");
    expect(s).toContain(`No reading yet: fewer than ${LAYOFF_MIN_ARM_EMPLOYERS} employers with a qualifying filing have roles on boards we read to the end. That is a fact about our sample, not about any employer.`);
    // n and the employers ARE on screen, inside the reason (SPEC §1, §7.4)...
    expect(s).toContain("So far 30 such roles at 3 employers have reached our 30-day cap.");
    // ...and the provenance: cadence words from the config, the newest filing
    // by its own date, our read, the computation time.
    expect(s).toContain("Filings read hourly from SEC EDGAR and nightly from state notices as consolidated by Big Local News; newest filing held is dated 2026-09-15, read ");
    expect(s).toContain("; computed ");
    expect(s).toContain("State notices reach the consolidated feed a median 3 days after the notice date (measured ");
    // NEVER a number of the arms: no share, no interval, no "up to", neither figure.
    expect(s).not.toMatch(/%/);
    expect(s).not.toMatch(/±/);
    expect(s).not.toMatch(/up to/i);
    // The clock stamps (read / computed / measured) carry whatever digits the
    // wall clock happens to show -- 12:10:39 PM once matched the \b39\b below --
    // so they are blanked before the arms' figures are looked for.
    const noClocks = s.replace(/\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}(?::\d{2})? [AP]M/g, "<stamp>");
    expect(noClocks).toMatch(/<stamp>/);
    expect(noClocks).not.toMatch(/\b51\b|\b70\b|\b39\b|\b6\b/);
    expect(s).not.toMatch(/\b(ghost|fake|real|quality|legit|live|now)\b/i);
  });

  it("5b. the reason vocabulary renders in words, each with the bar it names; an unwritten arm and a failed read are named as ours", async () => {
    mountSection([ARM("filed", { lp_reason: "n" }), ARM("control", { lp_reason: "n" })]);
    await waitFor(() => expect(sectionText()).toContain(`fewer than ${LAYOFF_PARTITION_MIN_N_AT_RISK_30} such roles reached our 30-day cap`), SLOW);
    cleanup();
    mountSection([ARM("filed", { lp_reason: "share" }), ARM("control", { lp_sufficient_30: true, lp_reason: null })]);
    await waitFor(() => expect(sectionText()).toContain("one employer holds more than 40% of the roles in that group"), SLOW);
    cleanup();
    mountSection([ARM("filed", { lp_reason: "width" }), ARM("control", { lp_reason: "width" })]);
    await waitFor(() => expect(sectionText()).toContain("the interval is wider than ±15 points"), SLOW);
    cleanup();
    mountSection([ARM("filed", { lp_reason: "arithmetic" }), ARM("control", { lp_reason: null, lp_sufficient_30: true })]);
    await waitFor(() => expect(sectionText()).toContain("did not add up to one on this read"), SLOW);
    cleanup();
    // Unwritten: computed_at NULL, the reader answers 'stale'.
    mountSection([
      ARM("filed", { lp_reason: "stale", lp_computed_at: null, lp_filings_read_at: null, lp_newest_filing_event_date: null, lp_n_at_risk_30: null, lp_employers_n: null, lp_warn_lag_n: 0 }),
      ARM("control", { lp_reason: "stale", lp_computed_at: null, lp_filings_read_at: null, lp_newest_filing_event_date: null, lp_n_at_risk_30: null, lp_employers_n: null, lp_warn_lag_n: 0 }),
    ]);
    await waitFor(() => expect(sectionText()).toContain("No reading yet: the reading has not been computed yet."), SLOW);
    expect(sectionText()).not.toMatch(/So far/);
    expect(sectionText()).not.toMatch(/newest filing/);
    expect(sectionText()).toContain("Filings read hourly from SEC EDGAR and nightly from state notices as consolidated by Big Local News.");
    cleanup();
    // The read itself failed: our side, and still rendered, never absent.
    mountSection(null);
    await waitFor(() => expect(section()?.getAttribute("data-layoff-partition")).toBe("unavailable"), SLOW);
    expect(sectionText()).toContain("No reading yet: the reading did not answer on this visit.");
  });

  it("5c. positive control -- with both arms sufficient the sentence prints both arms side by side, n and employers on each, and no ratio", async () => {
    mountSection([
      ARM("filed", { lp_sufficient_30: true, lp_reason: null, lp_n_at_risk_30: 120, lp_employers_n: 12, lp_half_width_30: 0.063, lp_taken_down_30: 0.5, lp_separated: true }),
      ARM("control", { lp_sufficient_30: true, lp_reason: null, lp_taken_down_30: 0.7, lp_n_at_risk_30: 700, lp_employers_n: 90, lp_half_width_30: 0.09, lp_separated: true }),
    ]);
    await waitFor(() => expect(section()?.getAttribute("data-layoff-partition")).toBe("sentence"), SLOW);
    const s = sectionText();
    expect(s).toContain("in the 90 days before a role was posted, up to 50% of dated roles posted 2026-08-07 to 2026-08-19 were taken down for good within 30 days (n=120 roles at 12 employers, ±6 points); across the rest of the board, up to 70% (n=700, ±9). The two ranges do not overlap. Counted only on boards we read to the end. A takedown is not a hire, and a filing is a fact about an employer on one date — not a verdict on any role. Filings read hourly from SEC EDGAR and nightly from state notices as consolidated by Big Local News; newest filing held is dated 2026-09-15, read ");
    expect(s).not.toMatch(/×|\bratio\b|times as|times more|times the/);
    expect(s).not.toMatch(/\bfilled\b/i);
  });

  // ── NINE LOCALES, EVERY PLACEHOLDER ─────────────────────────────────────

  it("6. every layoff.* key carries every placeholder its English value carries, in all nine locales", () => {
    const dir = resolve(__dirname, "../i18n/locales");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    const read = (f: string) => JSON.parse(readFileSync(resolve(dir, f), "utf8")) as Record<string, Record<string, string>>;
    const en = read("en.json");
    const ph = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
    const keys: Array<[string, string]> = [];
    for (const ns of ["jobsPage", "ghostIndex"]) {
      for (const k of Object.keys(en[ns])) if (/^layoff/.test(k) || k === "hhAlsoOnRecord") keys.push([ns, k]);
    }
    // The set the spec names, at minimum -- a rename that drops one is caught here.
    for (const k of ["layoffChipWarn", "layoffChipSec", "layoffTip", "layoffLineWarnNoticed", "layoffLineWarnReceived", "layoffEffective", "layoffKindClosure", "layoffLineSecPct", "layoffLineSecCount", "layoffLineSecNoNumber", "layoffParent", "layoffRead", "layoffReadStale", "layoffMore", "hhAlsoOnRecord"]) {
      expect(keys.some(([ns, kk]) => ns === "jobsPage" && kk === k), `jobsPage.${k} missing from en.json`).toBe(true);
    }
    for (const k of ["layoffTitle", "layoffSentence", "layoffSeparated", "layoffOverlap", "layoffUnavailable", "layoffReasonEmployers", "layoffReasonShare", "layoffReasonN", "layoffReasonWidth", "layoffReasonStale", "layoffLag"]) {
      expect(keys.some(([ns, kk]) => ns === "ghostIndex" && kk === k), `ghostIndex.${k} missing from en.json`).toBe(true);
    }
    // The numeric and date placeholders §7.6 names each live in at least one key.
    const all = keys.map(([ns, k]) => en[ns][k]).join(" ");
    for (const p of ["workers", "pct", "headcount", "eventDate", "noticeDate", "reportDate", "filedDate", "visibleDate", "lookback", "minEmployers", "maxShare", "minN", "maxHw"]) {
      expect(all, `{{${p}}} is in no English layoff key`).toContain(`{{${p}}}`);
    }
    for (const f of files) {
      const j = read(f);
      for (const [ns, k] of keys) {
        expect(typeof j[ns]?.[k], `${f} lacks ${ns}.${k}`).toBe("string");
        expect(ph(j[ns][k]), `${f} ${ns}.${k} dropped or added a placeholder`).toBe(ph(en[ns][k]));
      }
    }
  });

  it("7. the layoff surfaces are readable by grep: no source file under src/components/jobs or src/components/ghost carries a NUL byte", () => {
    // A raw NUL in a .tsx makes grep answer "no match" for the whole file
    // (project_grep_binary_trap): a grep-based check of surface isolation
    // would then miss the very component that reads the filing. The link
    // marker is written as an escape sequence for this reason.
    const dirs = ["src/components/jobs", "src/components/ghost"].map((d) => resolve(__dirname, "../..", d));
    const offenders: string[] = [];
    for (const d of dirs) {
      for (const f of readdirSync(d)) {
        if (!/\.(tsx?|mjs|js)$/.test(f)) continue;
        if (readFileSync(resolve(d, f)).includes(0)) offenders.push(`${d}/${f}`);
      }
    }
    expect(offenders).toEqual([]);
    const line = readFileSync(resolve(__dirname, "../../src/components/jobs/LayoffFilingLine.tsx"), "utf8");
    expect(line).toMatch(/const LINK_SLOT = "\\u0000";/);
    // positive control: the buffer check does see a NUL when one is there
    expect(Buffer.from("a\u0000b", "utf8").includes(0)).toBe(true);
  });
});
