// A NET-NEW FIGURE SAT BESIDE THE GROWTH LINE THAT REFUSED TO READ ONE.
//
// The company lander's intel strip printed "+N net-new roles this week" from
// get_company_intel.net_7d -- a difference of raw stored-row counts across a
// week of snapshots with no read-quality, size or tenure gate -- directly above
// the Hiring Health card, whose growth line (get_company_growth) refuses to
// read a rate on exactly those boards: careers.orlandohealth.com showed "+52
// net-new roles this week" beside "No posting rate yet: windowed read"
// (register L11-03). The strip no longer prints it; the card is the one place
// a board's growth is read, on its gates.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

import { CompanyIntelPanel } from "../components/jobs/CompanyIntelPanel";

const INTEL = {
  employees: 24000, employee_basis: "public_records", yc_batch: null,
  median_usd_floor: 65000, usd_n: 40,
  categories: [{ category: "healthcare", n: 900 }], countries: [{ country: "US", n: 1200 }],
  net_7d: 52,
};

beforeEach(() => { rpc.mockReset(); });

describe("the company intel strip", () => {
  it("prints no net-new count, while the rest of the strip still renders", async () => {
    rpc.mockResolvedValue({ data: INTEL });
    render(<CompanyIntelPanel companyToken="careers.orlandohealth.com" />);
    await waitFor(() => expect(document.body.textContent).toContain("24,000"));
    expect(document.body.textContent).not.toMatch(/net-new/i);
    expect(document.body.textContent).not.toMatch(/\+52\b/);
  });
});
