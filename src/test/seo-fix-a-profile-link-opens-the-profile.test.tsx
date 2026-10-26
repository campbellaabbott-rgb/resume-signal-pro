/**
 * A LINK LABELLED AS THE EMPLOYER'S PROFILE OPENS THE PROFILE (the round's
 * review, 2026-10-24). SEO-010 sent every employer link to
 * /jobs?company=<token> unless /landers.json named a page, and it names about
 * 500 of some 31,800 boards: "Full Snowflake hiring profile" opened the
 * generic board (h1 "Live job board", no hiring record), and so did "+3 more
 * on the employer page". A board with no written page now keeps its profile
 * address with rel="nofollow", so people reach the profile and crawlers are
 * asked to follow only written pages.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { companyProfileLink, setLanderManifestForTests } from "@/lib/seo/lander-manifest";

vi.mock("@/lib/employer-context", async (orig) => ({
  ...(await orig<typeof import("@/lib/employer-context")>()),
  getEmployerCtx: async () => ({ ticker: "SNOW", exchange: "NYSE", revenue: 3_400_000_000, currency: "USD", fyYear: 2025, netIncome: -1, h1bTotal: null, h1bMedian: null, h1bRoles: [], h1bFy: null, employees: null, employeeBasis: null, employeesAsOf: null }),
}));
vi.mock("@/lib/track-transport", () => ({ postTrackEvent: () => {}, getVisitorId: () => "v" }));

import { EmployerContext } from "@/components/jobs/EmployerContext";

const ROOT = resolve(__dirname, "../..");
afterEach(() => { cleanup(); setLanderManifestForTests(null); });

describe("companyProfileLink", () => {
  it("is the written page when the manifest names one, and the profile address with nofollow otherwise", () => {
    expect(companyProfileLink("snowflake")).toEqual({ href: "/jobs/company/snowflake", rel: "nofollow" });
    setLanderManifestForTests({ dominos: "dominos", clear: null });
    expect(companyProfileLink("dominos")).toEqual({ href: "/jobs/company/dominos" });
    expect(companyProfileLink("clear")).toEqual({ href: "/jobs/company/clear", rel: "nofollow" });
    expect(companyProfileLink("davidlloyd~wd3~101")).toEqual({ href: "/jobs/company/davidlloyd~wd3~101", rel: "nofollow" });
    expect(companyProfileLink("careers.amd.com")).toEqual({ href: "/jobs/company/careers.amd.com/", rel: "nofollow" });
  });
});

describe("the link labelled as the hiring profile", () => {
  it("never opens /jobs?company=", async () => {
    render(<MemoryRouter><EmployerContext companyToken="snowflake" source="workday" companyName="Snowflake" postingTitle="Engineer" /></MemoryRouter>);
    const link = await waitFor(() => screen.getByRole("link", { name: /Full Snowflake hiring profile/ }), { timeout: 3000 });
    expect(link.getAttribute("href")).toBe("/jobs/company/snowflake");
    expect(link.getAttribute("rel")).toBe("nofollow");
  });

  it("is built from the profile link wherever a label promises the profile", () => {
    for (const f of ["src/components/jobs/EmployerContext.tsx", "src/components/jobs/LayoffFilingLine.tsx", "src/components/jobs/listing/PostingHeader.tsx", "src/components/jobs/listing/JobCard.tsx", "src/components/jobs/SimilarCompanies.tsx", "src/pages/JobPosting.tsx"]) {
      const code = readFileSync(resolve(ROOT, f), "utf8");
      expect(code, f).toMatch(/useCompanyProfileLink\(\)/);
      expect(code, f).not.toMatch(/useCompanyBoardHref\(\)/);
    }
  });
});
