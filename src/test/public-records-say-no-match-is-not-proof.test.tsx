/**
 * PUBLIC RECORDS SAY "NO MATCH IS NOT PROOF", AND PRINT EACH FILING AS A FILING
 * (audit CP18, plan D6).
 *
 * Layoff filings sat inside the Hiring Health card, between a closure count
 * and the fourteen-day share, with "2026-09-03" beside "last read 9/18/2026,
 * 4:49:41 PM". Held here: the Public records section leads with "No match in
 * these records is not proof of anything."; each filing is one compact row
 * with the filer as the source spells it, the state and count a notice
 * states, the day it was filed in the reader's language and its source link;
 * filed H-1B wages print only when the reader returns a row; the section
 * renders nothing when no record has a row; and the detail pane's sentence
 * carries localized dates too.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(async () => ({ data: null })) } }));

import { readLayoffRow, layoffLineText } from "@/components/jobs/LayoffFilingLine";
import { readLcaRow } from "@/components/jobs/LcaFiledWagesLine";
import { PublicRecords, publicRecordsRender } from "@/components/jobs/company/PublicRecords";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const WARN = readLayoffRow({
  la_company_token: "acme", la_source: "state_warn", la_relation: "filer", la_filer: "ACME LOGISTICS LLC",
  la_event_date: "2026-09-10", la_event_basis: "warn_notice_date", la_public_date: "2026-09-12", la_public_basis: "state_received",
  la_state: "CA", la_site: "Fremont", la_workers: 120, la_event_type: "layoff", la_effective_date: "2026-11-09", la_pct: null, la_headcount: null,
  la_form: null, la_source_url: "https://edd.ca.gov/en/jobs_and_training/Layoff_Services_WARN/", la_source_name: "California EDD",
  la_read_at: hoursAgo(3), la_total_n: 2,
}, "la")!;
const SEC = readLayoffRow({
  la_company_token: "acme", la_source: "sec_8k_205", la_relation: "filer", la_filer: "Acme Holdings, Inc.",
  la_event_date: "2026-08-20", la_event_basis: "sec_report_date", la_public_date: "2026-08-22", la_public_basis: "sec_filed",
  la_state: null, la_site: null, la_workers: null, la_event_type: null, la_effective_date: null, la_pct: 12.5, la_headcount: null,
  la_form: "8-K", la_source_url: "https://www.sec.gov/Archives/edgar/data/1/x/acme-8k.htm", la_source_name: "SEC EDGAR",
  la_read_at: hoursAgo(1), la_total_n: 2,
}, "la")!;
const LCA = readLcaRow({
  ow_company_token: "acme", ow_employer_filings_n: 40, ow_employer_cells_n: 6, ow_fiscal_quarter: "FY2026 Q3",
  ow_source_file: "LCA_Disclosure_Data_FY2026_Q3.xlsx", ow_source_url: "https://www.dol.gov/agencies/eta/foreign-labor/performance",
  ow_published_on: "2026-08-25", ow_soc_code: "15-1252", ow_soc_title: "Software Developers", ow_worksite_state: "CA",
  ow_wage_low: 120000, ow_wage_high: 180000, ow_wage_median: 150000, ow_filings_n: 12, ow_match_basis: "employer_top",
});

describe("the public records section", () => {
  it("leads with the no-proof line, then one compact row per filing with a localized date and its source link", () => {
    const { container } = render(<MemoryRouter><PublicRecords data={{ layoffRows: [WARN, SEC], financials: null, lca: null }} companyName="Acme" showSec /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 2, name: "Public records" })).toBeInTheDocument();
    const first = container.querySelector("[data-public-records] p");
    expect(first?.textContent).toBe("No match in these records is not proof of anything.");
    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-layoff-filing='records'] > li"));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("ACME LOGISTICS LLC · WARN notice · California · 120 workers · filed Sep 10, 2026 · California EDD");
    expect(rows[1].textContent).toContain("Acme Holdings, Inc. · SEC 8-K Item 2.05 · filed Aug 22, 2026 · SEC filing");
    expect(rows[0].querySelector("a")?.getAttribute("href")).toBe(WARN.sourceUrl);
    expect(rows[1].querySelector("a")?.getAttribute("href")).toBe(SEC.sourceUrl);
    // One date format: no raw ISO day, no US-locale clock beside it.
    expect(container.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/);
    // No sentence about an absence, and no verdict word.
    expect(container.textContent).not.toMatch(/no filings|no layoffs|does not sponsor|ghost|fake/i);
  });

  it("filed H-1B wages print only when the reader returns a row, with the row's quarter, file and date", () => {
    const without = render(<MemoryRouter><PublicRecords data={{ layoffRows: [WARN], financials: null, lca: null }} companyName="Acme" showSec /></MemoryRouter>);
    expect(without.container.querySelector("[data-lca-context]")).toBeNull();
    without.unmount();
    const withRow = render(<MemoryRouter><PublicRecords data={{ layoffRows: [], financials: null, lca: LCA }} companyName="Acme" showSec /></MemoryRouter>);
    const box = withRow.container.querySelector("[data-lca-context='employer']");
    expect(box?.textContent).toContain("Filed H-1B wages · FY2026 Q3");
    expect(box?.textContent).toContain("LCA_Disclosure_Data_FY2026_Q3.xlsx, published 2026-08-25");
    expect(box?.textContent).toContain("Software Developers");
  });

  it("renders nothing when no record has a row, and nothing for a record the variant may not show", () => {
    expect(render(<MemoryRouter><PublicRecords data={{ layoffRows: [], financials: null, lca: null }} companyName="Acme" showSec /></MemoryRouter>).container).toBeEmptyDOMElement();
    expect(publicRecordsRender({ layoffRows: [], financials: null, lca: LCA }, { sec: true, lca: false })).toBe(false);
    expect(publicRecordsRender({ layoffRows: [WARN], financials: null, lca: null }, { sec: false, lca: false })).toBe(true);
  });
});

describe("the detail pane's filing sentence", () => {
  it("prints the filing's own dates in the reader's language", () => {
    const t = (_k: string, d: string, o?: Record<string, unknown>) => d.replace(/\{\{(\w+)\}\}/g, (_, k) => String(o?.[k] ?? ""));
    const en = layoffLineText(WARN, t, "en").text;
    expect(en).toContain("dated Sep 10, 2026: 120 positions at Fremont, effective Nov 9, 2026");
    expect(en).toContain("listed by California EDD on Sep 12, 2026");
    const de = layoffLineText(WARN, t, "de").text;
    expect(de).toMatch(/dated 10\. Sept?\. 2026/);
    expect(de).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const sec = layoffLineText(SEC, t, "en").text;
    expect(sec).toContain("dated Aug 20, 2026, filed with the SEC on Aug 22, 2026");
  });
});
