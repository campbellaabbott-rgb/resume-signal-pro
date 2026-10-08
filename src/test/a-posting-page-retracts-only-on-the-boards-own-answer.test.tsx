// A POSTING PAGE RETRACTS ONLY ON THE BOARD'S OWN ANSWER.
//
// /jobs/posting/<source>/<token>/<key> is a prerendered crawler surface. Two
// wirings told crawlers the wrong thing about it:
//   - the board's 404 for a vanished posting ({error:'Posting not found (it
//     may have closed)'}) was retried after 1.2 s -- a second counted read --
//     then rendered as a retryable "couldn't load" that kept index,follow: a
//     soft 404 that stays indexed and a visitor told to retry forever;
//   - the "no longer live" title and description, and the clearing of the
//     baked JobPosting block, applied to every state that was not ready --
//     loading, a transient failure, a budget refusal -- so a renderer that
//     snapshotted early read a live posting as gone, with its markup removed.
// And the pay line said "This employer states no pay on this posting" when
// our own reader simply missed the figure.
//
// Mounted with the head seeded the way the bake writes it: a title, a
// description, a robots tag and a JobPosting block under the shared id.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [] }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import JobPosting from "../pages/JobPosting";
import { POSTING_LD_TAG_ID as LD_TAG_ID } from "@/components/jobs/posting-page";

const PATH = "/jobs/posting/workday/acme~wd3~Careers/JR1";
const BAKED_TITLE = "Staff Nurse at Acme Health — Leeds | Resume Booster";
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) },
});
const row = () => ({
  id: "workday:acme~wd3~Careers:JR1", title: "Staff Nurse", company: "Acme Health", location: "Leeds", country: "GB",
  workMode: null, token: "acme~wd3~Careers", postedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  missingSince: null, applyUrl: "https://acme.example/jobs/JR1", salary: null,
});

function seedBakedHead() {
  document.title = BAKED_TITLE;
  const robots = document.createElement("meta");
  robots.name = "robots"; robots.content = "index, follow";
  document.head.appendChild(robots);
  const desc = document.createElement("meta");
  desc.name = "description"; desc.content = "Staff Nurse at Acme Health in Leeds, from Acme Health's own job board.";
  document.head.appendChild(desc);
  const ld = document.createElement("script");
  ld.type = "application/ld+json"; ld.id = LD_TAG_ID;
  ld.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: "Staff Nurse" });
  document.head.appendChild(ld);
  return { robots };
}
const jobEntities = () =>
  [...document.head.querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => { try { return JSON.parse(s.textContent || ""); } catch { return null; } })
    .filter((d) => d && d["@type"] === "JobPosting");
const descriptions = () => [...document.head.querySelectorAll('meta[name="description"]')].map((m) => m.getAttribute("content"));
const detailCalls = () => invoke.mock.calls.filter(([, o]) => (o as { body?: { action?: string } })?.body?.action === "detail").length;
const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} />
        <Route path="/jobs" element={<div>THE BOARD</div>} />
      </Routes>
    </MemoryRouter>,
  );
const settle = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const clearHead = () => {
  document.head.querySelectorAll('meta[name="robots"], meta[name="description"], script[type="application/ld+json"], link[rel="canonical"], title').forEach((n) => n.remove());
};

beforeEach(() => { invoke.mockReset(); clearBoardBudgetRefusal(); clearHead(); });
// Unmount FIRST: React owns the hoisted head tags it rendered and must remove
// them itself before the seeded ones are swept.
afterEach(() => { cleanup(); clearBoardBudgetRefusal(); clearHead(); });

describe("a posting page retracts only on the board's own answer", () => {
  it("the board's 404 is gone at once: noindex, no retry, no 'try again'", async () => {
    const { robots } = seedBakedHead();
    invoke.mockResolvedValue(httpError(404, { error: "Posting not found (it may have closed)" }));
    at(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: /no longer live/i })).toBeTruthy();
    await waitFor(() => expect(robots.getAttribute("content")).toBe("noindex"));
    await settle(1500);
    expect(detailCalls(), "the board's own 'not found' was retried as if it were a failure").toBe(1);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(jobEntities()).toEqual([]);
  });

  // A 404 is the row gone with no closure recorded (our cap, a dedupe exit, a
  // mistyped id); a description-only reply is a row we hide while the
  // employer still serves it. Neither is evidence about the employer's own
  // board, and the crawler-facing description said it was.
  for (const [what, reply] of [
    ["the board's bare 404", () => httpError(404, { error: "Posting not found (it may have closed)" })],
    ["a reply carrying only the employer's description", () => ({ data: { job: null, description: "Night shifts. ".repeat(30) }, error: null })],
  ] as const) {
    it(`${what} says the posting is no longer listed here, and nothing about the employer`, async () => {
      const { robots } = seedBakedHead();
      invoke.mockResolvedValue(reply());
      at(PATH);
      expect(await screen.findByRole("heading", { level: 1, name: /no longer live/i })).toBeTruthy();
      await waitFor(() => expect(robots.getAttribute("content")).toBe("noindex"));
      await waitFor(() => expect(descriptions().join(" | ")).toMatch(/No longer listed on this board/));
      expect(descriptions().join(" | "), "the crawler was told the employer's board dropped it").not.toMatch(/employer's own job board/);
      expect(document.body.textContent, "the page told the reader the employer's board dropped it").not.toMatch(/employer's own job board/);
      expect(document.body.textContent).toMatch(/says nothing about the employer/);
      expect(jobEntities()).toEqual([]);
    });
  }

  it("positive control: a closure the board watched still names the employer's board", async () => {
    const { robots } = seedBakedHead();
    invoke.mockResolvedValue({ data: { job: null, closed: { title: "Staff Nurse", company: "Acme Health", closedAt: new Date().toISOString() } }, error: null });
    at(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: /no longer live/i })).toBeTruthy();
    await waitFor(() => expect(robots.getAttribute("content")).toBe("noindex"));
    await waitFor(() => expect(descriptions().join(" | ")).toMatch(/no longer served by the employer's own job board/));
  });

  it("while loading, the baked head stands: its title, its description, its job markup", async () => {
    seedBakedHead();
    invoke.mockImplementation(() => new Promise(() => { /* never answers */ }));
    at(PATH);
    await screen.findByText(/Loading this posting/);
    await settle(50);
    expect(document.title, "a loading live posting was titled as gone").toBe(BAKED_TITLE);
    expect(jobEntities().length, "the baked JobPosting was stripped before any answer").toBe(1);
    expect(descriptions()).toEqual(["Staff Nurse at Acme Health in Leeds, from Acme Health's own job board."]);
  });

  it("after a failed read, the baked head stands and the page offers a retry", async () => {
    const { robots } = seedBakedHead();
    invoke.mockResolvedValue(httpError(503, { error: "unavailable" }));
    at(PATH);
    await screen.findByRole("button", { name: "Try again" }, { timeout: 4000 });
    expect(document.title).toBe(BAKED_TITLE);
    expect(jobEntities().length).toBe(1);
    expect(robots.getAttribute("content")).toBe("index, follow");
  });

  it("under a budget refusal, the baked head stands", async () => {
    const { robots } = seedBakedHead();
    invoke.mockResolvedValue(httpError(429, { error: "board_budget", code: "address", limit: 10000, used: 10000, resetAt: new Date(Date.now() + 3600_000).toISOString() }));
    at(PATH);
    await waitFor(() => expect(document.querySelector("[data-board-budget-notice]")).toBeTruthy());
    await settle(50);
    expect(document.title, "a refused read titled a live posting as gone").toBe(BAKED_TITLE);
    expect(jobEntities().length).toBe(1);
    expect(robots.getAttribute("content")).toBe("index, follow");
  });

  it("a posting whose pay we could not read says it is our reading, not the employer's statement", async () => {
    invoke.mockResolvedValue({ data: { job: row(), description: "Salary Range: $110,000-140,000. ".repeat(10) }, error: null });
    at(PATH);
    expect(await screen.findByText(/We found no pay figure on this posting/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/states no pay/);
  });
});
