// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * "MORE ROLES AT {EMPLOYER}" LINKS A POSTING PAGE ONLY WHERE THE BAKE WROTE ONE
 * (CRAWL-M1, SEO audit 2026-11-18).
 *
 * The section under every posting page makes one list call (this employer's
 * newest roles) and linked each card to /jobs/posting/<id> whether or not the
 * bake wrote that page. Live, for four employers' posting pages, the four
 * other rows were unbaked in every case but one row: an unbaked posting
 * address serves the fallback file (the homepage's copy, index, follow,
 * canonical "/") and then renders a self-canonical page with job markup the
 * bake never checked (no employer read, no ceiling, no sitemap, no closure
 * check).
 *
 * Held here: a card links its posting page only when /posting-pages.json
 * (the bake's list of live posting pages) names it; otherwise, and while that
 * file has not loaded or is missing, it links the employer's page, the same
 * address the section's "see every open role" link uses. On 9c9234e9a the
 * unlisted card links /jobs/posting/<id>.
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
import { postingPagePath } from "@/components/jobs/posting-page";
import { setLanderManifestForTests } from "@/lib/seo/lander-manifest";
import {
  bakedPostingPath,
  isBakedPostingPage,
  loadPostingManifest,
  parsePostingManifest,
  setPostingManifestForTests,
} from "@/lib/seo/posting-manifest";
import type { ListingJob } from "@/lib/listing/types";

// The shape of the live list reply for a Greenhouse employer: five rows, the
// posting itself among them (it is dropped), one key with a dot in it (its
// page path ends in a slash, as the bake writes it).
const ROWS: ListingJob[] = [
  { id: "greenhouse:acme:1001", source: "greenhouse", token: "acme", company: "Acme", title: "Staff Accountant" },
  { id: "greenhouse:acme:1002", source: "greenhouse", token: "acme", company: "Acme", title: "Payroll Specialist" },
  { id: "greenhouse:acme:1003", source: "greenhouse", token: "acme", company: "Acme", title: "Tax Manager" },
  { id: "greenhouse:acme:10.04", source: "greenhouse", token: "acme", company: "Acme", title: "Audit Senior" },
  { id: "greenhouse:acme:1005", source: "greenhouse", token: "acme", company: "Acme", title: "Controller" },
];
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

/** The section on Acme's posting greenhouse:acme:1001, scrolled into view, its four cards drawn. */
async function section() {
  vi.stubGlobal("IntersectionObserver", FakeIO);
  invoke.mockResolvedValue({ data: { jobs: ROWS.map((r) => ({ ...r, postedAt: POSTED(), missingSince: null, agency: false })) }, error: null });
  render(<MemoryRouter><MoreRolesAtEmployer token="acme" employer="Acme" excludeId="greenhouse:acme:1001" source="greenhouse" /></MemoryRouter>);
  scrollIntoView();
  await waitFor(() => expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4));
}
const cardHref = (title: string) => screen.getByRole("link", { name: title }).getAttribute("href");
const seeAllHref = () => document.querySelector("[data-more-roles-all]")!.getAttribute("href");

beforeAll(() => { i18n.addResourceBundle("en", "translation", enListing, true, true); });
beforeEach(() => {
  invoke.mockReset();
  watchers = [];
  clearBoardBudgetRefusal();
  setPostingManifestForTests(null);
  setLanderManifestForTests(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearBoardBudgetRefusal();
  setPostingManifestForTests(null);
  setLanderManifestForTests(null);
});

describe("a More roles card", () => {
  it("links the employer's page when the manifest does not name its posting page (main linked /jobs/posting/<id>)", async () => {
    setPostingManifestForTests(["/jobs/posting/greenhouse/acme/1003"]);
    await section();
    expect(cardHref("Payroll Specialist")).toBe("/jobs?company=acme");
    expect(cardHref("Controller")).toBe("/jobs?company=acme");
    expect(cardHref("Audit Senior")).toBe("/jobs?company=acme");
    expect(cardHref("Payroll Specialist"), "the same page the see-all link opens").toBe(seeAllHref());
    for (const a of document.querySelectorAll("[data-more-roles] a")) {
      expect(a.getAttribute("href"), "no unbaked posting address is linked").not.toMatch(/^\/jobs\/posting\/greenhouse\/acme\/(1002|1005|10\.04)/);
    }
  });

  it("links its posting page when the manifest names it live", async () => {
    setPostingManifestForTests(["/jobs/posting/greenhouse/acme/1003", "/jobs/posting/greenhouse/acme/10.04/"]);
    await section();
    expect(cardHref("Tax Manager")).toBe("/jobs/posting/greenhouse/acme/1003");
    // A dotted key's page path ends in a slash; the manifest may spell it either way.
    expect(cardHref("Audit Senior")).toBe(postingPagePath("greenhouse:acme:10.04"));
    expect(cardHref("Audit Senior")).toBe("/jobs/posting/greenhouse/acme/10.04/");
    expect(cardHref("Payroll Specialist")).toBe("/jobs?company=acme");
  });

  it("with no manifest (not loaded, or missing) every card links the employer's page", async () => {
    await section();
    for (const title of ["Payroll Specialist", "Tax Manager", "Audit Senior", "Controller"]) {
      expect(cardHref(title), title).toBe("/jobs?company=acme");
    }
  });

  it("the employer's page is the written company page when the bake wrote one", async () => {
    setLanderManifestForTests({ acme: "/jobs/company/acme" });
    await section();
    expect(cardHref("Controller")).toBe("/jobs/company/acme");
    expect(seeAllHref()).toBe("/jobs/company/acme");
  });

  it("re-renders when the manifest arrives after the cards", async () => {
    await section();
    expect(cardHref("Tax Manager")).toBe("/jobs?company=acme");
    act(() => { setPostingManifestForTests(["/jobs/posting/greenhouse/acme/1003"]); });
    await waitFor(() => expect(cardHref("Tax Manager")).toBe("/jobs/posting/greenhouse/acme/1003"));
    expect(cardHref("Controller")).toBe("/jobs?company=acme");
  });
});

describe("the manifest reader", () => {
  const response = (body: unknown, type = "application/json", ok = true) =>
    ({ ok, headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? type : null) }, json: async () => body }) as unknown as Response;

  it("reads the bake's {at, live} file, and only posting paths in it", async () => {
    const fetcher = vi.fn(async () => response({ at: "2026-11-18", live: [
      "/jobs/posting/greenhouse/acme/1003",
      "https://resumebooster.work/jobs/posting/lever/beta/abc-1",
      "/jobs/company/acme", "/jobs/posting/", 42, null,
    ] }));
    await loadPostingManifest(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith("/posting-pages.json", expect.anything());
    expect(isBakedPostingPage("/jobs/posting/greenhouse/acme/1003")).toBe(true);
    expect(isBakedPostingPage("/jobs/posting/greenhouse/acme/1003/")).toBe(true);
    expect(isBakedPostingPage("/jobs/posting/lever/beta/abc-1")).toBe(true);
    expect(isBakedPostingPage("/jobs/posting/greenhouse/acme/1002")).toBe(false);
    expect(isBakedPostingPage("/jobs/company/acme")).toBe(false);
    expect(bakedPostingPath(null)).toBeNull();
  });

  it("the SPA fallback's HTML, a failed read and a file with no list are no manifest", async () => {
    await loadPostingManifest((async () => response("<!doctype html>", "text/html")) as unknown as typeof fetch);
    expect(isBakedPostingPage("/jobs/posting/greenhouse/acme/1003")).toBe(false);
    setPostingManifestForTests(null);
    await loadPostingManifest((async () => response(null, "application/json", false)) as unknown as typeof fetch);
    expect(isBakedPostingPage("/jobs/posting/greenhouse/acme/1003")).toBe(false);
    setPostingManifestForTests(null);
    await loadPostingManifest((async () => { throw new TypeError("offline"); }) as unknown as typeof fetch);
    expect(isBakedPostingPage("/jobs/posting/greenhouse/acme/1003")).toBe(false);
    expect(parsePostingManifest({ at: "2026-11-18" })).toBeNull();
    expect(parsePostingManifest({ "/jobs/posting/a/b/c": true })).toBeNull();
    expect([...parsePostingManifest(["/jobs/posting/a/b/c/", "/jobs/posting/a/b/c"])!]).toEqual(["/jobs/posting/a/b/c"]);
  });
});
