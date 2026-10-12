/**
 * AN EMPTY COMPANY PAGE OFFERS A WAY OUT (audit CP13).
 *
 * /jobs/company/blackstone (0 open roles) printed "No verified openings match
 * all of that -- Loosening one filter helps: Remove Blackstone" though the
 * visitor had set no filter, beside a pane saying "Select a posting" with
 * nothing to select, and listed no similar employers. Held here:
 *   - a carried board with no open roles is the zero variant: the board's own
 *     read time, Watch, three similar employers, and no filter copy;
 *   - a visitor's filter that empties the list is NOT the zero variant;
 *   - a token we do not carry says so, with a search and the directory link,
 *     and only when the page knows it is not carried (unknown is never
 *     "uncarried");
 *   - an empty board is not "Actively hiring", whatever the 90-day verdict
 *     says (the verdict reads fills and relists only; the legacy lander's
 *     chip needed open_roles > 0), and it carries no "Live jobs straight
 *     from X's own hiring system" subtitle (honesty review of 3ebdcbb2: the
 *     zero header read "No open roles right now · … · Actively hiring").
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(async () => ({ data: null, error: null })) } }));

import { buildLanderModel, type LanderInput } from "@/lib/company/lander-model";
import { CompanyEmptyState } from "@/components/jobs/company/CompanyEmptyState";
import { CompanyLanderHeader } from "@/components/jobs/company/CompanyLander";
import type { SimilarRow } from "@/components/jobs/SimilarCompanies";

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const input = (o: Partial<LanderInput> = {}): LanderInput => ({
  token: "blackstone", storedName: "Blackstone", bakedName: null, cachedName: null,
  listTotal: 0, listFloor: false, feedTotal: 0, feedFloor: false, feedAsOf: null,
  boardReadAt: minsAgo(46), source: "workday", agency: false, collision: null, isUsajobs: false,
  loading: false, error: false, budgetRefusal: false, gated: { verdict: "unknown", withheld: null },
  verdict: "unknown", growth: "unknown", layoffRows: 0, visitorFilters: [], ...o,
});
const sim = (i: number): SimilarRow => ({ company: `Peer ${i}`, company_token: `peer${i}`, open_roles: 10 + i, employees: null, employee_basis: null, category: "finance" });
const FILTER_COPY = /narrow set of filters|Loosening one filter|Remove Blackstone|match all of that|Select a posting/i;

function Where() {
  const loc = useLocation();
  return <p data-where={`${loc.pathname}${loc.search}`} />;
}

describe("a carried board with no open roles", () => {
  it("is the zero variant, and the header answers with the board's read time", () => {
    const m = buildLanderModel(input());
    expect(m.variant).toBe("zero");
    render(<MemoryRouter><CompanyLanderHeader model={m} token="blackstone" labelOf={() => "Workday"} source="workday" boardReadAt={minsAgo(46)} onWatch={() => {}} onShowOnly={() => {}} /></MemoryRouter>);
    expect(document.querySelector("[data-company-answer]")?.textContent).toBe("No roles dated in the last 30 days · board read 46 min ago");
  });

  it("says so with the read time, offers Watch and three similar employers, and never uses filter copy", () => {
    const onWatch = vi.fn();
    const m = buildLanderModel(input());
    render(<MemoryRouter><CompanyEmptyState model={m} token="blackstone" boardReadAt={minsAgo(46)} similar={[1, 2, 3, 4, 5].map(sim)} onWatch={onWatch} /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 2, name: "No roles at Blackstone dated in the last 30 days" })).toBeInTheDocument();
    expect(screen.getByText("board read 46 min ago")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Watch Blackstone" }));
    expect(onWatch).toHaveBeenCalledTimes(1);
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links.filter((h) => h?.startsWith("/jobs/company/peer"))).toHaveLength(3);
    expect(links).toContain("/jobs");
    expect(document.body.textContent).not.toMatch(FILTER_COPY);
  });

  it("a visitor's filter that empties the list is a filter result, not an empty board", () => {
    const m = buildLanderModel(input({ visitorFilters: ["q"] }));
    expect(m.variant).toBe("standard");
    expect(m.visitorFiltered).toBe(true);
    expect(buildLanderModel(input()).visitorFiltered).toBe(false);
  });

  it("a description-only match is not an empty board either", () => {
    expect(buildLanderModel(input({ relatedTotal: 1314 })).variant).toBe("standard");
  });

  it("is never 'Actively hiring' and promises no live jobs, even with a positive 90-day verdict", () => {
    const m = buildLanderModel(input({ verdict: "positive", gated: { verdict: "closes", withheld: null } }));
    expect(m.variant).toBe("zero");
    expect(m.sections.employerChip).toBe(false);
    render(<MemoryRouter><CompanyLanderHeader model={m} token="blackstone" labelOf={() => "Workday"} source="workday" boardReadAt={minsAgo(46)} onWatch={() => {}} onShowOnly={() => {}} /></MemoryRouter>);
    const header = document.querySelector("[data-company-header]")?.textContent ?? "";
    expect(header).toContain("No roles dated in the last 30 days");
    expect(header).not.toMatch(/Actively hiring/);
    expect(header).not.toMatch(/Live jobs straight from/);
    expect(document.querySelector("[data-employer-chip]")).toBeNull();
  });

  it("positive control: a board with open roles and the same verdict shows the chip and the subtitle", () => {
    const m = buildLanderModel(input({ listTotal: 847, feedTotal: 847, verdict: "positive", gated: { verdict: "closes", withheld: null } }));
    expect(m.variant).toBe("standard");
    expect(m.sections.employerChip).toBe(true);
    render(<MemoryRouter><CompanyLanderHeader model={m} token="blackstone" labelOf={() => "Workday"} source="workday" boardReadAt={minsAgo(46)} onWatch={() => {}} onShowOnly={() => {}} /></MemoryRouter>);
    expect(document.querySelector("[data-employer-chip]")?.textContent).toBe("Actively hiring");
    expect(document.querySelector("[data-company-header]")?.textContent).toContain("Live jobs straight from Blackstone's own hiring system.");
  });

  it("an agency board or a board past every gate but with a zero figure never gets the chip", () => {
    expect(buildLanderModel(input({ listTotal: 847, agency: true, verdict: "positive" })).sections.employerChip).toBe(false);
    expect(buildLanderModel(input({ listTotal: null, loading: true, feedTotal: 0, verdict: "positive" })).sections.employerChip).toBe(false);
  });
});

describe("a token we do not carry", () => {
  it("is uncarried only when the page knows it is not carried", () => {
    expect(buildLanderModel(input({ carried: false })).variant).toBe("uncarried");
    expect(buildLanderModel(input({ carried: null })).variant).toBe("zero");
    expect(buildLanderModel(input({ carried: undefined })).variant).toBe("zero");
  });

  it("says so in the H1, and offers a search of the live board and the directory", () => {
    const m = buildLanderModel(input({ token: "notacarriedcompany-xyz", storedName: null, carried: false }));
    render(
      <MemoryRouter initialEntries={["/jobs/company/notacarriedcompany-xyz"]}>
        <Routes>
          <Route path="*" element={<>
            <CompanyLanderHeader model={m} token="notacarriedcompany-xyz" labelOf={() => null} source={null} boardReadAt={null} onWatch={() => {}} onShowOnly={() => {}} />
            <CompanyEmptyState model={m} token="notacarriedcompany-xyz" boardReadAt={null} />
            <Where />
          </>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("We don't read a board called “notacarriedcompany-xyz” yet");
    expect(screen.getByRole("link", { name: "Browse the companies we read" })).toHaveAttribute("href", "/companies");
    const box = screen.getByRole("searchbox", { name: "Search jobs" });
    fireEvent.change(box, { target: { value: "Acme Corp" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(document.querySelector("[data-where]")?.getAttribute("data-where")).toBe("/jobs?q=Acme%20Corp");
    expect(document.body.textContent).not.toMatch(FILTER_COPY);
    expect(m.sections.claim).toBe(false);
  });
});
