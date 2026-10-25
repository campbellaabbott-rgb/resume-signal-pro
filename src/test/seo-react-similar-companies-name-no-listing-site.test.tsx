/**
 * "ALSO HIRING IN …" LISTS EMPLOYERS, NOT A LISTING SITE (S13-120).
 *
 * Live 2026-10-17, get_similar_companies('bayada') and ('centriaautism')
 * returned ('usajobs', 'Veterans Health Administration', 3061) as the second
 * row, and SimilarCompanies printed it — the whole federal feed named after
 * one agency, linking the USAJOBS hub — under "Companies with live openings
 * in the same field, from their own career systems". A board name two hiring
 * systems share is not one employer either. Migration 20261012136000 drops
 * both on the server; the page drops them as well, whatever the reader returns.
 */
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BOARD_COLLISION_ROWS } from "@/lib/board-collisions";

const ROWS = [
  { company: "CVS Health", company_token: "cvshealth~wd1~CVS_Health_Careers", open_roles: 900, employees: null, employee_basis: null, category: "healthcare" },
  { company: "Veterans Health Administration", company_token: "usajobs", open_roles: 3061, employees: null, employee_basis: null, category: "healthcare" },
];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async () => ({ data: ROWS }) },
}));

import { SimilarCompanies, similarRowShown } from "@/components/jobs/SimilarCompanies";

describe("the similar-employers list", () => {
  it("never shows the federal listing site or a shared board name", () => {
    const collided = BOARD_COLLISION_ROWS[0][0];
    expect(similarRowShown({ ...ROWS[1] })).toBe(false);
    expect(similarRowShown({ ...ROWS[0], company_token: collided })).toBe(false);
    expect(similarRowShown(ROWS[0])).toBe(true);
  });

  it("renders the employer and drops the agency-named federal feed", async () => {
    render(<MemoryRouter><SimilarCompanies companyToken="bayada" /></MemoryRouter>);
    await waitFor(() => expect(document.body.textContent).toMatch(/CVS Health/));
    expect(document.body.textContent).not.toMatch(/Veterans Health Administration/);
    expect([...document.querySelectorAll("a")].map((a) => a.getAttribute("href")).some((h) => /usajobs/.test(h ?? ""))).toBe(false);
  });
});
