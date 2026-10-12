// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * "MORE ROLES AT {EMPLOYER}" NEVER PRINTS ANOTHER EMPLOYER'S ROLES.
 *
 * Found live on 3ebdcbb2 (2026-10-12). The posting page's new section asked
 * the list by board token and hid every card's employer line, so:
 *   - /jobs/posting/greenhouse/clear/8256119 (CLEAR - Corporate, Greenhouse)
 *     read "More roles at CLEAR - Corporate" over "Erasmus Internship -
 *     Community Intern", a BambooHR posting of Clear, a different company that
 *     shares the token (src/lib/board-collisions.ts);
 *   - /jobs/posting/usajobs/usajobs/886982900 (National Institutes of Health)
 *     read "More roles at National Institutes of Health" over an Army IMCOM
 *     range inspector and three Marine Corps child-care roles, because every
 *     USAJOBS row shares the token "usajobs".
 * The rows below are the list replies the live job-board returned for those
 * two tokens that day (the request the section sends).
 *
 * Held here: the page does not mount the section on a collided token or on
 * USAJOBS; the section refuses those tokens itself; and on any other token it
 * keeps only rows from the posting's own system under the posting's own
 * employer name, leaves out the "see every role" link if anyone else's row
 * came back, and leaves out the whole section if nothing of this employer's did.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
import { MoreRolesAtEmployer } from "@/components/jobs/listing/MoreRolesAtEmployer";
import { moreRolesAllowed, sameEmployerRows } from "@/lib/listing/more-roles";
import type { ListingJob } from "@/lib/listing/types";

const CLEAR_LIST: ListingJob[] = [
  { id: "bamboohr:clear:498", source: "bamboohr", token: "clear", company: "Clear", title: "Erasmus Internship - Community Intern" },
  { id: "greenhouse:clear:8256119", source: "greenhouse", token: "clear", company: "CLEAR - Corporate", title: "Accounting Manager" },
  { id: "greenhouse:clear:8262132", source: "greenhouse", token: "clear", company: "CLEAR - Corporate", title: "Manager,  Product Design" },
  { id: "greenhouse:clear:8265400", source: "greenhouse", token: "clear", company: "CLEAR - Corporate", title: "Senior Product Designer" },
  { id: "greenhouse:clear:8259786", source: "greenhouse", token: "clear", company: "CLEAR - Corporate", title: "Forward Deployed AI Engineer II" },
];
const USAJOBS_LIST: ListingJob[] = [
  { id: "usajobs:usajobs:886832600", source: "usajobs", token: "usajobs", company: "United States Army Installation Management Command", title: "Technical Range Inspector" },
  { id: "usajobs:usajobs:886982900", source: "usajobs", token: "usajobs", company: "National Institutes of Health", title: "Supervisory Management and Program Analyst" },
  { id: "usajobs:usajobs:887306400", source: "usajobs", token: "usajobs", company: "U.S. Marine Corps", title: "CHILD & YOUTH PROGRAM ASSISTANT (CDC), CY-01/02/RFT, ALL CAMPS" },
];

type Watcher = { cb: IntersectionObserverCallback; disconnected: boolean };
let watchers: Watcher[] = [];
class FakeIO {
  w: Watcher;
  constructor(cb: IntersectionObserverCallback) { this.w = { cb, disconnected: false }; watchers.push(this.w); }
  observe() {}
  disconnect() { this.w.disconnected = true; }
  unobserve() {}
  takeRecords() { return []; }
}
const scrollIntoView = () => act(() => {
  for (const w of [...watchers]) if (!w.disconnected) w.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
});

beforeAll(() => { i18n.addResourceBundle("en", "translation", enListing, true, true); });
beforeEach(() => { invoke.mockReset(); watchers = []; clearBoardBudgetRefusal(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearBoardBudgetRefusal(); });

describe("which tokens may carry the section at all", () => {
  it("never a token two hiring systems share, never USAJOBS; any other board yes", () => {
    expect(moreRolesAllowed("clear", "greenhouse")).toBe(false);
    expect(moreRolesAllowed("clear", "bamboohr")).toBe(false);
    expect(moreRolesAllowed("usajobs", "usajobs")).toBe(false);
    expect(moreRolesAllowed("acme", "usajobs")).toBe(false);
    expect(moreRolesAllowed("acme", "greenhouse"), "positive control").toBe(true);
    expect(moreRolesAllowed(null, "greenhouse")).toBe(false);
  });

  it("the backstop keeps this system's rows under this employer's name, and says the reply was mixed", () => {
    const kept = sameEmployerRows(CLEAR_LIST, { source: "greenhouse", employer: "CLEAR - Corporate", excludeId: "greenhouse:clear:8256119" });
    expect(kept.rows.map((r) => r.id)).toEqual(["greenhouse:clear:8262132", "greenhouse:clear:8265400", "greenhouse:clear:8259786"]);
    expect(kept.mixed).toBe(true);
    const fed = sameEmployerRows(USAJOBS_LIST, { source: "usajobs", employer: "National Institutes of Health", excludeId: "usajobs:usajobs:886982900" });
    expect(fed.rows).toEqual([]);
    expect(fed.mixed).toBe(true);
  });
});

describe("the section itself", () => {
  it("renders nothing and asks nothing on the clear and usajobs tokens", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    invoke.mockResolvedValue({ data: { jobs: CLEAR_LIST }, error: null });
    const { container } = render(
      <MemoryRouter>
        <MoreRolesAtEmployer token="clear" employer="CLEAR - Corporate" excludeId="greenhouse:clear:8256119" source="greenhouse" />
        <MoreRolesAtEmployer token="usajobs" employer="National Institutes of Health" excludeId="usajobs:usajobs:886982900" source="usajobs" />
      </MemoryRouter>,
    );
    scrollIntoView();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(invoke).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });

  it("on a mixed reply prints only this employer's cards and leaves out the see-all link", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    const mixed = CLEAR_LIST.map((r) => ({ ...r, id: r.id.replace(":clear:", ":acme:"), token: "acme" }));
    invoke.mockResolvedValue({ data: { jobs: mixed }, error: null });
    render(<MemoryRouter><MoreRolesAtEmployer token="acme" employer="CLEAR - Corporate" excludeId="greenhouse:acme:8256119" source="greenhouse" /></MemoryRouter>);
    scrollIntoView();
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 3 }).length).toBe(3));
    expect(screen.queryByText("Erasmus Internship - Community Intern")).toBeNull();
    expect(screen.queryByRole("link", { name: /See every open role/ })).toBeNull();
  });

  it("with nothing of this employer's in the reply, the whole section goes", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    const others = USAJOBS_LIST.map((r) => ({ ...r, id: r.id.replace("usajobs:usajobs:", "greenhouse:fed:"), source: "greenhouse", token: "fed" }));
    invoke.mockResolvedValue({ data: { jobs: others }, error: null });
    const { container } = render(<MemoryRouter><MoreRolesAtEmployer token="fed" employer="Somebody Else" excludeId="greenhouse:fed:1" source="greenhouse" /></MemoryRouter>);
    scrollIntoView();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector("[data-more-roles]")).toBeNull());
  });
});

describe("the posting page", () => {
  const DESC = "We are hiring an accounting manager to own the monthly close and lead a team of four. ".repeat(3);
  const page = (path: string) => render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} />
      </Routes>
    </MemoryRouter>,
  );
  const detail = (job: ListingJob) => ({ data: { job: { postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), missingSince: null, agency: false, ...job }, description: DESC }, error: null });

  it("does not mount the section on the collided clear posting", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    invoke.mockResolvedValue(detail(CLEAR_LIST[1]));
    page("/jobs/posting/greenhouse/clear/8256119");
    await screen.findByRole("heading", { level: 1, name: "Accounting Manager" });
    expect(document.querySelector("[data-more-roles-slot]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/More roles at/);
  });

  it("does not mount the section on a USAJOBS posting, and makes no aggregator claim there", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    invoke.mockResolvedValue(detail(USAJOBS_LIST[1]));
    page("/jobs/posting/usajobs/usajobs/886982900");
    await screen.findByRole("heading", { level: 1, name: "Supervisory Management and Program Analyst" });
    expect(document.querySelector("[data-more-roles-slot]")).toBeNull();
    expect(document.body.textContent).not.toMatch(/never an aggregator/);
  });

  it("positive control: an ordinary employer's posting mounts it, and the aggregator note stays", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    invoke.mockResolvedValue(detail({ id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme", title: "Staff Accountant" }));
    page("/jobs/posting/greenhouse/acme/1");
    await screen.findByRole("heading", { level: 1, name: "Staff Accountant" });
    expect(document.querySelector("[data-more-roles-slot]")).not.toBeNull();
    expect(document.body.textContent).toMatch(/never an aggregator/);
  });
});
