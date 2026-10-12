/**
 * A STAFFING AGENCY'S BOARD SAYS WHOSE ROLES THESE ARE (audit CP14).
 *
 * /jobs/company/remote-recruitment tagged every card "Staffing agency" while
 * its header said "straight from Remote Recruitment's own job board", "hires
 * mostly in Finance & Accounting", "Filled 42 roles" and offered a claim.
 * Held here: the agency variant carries the banner as its one status
 * element, never the "Actively hiring" chip, and the page drops the hiring
 * record, perks, the claim and SEC figures; the hiring mix is titled "Roles
 * listed mostly in".
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(async () => ({ data: null, error: null })) } }));

import { buildLanderModel, type LanderInput } from "@/lib/company/lander-model";
import { CompanyHeader } from "@/components/jobs/company/CompanyHeader";
import { AboutEmployerRail } from "@/components/jobs/company/AboutEmployer";
import { HiringMix } from "@/components/jobs/company/HiringMix";
import type { HiringRecordInput } from "@/components/jobs/company/HiringRecordCard";

const QUICK = { timeout: 3000 } as const;
const input = (o: Partial<LanderInput> = {}): LanderInput => ({
  token: "remote-recruitment", storedName: "Remote Recruitment", bakedName: null, cachedName: null,
  listTotal: 30, listFloor: false, feedTotal: 30, feedFloor: false, feedAsOf: null,
  boardReadAt: null, source: "workable", agency: true, collision: null, isUsajobs: false,
  loading: false, error: false, budgetRefusal: false, gated: { verdict: "closes", withheld: null },
  verdict: "positive", growth: "grew", layoffRows: 0, visitorFilters: [], ...o,
});
const RECORD: HiringRecordInput = {
  curve: { open_roles: 30, filled_roles_90d: 42, relisted_roles_90d: 3, tracking_days: 60, observability_bucket: "full_read", sufficient: true, dated_coverage: 0.9 },
  gated: { verdict: "closes", withheld: null }, actively: "positive", admitted: "closes", relistCaution: false,
  growth: { verdict: "grew", row: null, why: null },
  bars: { growthMinRatePct: 25, growthWindowDays: 7, closedWindowDays: 90, shareDays: 14, supportDays: 30 },
};

describe("an agency's board", () => {
  it("drops every employer-language section, even with a positive verdict", () => {
    const m = buildLanderModel(input());
    expect(m.variant).toBe("agency");
    const s = m.sections;
    expect({ record: s.hiringRecord, perks: s.perks, claim: s.claim, sec: s.sec, chip: s.employerChip }).toEqual({ record: false, perks: false, claim: false, sec: false, chip: false });
    expect(s.mixAsListings).toBe(true);
    // Sourced public records may still print: a filing is the agency's own.
    expect(s.publicRecords).toBe(true);
  });

  it("carries the banner as its status, no 'Actively hiring' chip, and no claim", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CompanyHeader model={buildLanderModel(input())} token="remote-recruitment" system="Workable" boardReadAt={null} onWatch={() => {}} /></MemoryRouter>);
    expect(screen.getByRole("note").textContent).toBe("This is a staffing agency's board. Roles here are usually for its clients.");
    expect(document.querySelector("[data-employer-chip]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Actively hiring|Filled|hires mostly in/);
    await user.click(screen.getByRole("button", { name: "More actions for Remote Recruitment" }));
    expect(await screen.findByRole("menuitem", { name: "Copy link" }, QUICK)).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /claim/i })).toBeNull();
  });

  it("prints no hiring record in the profile even when the page hands one over", () => {
    const m = buildLanderModel(input());
    const { container } = render(
      <MemoryRouter>
        <AboutEmployerRail
          model={m} token="remote-recruitment" record={RECORD} layoffRows={[]}
          profile={{ intel: { intel: null, loading: false, readAt: null }, perks: null, financials: null, lca: null, similar: [] }}
        />
      </MemoryRouter>,
    );
    expect(container.textContent).not.toMatch(/Hiring record|taken down|Perks stated/);
  });

  it("titles the mix 'Roles listed mostly in', never 'hires mostly in'", () => {
    render(<HiringMix asListings facts={{ fields: [{ category: "finance", n: 12 }, { category: "operations", n: 8 }], countries: [{ country: "GB", n: 20 }], asOf: null }} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Roles listed mostly in");
    expect(document.body.textContent).not.toMatch(/hires mostly in/i);
  });
});
