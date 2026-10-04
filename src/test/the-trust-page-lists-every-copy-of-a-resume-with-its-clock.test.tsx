/**
 * THE TRUST PAGE LISTS EVERY COPY OF A RÉSUMÉ WITH ITS CLOCK -- rendered, so
 * the numbers a reader sees are the interpolated ones and never a
 * {{placeholder}} or a key. The copy-level guards are in
 * a-resume-never-rides-a-stripe-session.test.ts; this is the page itself.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import Trust from "@/pages/Trust";
import { PRIVACY_EMAIL, REPORT_CACHE_DAYS, SHARED_ANALYSIS_DAYS, TEMP_RESUME_HOURS } from "@/lib/resume-retention";

// The page's neighbours are not what this test is about, and several of them
// read the network; each renders as nothing.
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/SocialProof", () => ({ SocialProof: () => null }));
vi.mock("@/components/HowItWorks", () => ({ HowItWorks: () => null }));
vi.mock("@/components/FAQ", () => ({ FAQ: () => null }));
vi.mock("@/components/ResumeBeforeAfter", () => ({ ResumeBeforeAfter: () => null }));
vi.mock("@/hooks/use-scan-totals", () => ({ useScanTotals: () => null }));

function renderTrust() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/trust"]}>
        <Trust />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe("/trust retention table", { timeout: 30_000 }, () => {
  it("renders every store with the clock the code enforces, and no placeholder", () => {
    const { container } = renderTrust();
    const section = container.querySelector("#retention") as HTMLElement;
    expect(section, "the #retention section is missing").toBeTruthy();
    const table = within(section).getByRole("table");
    const text = table.textContent ?? "";

    expect(within(table).getAllByRole("row").length).toBe(1 + 12);
    expect(text).toContain(`${TEMP_RESUME_HOURS} hours, then deleted`);
    expect(text).toContain(`${REPORT_CACHE_DAYS} days, then deleted`);
    expect(text).toContain(`${SHARED_ANALYSIS_DAYS} days, or until you press “Delete My Data” on the results page`);
    expect(text).toContain(PRIVACY_EMAIL);
    expect(text).toContain("Stripe receives no resume text");
    expect(container.textContent).not.toMatch(/\{\{|\}\}|trustPage\./);
  });

  it("the free-scan card states both clocks", () => {
    renderTrust();
    expect(screen.getByText(new RegExp(`for ${TEMP_RESUME_HOURS} hours, so a checkout can use it.*for ${REPORT_CACHE_DAYS} days`))).toBeInTheDocument();
  });

  it("makes no categorical never-stored claim anywhere on the page", () => {
    const { container } = renderTrust();
    expect(container.textContent).not.toMatch(/never stored|zero storage|immediately discarded|in memory/i);
  });
});
