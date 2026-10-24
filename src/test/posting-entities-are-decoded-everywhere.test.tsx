// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * POSTING ENTITIES ARE DECODED EVERYWHERE (job-listings audit JL12).
 *
 * The board decodes a row once as it lands (normalizeRow), so its own cards
 * were clean — but the posting page took the detail action's row as served,
 * and an entity-encoded title reached its h1, document.title and the
 * JobPosting title as "R&amp;D". A department line was never decoded on any
 * surface. Every listing surface now decodes the title (cleanJobTitle) and the
 * department (decodeNameEntities) itself, and the posting page hands the SAME
 * cleaned title to its heading, its head tags and its structured data.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
import { POSTING_LD_TAG_ID } from "@/components/jobs/posting-page";
import type { ListingJob } from "@/lib/listing/types";

const RAW_TITLE = "R&amp;D Engineer &#8211; Batteries";
const CLEAN_TITLE = "R&D Engineer – Batteries";
const ROW = {
  id: "greenhouse:acme:77", title: RAW_TITLE, company: "Acme &amp; Sons", token: "acme", source: "greenhouse",
  department: "Research &amp; Development", location: "Austin, TX", country: "US", workMode: null,
  postedAt: new Date(Date.now() - 86_400_000).toISOString(), missingSince: null, recheckedAt: null,
  applyUrl: "https://boards.greenhouse.io/acme/jobs/77", salary: null, agency: false,
} satisfies ListingJob;
const DESC = "Design &amp; test battery modules for our Austin lab, working with cell suppliers and test engineers. ".repeat(3);

const noEntity = (s: string | null | undefined) => expect(s ?? "").not.toMatch(/&amp;|&#\d+;|&#x[0-9a-f]+;/i);

beforeAll(() => { i18n.addResourceBundle("en", "translation", enListing, true, true); });
beforeEach(() => {
  invoke.mockReset(); clearBoardBudgetRefusal();
  document.head.querySelectorAll('script[type="application/ld+json"]').forEach((n) => n.remove());
});
afterEach(() => { cleanup(); clearBoardBudgetRefusal(); });

describe("the listing components decode what they print", () => {
  it("the card: title, employer and department", () => {
    render(<MemoryRouter><ul><JobCard job={ROW} ctx={{ surface: "board", density: "comfortable", hideEmployer: false, selected: false }} href="/x" /></ul></MemoryRouter>);
    expect(screen.getByRole("link", { name: CLEAN_TITLE })).toBeTruthy();
    expect(document.body.textContent).toContain("Acme & Sons");
    expect(document.body.textContent).toContain("Research & Development");
    noEntity(document.body.textContent);
  });

  it("the pane and its facts", () => {
    render(<MemoryRouter><PostingDetail job={ROW} surface="board" description={{ text: DESC, state: "loaded" }} /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 2, name: CLEAN_TITLE })).toBeTruthy();
    expect(document.body.textContent).toContain("Research & Development");
    expect(document.body.textContent).toContain("Design & test battery modules");
    noEntity(document.body.textContent);
  });

  it("the phone sheet's title", async () => {
    render(
      <MemoryRouter>
        <PostingSheet job={ROW} open onClose={() => {}}>
          <PostingDetail job={ROW} surface="sheet" description={{ text: DESC, state: "loaded" }} />
        </PostingSheet>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("dialog", { name: CLEAN_TITLE })).toBeTruthy();
  });
});

describe("the posting page hands one cleaned title to every reader", () => {
  it("h1, breadcrumb, document.title and the JobPosting title", async () => {
    invoke.mockResolvedValue({ data: { job: ROW, description: DESC }, error: null });
    render(
      <MemoryRouter initialEntries={["/jobs/posting/greenhouse/acme/77"]}>
        <Routes><Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: CLEAN_TITLE })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain(CLEAN_TITLE);
    await waitFor(() => expect(document.title).toContain(CLEAN_TITLE));
    noEntity(document.title);
    await waitFor(() => expect(document.getElementById(POSTING_LD_TAG_ID)).not.toBeNull());
    const ld = JSON.parse(document.getElementById(POSTING_LD_TAG_ID)!.textContent || "{}");
    expect(ld.title).toBe(CLEAN_TITLE);
    noEntity(document.body.textContent);
  });
});
