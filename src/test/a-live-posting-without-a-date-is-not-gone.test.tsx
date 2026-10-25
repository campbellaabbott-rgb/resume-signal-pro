// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * A LIVE POSTING WITHOUT A DATE IS NOT GONE (job-listings audit JL1).
 *
 * The posting page asked isPostingLive — the bake's question, which is false
 * for every posting the employer did not date — so 15 audited live, undated
 * postings rendered "This posting is no longer live", lost their crawl
 * directive to noindex, and offered no Apply, while the board served them and
 * the employer still listed them.
 *
 * Three states now (src/lib/listing/liveness.ts):
 *   gone          missingSince set → retracted, noindex, no markup (unchanged);
 *   windowClosed  a stated date past the window → the same retraction and the
 *                 same words as before (the gone-posting guard pins them);
 *   live          everything else — the undated posting renders, keeps the
 *                 crawl directive its file shipped, and carries NO JobPosting
 *                 markup (datePosted is required and none was stated).
 *
 * isPostingLive itself is unchanged, and pinned so here: the bake reads it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
import { isPostingLive, POSTING_LD_TAG_ID, type PostingRow } from "@/components/jobs/posting-page";
import { postingLiveness } from "@/lib/listing/liveness";

const PATH = "/jobs/posting/pinpoint/acme/991";
const DESC = "We are hiring a site supervisor for our Leeds depot, leading a team of twelve across two shifts. ".repeat(3);
const row = (over: Partial<PostingRow> = {}): PostingRow => ({
  id: "pinpoint:acme:991", title: "Site Supervisor", company: "Acme Logistics", token: "acme", source: "pinpoint",
  location: "Leeds", country: "GB", workMode: null, postedAt: null, missingSince: null,
  applyUrl: "https://acme.pinpointhq.com/jobs/991", salary: null, agency: false, ...over,
});
const NOW = new Date("2026-10-12T12:00:00Z");

function seedHead() {
  const robots = document.createElement("meta");
  robots.name = "robots"; robots.content = "index, follow";
  document.head.appendChild(robots);
  const ld = document.createElement("script");
  ld.type = "application/ld+json"; ld.id = POSTING_LD_TAG_ID;
  ld.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: "Site Supervisor" });
  document.head.appendChild(ld);
  return { robots };
}
const jobEntities = () =>
  [...document.head.querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => { try { return JSON.parse(s.textContent || ""); } catch { return null; } })
    .filter((d) => d && d["@type"] === "JobPosting");
const at = () => render(
  <MemoryRouter initialEntries={[PATH]}>
    <Routes>
      <Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} />
      <Route path="/jobs" element={<div>THE BOARD</div>} />
    </Routes>
  </MemoryRouter>,
);
const clearHead = () => document.head.querySelectorAll('meta[name="robots"], script[type="application/ld+json"]').forEach((n) => n.remove());

beforeEach(() => { invoke.mockReset(); clearBoardBudgetRefusal(); clearHead(); });
afterEach(() => { cleanup(); clearBoardBudgetRefusal(); clearHead(); });

describe("the three states", () => {
  it("gone, window closed, live — and an undated row is live", () => {
    expect(postingLiveness(row({ missingSince: "2026-10-10T00:00:00Z" }), NOW)).toBe("gone");
    expect(postingLiveness(row({ postedAt: "2026-08-01" }), NOW)).toBe("windowClosed");
    expect(postingLiveness(row({ postedAt: "2026-10-01" }), NOW)).toBe("live");
    expect(postingLiveness(row({ postedAt: null }), NOW)).toBe("live");
    expect(postingLiveness(row({ postedAt: "not a date" }), NOW), "an unreadable stamp is no date, not an expired one").toBe("live");
  });

  it("isPostingLive is left exactly as the bake reads it: undated is not bakeable", () => {
    expect(isPostingLive(row({ postedAt: null }), NOW)).toBe(false);
    expect(isPostingLive(row({ postedAt: "2026-10-01" }), NOW)).toBe(true);
  });
});

describe("the page renders an undated live posting as live", () => {
  it("shows the posting, its Apply, and says its system states no date", async () => {
    invoke.mockResolvedValue({ data: { job: row(), description: DESC }, error: null });
    at();
    expect(await screen.findByRole("heading", { level: 1, name: "Site Supervisor" })).toBeTruthy();
    expect(screen.queryByText(/no longer live/i)).toBeNull();
    expect(screen.getByRole("link", { name: /Apply on Acme Logistics' site/ }).getAttribute("href")).toBe("https://acme.pinpointhq.com/jobs/991");
    expect(document.querySelector("[data-fact='posted']")?.textContent).toBe("The employer's system states no posting date");
    expect(document.body.textContent).not.toMatch(/first seen/i);
  });

  it("keeps the crawl directive its file shipped and carries no JobPosting markup", async () => {
    const { robots } = seedHead();
    invoke.mockResolvedValue({ data: { job: row(), description: DESC }, error: null });
    at();
    await screen.findByRole("heading", { level: 1, name: "Site Supervisor" });
    await waitFor(() => expect(jobEntities(), "no datePosted can be stated, so no markup is written (and a stale one is cleared)").toEqual([]));
    expect(robots.getAttribute("content")).toBe("index, follow");
  });

  it("positive control: a dated live posting still writes exactly one entity", async () => {
    seedHead();
    invoke.mockResolvedValue({ data: { job: row({ postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }), description: DESC }, error: null });
    at();
    await waitFor(() => expect(jobEntities().length).toBe(1));
    expect(jobEntities()[0].datePosted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("positive control: a posting the employer's feed dropped is still retracted", async () => {
    const { robots } = seedHead();
    invoke.mockResolvedValue({ data: { job: row({ missingSince: new Date().toISOString() }), description: DESC }, error: null });
    at();
    expect(await screen.findByRole("heading", { level: 1, name: /no longer live/i })).toBeTruthy();
    await waitFor(() => expect(robots.getAttribute("content")).toBe("noindex"));
    expect(jobEntities()).toEqual([]);
  });
});
