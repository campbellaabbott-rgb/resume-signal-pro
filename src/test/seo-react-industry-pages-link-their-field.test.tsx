/**
 * EVERY INDUSTRY PAGE WHOSE FIELD THE BOARD HAS LINKS IT (S13-132).
 *
 * INDUSTRY_TO_CATEGORY was keyed by seven industry slugs the scanner never
 * detects, so they could never fire, and /industries/hr, /customer_success,
 * /administrative and /creative rendered without "See live … openings on the
 * job board" although the people_hr, customer, admin and design fields exist
 * (Googlebot GETs 2026-10-17: zero jobs/field/ links on those pages).
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { BOARD_CATEGORY_SLUGS, INDUSTRY_TO_CATEGORY } from "@/lib/job-board-categories";
import IndustryKeywords from "@/pages/IndustryKeywords";

describe("the industry-to-field map", () => {
  it("is keyed only by slugs the scanner detects, and points only at real board fields", () => {
    const slugs = Object.keys(INDUSTRY_KEYWORDS);
    expect(Object.keys(INDUSTRY_TO_CATEGORY).filter((k) => !slugs.includes(k)), "dead keys").toEqual([]);
    for (const v of Object.values(INDUSTRY_TO_CATEGORY)) expect(BOARD_CATEGORY_SLUGS).toContain(v);
  });

  it("maps the four industries that had no link", () => {
    expect(INDUSTRY_TO_CATEGORY.hr).toBe("people_hr");
    expect(INDUSTRY_TO_CATEGORY.customer_success).toBe("customer");
    expect(INDUSTRY_TO_CATEGORY.administrative).toBe("admin");
    expect(INDUSTRY_TO_CATEGORY.creative).toBe("design");
  });

  it.each([["hr", "people_hr"], ["customer_success", "customer"], ["administrative", "admin"], ["creative", "design"]])(
    "/industries/%s renders the link to /jobs/field/%s",
    (slug, field) => {
      render(
        <HelmetProvider>
          <MemoryRouter initialEntries={[`/industries/${slug}`]}>
            <Routes><Route path="/industries/:slug" element={<IndustryKeywords />} /></Routes>
          </MemoryRouter>
        </HelmetProvider>,
      );
      const hrefs = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
      expect(hrefs).toContain(`/jobs/field/${field}`);
    },
  );
});
