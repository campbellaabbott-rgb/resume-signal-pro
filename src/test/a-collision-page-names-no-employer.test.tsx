/**
 * A BOARD NAME TWO HIRING SYSTEMS SHARE NAMES NO EMPLOYER (audit CP2, CP12).
 *
 * With the collision notice in place, /jobs/company/clear still read "Open
 * roles at Clear", "straight from Clear's own job board" and "Watch Clear",
 * and the notice printed "open roles now: 0" for a board the count did not
 * name. Held here, by rendering: a neutral H1 about the name; each board by
 * its catalogue name and hiring system with its count now, or "count not
 * available" (never 0); a "Show only these N roles" button that hands the
 * page the board's source; no possessive, no "own job board", no claim; and
 * the composed page asks no employer-level reader about the token.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: vi.fn(async () => ({ data: {} })) } },
}));

import { collidedBoards } from "@/lib/board-collisions";
import { buildLanderModel, type LanderInput } from "@/lib/company/lander-model";
import { CollisionHeader } from "@/components/jobs/company/CollisionHeader";
import { CompanyLander } from "@/components/jobs/company/CompanyLander";
import { BoardCollisionNotice } from "@/components/jobs/BoardCollisionNotice";

const QUICK = { timeout: 3000 } as const;
const LABEL: Record<string, string> = { bamboohr: "BambooHR", greenhouse: "Greenhouse" };
const labelOf = (s: string) => LABEL[s] ?? null;
const boards = collidedBoards("clear")!;
const INTEL = { employees: 4321, employee_basis: "public_records", median_usd_floor: 123456, usd_n: 40, categories: [], countries: [], net_7d: 3, open_by_source: [{ source: "bamboohr", open_roles: 3 }] };
const EMPLOYER_LEVEL = ["get_company_financials", "get_similar_companies", "get_company_claim_status", "get_employer_layoff_filings_all", "get_employer_perks", "get_employer_lca_wages", "get_company_hiring_health"];

const input = (o: Partial<LanderInput> = {}): LanderInput => ({
  token: "clear", storedName: "Clear", bakedName: null, cachedName: null,
  listTotal: 5, listFloor: false, feedTotal: null, feedFloor: false, feedAsOf: null,
  boardReadAt: new Date().toISOString(), source: null, agency: false, collision: boards, isUsajobs: false,
  loading: false, error: false, budgetRefusal: false, gated: { verdict: "closes", withheld: null },
  verdict: "positive", growth: "grew", layoffRows: 2, visitorFilters: [], ...o,
});

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string) => (fn === "get_company_intel" ? { data: INTEL, error: null } : { data: null, error: null }));
});

describe("the collision header", () => {
  it("names the board name, never an employer, and each board by its own name, system and count", async () => {
    const onShowOnly = vi.fn();
    render(<MemoryRouter><CollisionHeader token="clear" boards={boards} labelOf={labelOf} onShowOnly={onShowOnly} onWatch={() => {}} /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Open roles on boards named “clear”");
    expect(screen.getByText(/2 hiring systems carry a board with this name/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("BambooHR board · 3 open roles now")).toBeInTheDocument(), QUICK);
    // The board the count does not name: no number, and never a zero.
    expect(screen.getByText("Greenhouse board · count not available")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b0 open roles|open roles now: 0/);
    // Catalogue names, verbatim.
    expect(screen.getByText("Clear")).toBeInTheDocument();
    expect(screen.getByText("CLEAR - Corporate")).toBeInTheDocument();
    // The buttons hand the page each board's source.
    fireEvent.click(screen.getByRole("button", { name: "Show only these 3 roles" }));
    expect(onShowOnly).toHaveBeenLastCalledWith("bamboohr");
    fireEvent.click(screen.getByRole("button", { name: "Show only this board's roles" }));
    expect(onShowOnly).toHaveBeenLastCalledWith("greenhouse");
    // No sentence that claims one employer.
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Clear['’]s|own job board|own careers system|own hiring system/);
    expect(screen.getByRole("button", { name: "Watch boards named “clear”" })).toBeInTheDocument();
  });

  it("offers no claim in its menu", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CollisionHeader token="clear" boards={boards} labelOf={labelOf} onShowOnly={() => {}} onWatch={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "More actions for clear" }));
    expect(await screen.findByRole("menuitem", { name: "Copy link" }, QUICK)).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /claim/i })).toBeNull();
  });
});

describe("the model of a shared board name", () => {
  it("is the collision variant whatever the verdict, and lets no employer-level section render", () => {
    const m = buildLanderModel(input());
    expect(m.variant).toBe("collision");
    expect(m.boards.map((b) => b.source)).toEqual(["bamboohr", "greenhouse"]);
    const s = m.sections;
    expect([s.hiringRecord, s.perks, s.pay, s.mix, s.publicRecords, s.sec, s.claim, s.similar, s.howApplying, s.employerChip]).toEqual(Array(10).fill(false));
  });

  it("the composed page asks no employer-level reader about the token", async () => {
    render(
      <MemoryRouter>
        <CompanyLander
          model={buildLanderModel(input())} token="clear" labelOf={labelOf} source={null}
          boardReadAt={null} onWatch={() => {}} onShowOnly={() => {}}
          record={null} layoffRows={[]} cards={[<div key="1">Platform Engineer 1</div>]}
        />
      </MemoryRouter>,
    );
    // The boards print in the header for phones and in the desktop column, from one read.
    await waitFor(() => expect(screen.getAllByText("BambooHR board · 3 open roles now")).toHaveLength(2), QUICK);
    expect(document.querySelector("[data-collision-panel]")).not.toBeNull();
    const asked = rpc.mock.calls.map(([fn]) => fn as string);
    expect(asked.filter((fn) => EMPLOYER_LEVEL.includes(fn))).toEqual([]);
    // The intel reader is asked once, though the header reads it.
    expect(asked.filter((fn) => fn === "get_company_intel")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/About this employer|Hiring record|Public records|123,456|4,321/);
  });
});

describe("the notice the lander still mounts", () => {
  it("prints 'count not available' for a board the count does not name, never 'open roles now: 0'", async () => {
    render(<BoardCollisionNotice companyToken="clear" boards={boards} labelOf={labelOf} />);
    await waitFor(() => expect(screen.getByText(/open roles now: 3/)).toBeInTheDocument(), QUICK);
    expect(screen.getByText(/count not available/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/open roles now: 0/);
  });
});
