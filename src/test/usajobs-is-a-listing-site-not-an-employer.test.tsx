/**
 * USAJOBS IS A LISTING SITE, NOT AN EMPLOYER (audit CP6, plan D12).
 *
 * /jobs/company/usajobs read "Open roles at USAJOBS", "straight from USAJOBS'
 * own job board", "Work at USAJOBS? Claim this profile", and never said the
 * feed answers at most 10,000 results per query. Held here: the hub variant,
 * its H1 and the per-query cap sentence, no "own job board" copy, no claim,
 * no perks or SEC figures, and a hiring record that prints only the
 * tracking-floor reason.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(async () => ({ data: null, error: null })) } }));

import { buildLanderModel, USAJOBS_RESULT_CAP, type LanderInput } from "@/lib/company/lander-model";
import { CompanyLanderHeader } from "@/components/jobs/company/CompanyLander";
import { HiringRecordCard, type HiringRecordInput } from "@/components/jobs/company/HiringRecordCard";

const QUICK = { timeout: 3000 } as const;
const input = (o: Partial<LanderInput> = {}): LanderInput => ({
  token: "usajobs", storedName: "USAJOBS", bakedName: null, cachedName: null,
  listTotal: 9303, listFloor: false, feedTotal: 9303, feedFloor: true, feedAsOf: null,
  boardReadAt: new Date(Date.now() - 20 * 60_000).toISOString(), source: "usajobs", agency: false, collision: null, isUsajobs: true,
  loading: false, error: false, budgetRefusal: false, gated: { verdict: "unknown", withheld: "tracking" },
  verdict: "unknown", growth: "unknown", layoffRows: 0, visitorFilters: [], ...o,
});

describe("the USAJOBS hub", () => {
  it("is its own variant and shows no employer-only section", () => {
    const m = buildLanderModel(input());
    expect(m.variant).toBe("usajobs");
    expect(m.sections.claim).toBe(false);
    expect(m.sections.perks).toBe(false);
    expect(m.sections.sec).toBe(false);
    expect(m.sections.hiringRecordFloorOnly).toBe(true);
    expect(m.sections.mixAsListings).toBe(true);
    expect(USAJOBS_RESULT_CAP).toBe(10_000);
  });

  it("says what it is, states the per-query cap, and offers no claim and no 'own job board'", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CompanyLanderHeader model={buildLanderModel(input())} token="usajobs" labelOf={() => "USAJOBS"} source="usajobs" boardReadAt={null} onWatch={() => {}} onShowOnly={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Federal openings listed on USAJOBS");
    expect(screen.getByText("Up to 10,000 results per query; not every federal opening.")).toBeInTheDocument();
    expect(document.querySelector("[data-company-answer]")?.textContent).toMatch(/^9,303 open roles/);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/own job board|own careers system|Open roles at USAJOBS|Work at USAJOBS/);
    await user.click(screen.getByRole("button", { name: "More actions for USAJOBS" }));
    expect(await screen.findByRole("menuitem", { name: "Copy link" }, QUICK)).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /claim/i })).toBeNull();
  });

  it("its hiring record prints only the tracking-floor reason", () => {
    const rec: HiringRecordInput = {
      curve: { open_roles: 9303, filled_roles_90d: 120, relisted_roles_90d: 30, tracking_days: 10, observability_bucket: "full_read", sufficient: true, dated_coverage: 0.9 },
      gated: { verdict: "unknown", withheld: "tracking" }, actively: "unknown", admitted: null, relistCaution: false,
      growth: { verdict: "unknown", row: null, why: "we set this board aside ourselves" },
      bars: { growthMinRatePct: 25, growthWindowDays: 7, closedWindowDays: 90, shareDays: 14, supportDays: 30 },
    };
    const { container } = render(<HiringRecordCard input={rec} floorOnly />);
    expect(container.querySelectorAll("[data-hh-gate]")).toHaveLength(1);
    expect(container.querySelector("[data-hh-gate]")?.getAttribute("data-hh-gate")).toBe("tracking");
    expect(container.textContent).toContain("We have watched this board for 10 days");
    expect(container.textContent).not.toMatch(/how fast roles come down|posting rate/i);
    expect(container.textContent).toContain("No reliable hiring signal yet");
  });
});
