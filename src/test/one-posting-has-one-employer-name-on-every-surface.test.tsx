// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * ONE POSTING HAS ONE EMPLOYER NAME ON EVERY SURFACE (design spec JL3).
 *
 * On 823da0c4 the card printed the stored `company`, the pane's trust line
 * companyDisplayName(company), and the posting page postingEmployer (the
 * database's name override plus the entity decode). A Workday tenant stored by
 * its system code — "Ms" on ms~wd5~external — therefore read "Morgan Stanley"
 * on the posting page and "Ms" on the card that linked to it.
 *
 * Every listing surface now asks listingEmployer, and this file mounts each
 * one from the same row and reads the name each prints: the card, the pane
 * header, the pane's Apply button, the phone sheet, and the posting page's
 * breadcrumb, header, Apply button and document title.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "@/i18n";
import enListing from "@/i18n/shards/listing/en.json";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

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
import { JobCard } from "@/components/jobs/listing/JobCard";
import { PostingDetail } from "@/components/jobs/listing/PostingDetail";
import { PostingSheet } from "@/components/jobs/listing/PostingSheet";
import { listingEmployer } from "@/lib/listing/employer";
import type { ListingJob } from "@/lib/listing/types";

const ROW = {
  id: "workday:ms~wd5~external:JR1", title: "Analyst", company: "Ms", token: "ms~wd5~external", source: "workday",
  location: "New York, NY", country: "US", workMode: null, postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  missingSince: null, recheckedAt: new Date(Date.now() - 600_000).toISOString(),
  applyUrl: "https://ms.wd5.myworkdayjobs.com/External/job/New-York/Analyst_JR1", salary: null, agency: false,
} satisfies ListingJob;
const NAME = "Morgan Stanley";
const DESC = "We are hiring an analyst for the New York office to support the equity research team. ".repeat(4);

beforeAll(() => { i18n.addResourceBundle("en", "translation", enListing, true, true); });
beforeEach(() => { invoke.mockReset(); clearBoardBudgetRefusal(); });
afterEach(() => { cleanup(); clearBoardBudgetRefusal(); });

it("the seam itself resolves the tenant code to the employer's own name", () => {
  expect(listingEmployer(ROW)).toBe(NAME);
  expect(listingEmployer({ id: "greenhouse:bobs:1", token: "bobs", company: "Bob&#39;s Auto &amp; Towing" })).toBe("Bob's Auto & Towing");
});

describe("every surface prints the same name", () => {
  it("the card", () => {
    render(<MemoryRouter><ul><JobCard job={ROW} ctx={{ surface: "board", density: "comfortable", hideEmployer: false, selected: false }} href="/x" /></ul></MemoryRouter>);
    expect(screen.getByRole("link", { name: NAME })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bMs\b/);
  });

  it("the pane: header link and Apply button", () => {
    render(<MemoryRouter><PostingDetail job={ROW} surface="board" description={{ text: DESC, state: "loaded" }} onClose={() => {}} /></MemoryRouter>);
    const header = document.querySelector("[data-posting-header]") as HTMLElement;
    expect(within(header).getByRole("link", { name: NAME })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Apply on Morgan Stanley's site/ })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bMs\b/);
  });

  it("the phone sheet's body", async () => {
    render(
      <MemoryRouter>
        <PostingSheet job={ROW} open onClose={() => {}}>
          <PostingDetail job={ROW} surface="sheet" description={{ text: DESC, state: "loaded" }} />
        </PostingSheet>
      </MemoryRouter>,
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: NAME })).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/\bMs\b/);
  });

  it("the posting page: breadcrumb, header, Apply and title", async () => {
    invoke.mockResolvedValue({ data: { job: ROW, description: DESC }, error: null });
    render(
      <MemoryRouter initialEntries={["/jobs/posting/workday/ms~wd5~external/JR1"]}>
        <Routes><Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { level: 1, name: "Analyst" });
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: NAME }).getAttribute("href")).toBe("/jobs/company/ms~wd5~external");
    const article = document.querySelector("[data-posting-detail='page']") as HTMLElement;
    expect(within(article).getByRole("link", { name: NAME })).toBeTruthy();
    expect(within(article).getByRole("link", { name: /Apply on Morgan Stanley's site/ })).toBeTruthy();
    await waitFor(() => expect(document.title).toContain(NAME));
    expect(document.title).not.toMatch(/\bMs\b/);
  });
});
