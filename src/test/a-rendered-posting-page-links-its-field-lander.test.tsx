// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * A RENDERED POSTING PAGE LINKS ITS FIELD PAGE (CONTENT-N2, SEO audit
 * 2026-11-18b).
 *
 * The seventeen field pages (/jobs/field/<slug>) were linked from about 20 of
 * 1,370 pages, and from none of the posting pages, though every posting the
 * board serves carries one field. The page React draws for a live posting
 * now says "More <Field> jobs" and links that field's page, under the board's
 * own name for the field (jobsPage.categories). A posting in "other" (the
 * bucket no rule sorted, which has no page) or in a field the board does not
 * know links no field page at all, and a retracted posting prints none.
 *
 * On f1ea5e353 the live design posting renders no /jobs/field/ link.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";
import i18n from "@/i18n";
import enListing from "@/i18n/shards/listing/en.json";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    rpc: async () => ({ data: [] }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import JobPosting from "@/pages/JobPosting";
import type { PostingRow } from "@/components/jobs/posting-page";
import { BOARD_CATEGORY_SLUGS } from "@/lib/job-board-categories";

const PATH = "/jobs/posting/greenhouse/acme/4567";
const DESC = "You will shape the product's interface with research, prototypes and a design system our engineers ship from. ".repeat(3);
const POSTED = () => new Date(Date.now() - 2 * 86_400_000).toISOString();
const row = (over: Partial<PostingRow> = {}): PostingRow => ({
  id: "greenhouse:acme:4567", title: "Senior Product Designer", company: "Acme", token: "acme", source: "greenhouse",
  location: "New York, NY", country: "US", workMode: null, postedAt: POSTED(), missingSince: null,
  applyUrl: "https://boards.greenhouse.io/acme/jobs/4567", salary: null, agency: false, category: "design", ...over,
});

const at = () => render(
  <MemoryRouter initialEntries={[PATH]}>
    <Routes>
      <Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} />
      <Route path="/jobs" element={<div>THE BOARD</div>} />
    </Routes>
  </MemoryRouter>,
);
const fieldLinks = () => [...document.querySelectorAll<HTMLAnchorElement>('main a[href^="/jobs/field/"]')];

beforeEach(() => {
  invoke.mockReset();
  clearBoardBudgetRefusal();
  i18n.addResourceBundle("en", "translation", enListing, true, true);
});
afterEach(() => { cleanup(); clearBoardBudgetRefusal(); });

describe("a live posting links the page of its field", () => {
  it("a design posting links /jobs/field/design, named 'More Design jobs'", async () => {
    invoke.mockResolvedValue({ data: { job: row(), description: DESC }, error: null });
    at();
    await screen.findByRole("heading", { level: 1, name: "Senior Product Designer" });
    const link = screen.getByRole("link", { name: "More Design jobs" });
    expect(link.getAttribute("href")).toBe("/jobs/field/design");
    expect(fieldLinks().map((a) => a.getAttribute("href"))).toEqual(["/jobs/field/design"]);
  });

  it("names the field the way the board does: Operations & Logistics", async () => {
    invoke.mockResolvedValue({ data: { job: row({ category: "operations", title: "Warehouse Lead" }), description: DESC }, error: null });
    at();
    await screen.findByRole("heading", { level: 1, name: "Warehouse Lead" });
    expect(screen.getByRole("link", { name: "More Operations & Logistics jobs" }).getAttribute("href")).toBe("/jobs/field/operations");
  });

  it("every field the board has a page for gets its own link, and only that one", async () => {
    for (const slug of BOARD_CATEGORY_SLUGS) {
      invoke.mockResolvedValue({ data: { job: row({ category: slug }), description: DESC }, error: null });
      at();
      await screen.findByRole("heading", { level: 1, name: "Senior Product Designer" });
      expect(fieldLinks().map((a) => a.getAttribute("href")), slug).toEqual([`/jobs/field/${slug}`]);
      cleanup();
    }
  });
});

describe("no field page, no link", () => {
  for (const [why, category] of [["the bucket no rule sorted", "other"], ["a field the board does not know", "astrology"], ["no field at all", null]] as const) {
    it(`${why} (${String(category)}) links no field page`, async () => {
      invoke.mockResolvedValue({ data: { job: row({ category }), description: DESC }, error: null });
      at();
      await screen.findByRole("heading", { level: 1, name: "Senior Product Designer" });
      expect(fieldLinks()).toEqual([]);
      expect(screen.queryByText(/^More .* jobs$/)).toBeNull();
    });
  }

  it("a posting the employer's feed dropped prints no field link", async () => {
    invoke.mockResolvedValue({ data: { job: row({ missingSince: new Date().toISOString() }), description: DESC }, error: null });
    at();
    await screen.findByRole("heading", { level: 1, name: "This posting is no longer live" });
    expect(fieldLinks()).toEqual([]);
  });
});
