// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * A "MORE ROLES AT {EMPLOYER}" CARD WITH NO WRITTEN PAGE STILL OPENS ITS ROLE
 * (review of 2026-11-21, on SEO audit item CRAWL-M1).
 *
 * A person on a posting page reads four more roles at the same employer and
 * clicks one. The bake writes a page for only some postings (production's
 * sitemap listed 429 on 2026-11-21), so the role they clicked almost never
 * has a written page. Two things went wrong on the way to keeping crawlers
 * off those addresses:
 *
 *   - before the audit, the card linked the role with nothing asking a
 *     crawler to stay off an address the bake never wrote;
 *   - the first fix linked the employer's page instead, so the person who
 *     picked "Payroll Specialist" was handed every open role at the employer,
 *     and after a mixed reply (another employer's row under the same token)
 *     the card was not a link at all.
 *
 * Held here, as the site is served today, with no /posting-pages.json
 * published (the request is answered with the fallback page): every card
 * links the role it names and carries rel="nofollow"; a role whose id cannot
 * be a page path opens on the board by its id; and nothing but the "see every
 * open role" link opens the employer's page.
 *
 * This file reads no manifest module, so it runs against the code as it was
 * before the manifest existed and fails there on the missing rel. The cases
 * with a manifest are in
 * a-more-roles-card-opens-its-own-role-and-only-a-baked-page-is-followed.test.tsx.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

import { MoreRolesAtEmployer } from "@/components/jobs/listing/MoreRolesAtEmployer";
import { setLanderManifestForTests } from "@/lib/seo/lander-manifest";
import type { ListingJob } from "@/lib/listing/types";

// The live list reply for a Greenhouse employer: the posting on screen (it is
// dropped) and four more, one of them with a dot in its key (its page path
// ends in a slash, as the bake writes it).
const ROWS: ListingJob[] = [
  { id: "greenhouse:acme:1001", source: "greenhouse", token: "acme", company: "Acme", title: "Staff Accountant" },
  { id: "greenhouse:acme:1002", source: "greenhouse", token: "acme", company: "Acme", title: "Payroll Specialist" },
  { id: "greenhouse:acme:1003", source: "greenhouse", token: "acme", company: "Acme", title: "Tax Manager" },
  { id: "greenhouse:acme:10.04", source: "greenhouse", token: "acme", company: "Acme", title: "Audit Senior" },
  { id: "greenhouse:acme:1005", source: "greenhouse", token: "acme", company: "Acme", title: "Controller" },
];
/** Each card's own role, by title. */
const OWN: Record<string, string> = {
  "Payroll Specialist": "/jobs/posting/greenhouse/acme/1002",
  "Tax Manager": "/jobs/posting/greenhouse/acme/1003",
  "Audit Senior": "/jobs/posting/greenhouse/acme/10.04/",
  "Controller": "/jobs/posting/greenhouse/acme/1005",
};
const POSTED = () => new Date(Date.now() - 2 * 86_400_000).toISOString();

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

/** What this host answers for a file it does not have: the fallback page, with a 200. */
const fallbackPage = () =>
  ({ ok: true, headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) }, json: async () => { throw new SyntaxError("not JSON"); } }) as unknown as Response;

/** The section on Acme's posting greenhouse:acme:1001, scrolled into view, with `shown` cards drawn. */
async function section(rows: ListingJob[] = ROWS, shown = 4) {
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("fetch", vi.fn(async () => fallbackPage()));
  invoke.mockResolvedValue({ data: { jobs: rows.map((r) => ({ ...r, postedAt: POSTED(), missingSince: null, agency: false })) }, error: null });
  render(<MemoryRouter><MoreRolesAtEmployer token="acme" employer="Acme" excludeId="greenhouse:acme:1001" source="greenhouse" /></MemoryRouter>);
  scrollIntoView();
  await waitFor(() => expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(shown));
}
const card = (title: string) => screen.getByRole("link", { name: title });
const seeAll = () => document.querySelector("[data-more-roles-all]");
const sectionLinks = () => [...document.querySelectorAll("[data-more-roles] a")];

beforeAll(() => { i18n.addResourceBundle("en", "translation", enListing, true, true); });
beforeEach(() => {
  invoke.mockReset();
  watchers = [];
  clearBoardBudgetRefusal();
  setLanderManifestForTests(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearBoardBudgetRefusal();
  setLanderManifestForTests(null);
});

describe("a More roles card whose posting page the bake did not write", () => {
  it("opens the role it names, and asks crawlers not to follow", async () => {
    await section();
    for (const title of Object.keys(OWN)) {
      expect(card(title).getAttribute("href"), title).toBe(OWN[title]);
      expect(card(title).getAttribute("rel"), title).toBe("nofollow");
    }
    // The employer's whole list is one link away, and it is not a card.
    expect(seeAll()!.getAttribute("href")).toBe("/jobs?company=acme");
    expect(sectionLinks().filter((a) => a.getAttribute("href") === "/jobs?company=acme")).toEqual([seeAll()]);
  });

  it("opens its own role where the bake wrote the employer a page, which only the see-all link opens", async () => {
    setLanderManifestForTests({ acme: "/jobs/company/acme" });
    await section();
    expect(seeAll()!.getAttribute("href")).toBe("/jobs/company/acme");
    for (const title of Object.keys(OWN)) {
      expect(card(title).getAttribute("href"), title).toBe(OWN[title]);
      expect(card(title).getAttribute("rel"), title).toBe("nofollow");
    }
    expect(sectionLinks().filter((a) => a.getAttribute("href") === "/jobs/company/acme")).toEqual([seeAll()]);
  });

  it("is still a link to its own role after a mixed reply, where the token's page is not offered at all", async () => {
    const other: ListingJob = { id: "greenhouse:acme:2001", source: "greenhouse", token: "acme", company: "Acme Staffing Partner", title: "Recruiting Coordinator" };
    await section([...ROWS, other]);
    expect(seeAll(), "the see-all link is withheld: the token's page lists the other employer too").toBeNull();
    expect(screen.queryByText("Recruiting Coordinator"), "the other employer's row is not printed").toBeNull();
    expect(sectionLinks().map((a) => a.getAttribute("href")).sort()).toEqual(Object.values(OWN).sort());
    for (const title of Object.keys(OWN)) expect(card(title).getAttribute("rel"), title).toBe("nofollow");
  });

  it("opens on the board by its id when the id cannot be a page path, never on the employer's list", async () => {
    // A key with a space is no path segment (posting-page.ts), so this role has no posting page address.
    const odd: ListingJob = { id: "greenhouse:acme:R 1006", source: "greenhouse", token: "acme", company: "Acme", title: "Treasury Analyst" };
    await section([ROWS[0], ROWS[1], odd], 2);
    expect(card("Treasury Analyst").getAttribute("href")).toBe("/jobs?job=greenhouse%3Aacme%3AR%201006");
    expect(card("Treasury Analyst").getAttribute("rel")).toBe("nofollow");
    expect(card("Payroll Specialist").getAttribute("href")).toBe(OWN["Payroll Specialist"]);
  });
});
