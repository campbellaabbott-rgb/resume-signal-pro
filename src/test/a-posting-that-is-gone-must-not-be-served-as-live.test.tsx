// A POSTING THAT IS GONE MUST NOT BE SERVED AS LIVE — AND THE PAGE, NOT ONLY
// THE HELPER, HAS TO BE THE THING THAT REFUSES.
//
// The pure gates are tested next door. This file tests the WIRING, because the
// wiring is where a correct helper gets called on the wrong branch, or not
// called at all, and everything still type-checks.
//
// WHY IT MATTERS MORE HERE THAN ANYWHERE ELSE ON THE SITE. A posting page is
// prerendered as a static file at build time and then sits there. The posting
// behind it can be withdrawn an hour later; roughly sixteen thousand a day age
// out of the board's window. This host offers no per-URL status code, so the
// page itself is the only thing that can retract the claim: it has to notice
// the posting is gone, say so, drop the job markup (one of the sanctioned ways
// to withdraw a posting — Google does not allow an expired one to be marked up)
// and stop the URL being indexed.
//
// AND IT MUST NOT ADD A SECOND CRAWL DIRECTIVE TO DO IT. The prerendered file
// already carries the template's own. Appending a contradictory one leaves the
// decision to whichever the crawler resolves first, on the exact page we have
// decided should not be indexed at all. That defect has shipped here before, in
// the first draft of the sitemap parity guard.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

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

const ID = "workday:acme~wd3~Careers:JR1";
const PATH = "/jobs/posting/workday/acme~wd3~Careers/JR1";
const SITE = "https://resumebooster.work";
const DESC = "We are hiring a staff nurse for our Leeds site. ".repeat(12);

const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  title: "Staff Nurse",
  company: "Acme Health",
  location: "Leeds",
  country: "GB",
  workMode: null,
  token: "acme~wd3~Careers",
  // Dated far enough back to be real and near enough to be inside the window.
  postedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  missingSince: null,
  applyUrl: "https://acme.example/jobs/JR1",
  salary: null,
  ...over,
});

/** The crawl directive a prerendered file already ships, so the page has one to rewrite. */
function seedRobotsTag() {
  const m = document.createElement("meta");
  m.name = "robots";
  m.content = "index, follow";
  document.head.appendChild(m);
  return m;
}

/**
 * THE REST OF WHAT A PRERENDERED FILE SHIPS — and leaving it out is how this
 * guard passed over a broken takeover. It seeded only the robots meta, so
 * `expect(jobEntities()).toEqual([])` was asserted against an empty head and
 * could not tell a page that REMOVES the baked markup from one that never had
 * any. Meanwhile the bake wrote its JSON-LD with no id at all while the page
 * removed by id, so in production a live posting ended up with two JobPosting
 * entities and a stale one kept the baked entity under a heading saying the
 * posting was gone — an expired posting still marked up, which this file's own
 * docblock says is not allowed.
 *
 * Seeded the way the bake writes it: the JobPosting block under the shared id,
 * and the WebSite and BreadcrumbList blocks beside it with none, because those
 * are not the page's to touch and a takeover that clears the head wholesale
 * would be a different defect.
 */
function seedPrerenderedHead(over: Record<string, unknown> = {}) {
  const add = (data: Record<string, unknown>, id?: string) => {
    const s = document.createElement("script");
    s.type = "application/ld+json";
    if (id) s.id = id;
    s.textContent = JSON.stringify(data);
    document.head.appendChild(s);
    return s;
  };
  add({ "@context": "https://schema.org", "@type": "WebSite", name: "Resume Booster" });
  const job = add({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Staff Nurse",
    url: `${SITE}${PATH}`,
    description: "Baked at build time, hours or days before this page was opened.",
    ...over,
  }, LD_TAG_ID);
  add({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [] });
  return job;
}

const otherEntities = () =>
  [...document.head.querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => { try { return JSON.parse(s.textContent || ""); } catch { return null; } })
    .filter((d) => d && d["@type"] !== "JobPosting")
    .map((d) => d["@type"]);

const robotsTags = () => [...document.head.querySelectorAll('meta[name="robots"]')];
const jobEntities = () =>
  [...document.head.querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => { try { return JSON.parse(s.textContent || ""); } catch { return null; } })
    .filter((d) => d && d["@type"] === "JobPosting");

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} />
        <Route path="/jobs/posting/:id" element={<JobPosting />} />
        <Route path="/jobs" element={<div>THE BOARD</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  invoke.mockReset();
  document.head.querySelectorAll('meta[name="robots"], script[type="application/ld+json"]').forEach((n) => n.remove());
});
afterEach(() => {
  document.head.querySelectorAll('meta[name="robots"], script[type="application/ld+json"]').forEach((n) => n.remove());
});

describe("a live posting is served as itself", () => {
  it("renders the employer's own title, place and description, and links the apply on their site", async () => {
    invoke.mockResolvedValue({ data: { job: row(), description: DESC }, error: null });
    at(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "Staff Nurse" })).toBeTruthy();
    expect(screen.getAllByText(/Acme Health/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Leeds/).length).toBeGreaterThan(0);
    expect(screen.getByText(/We are hiring a staff nurse/)).toBeTruthy();
    const apply = screen.getByRole("link", { name: /Apply on Acme Health/ });
    expect(apply.getAttribute("href")).toBe("https://acme.example/jobs/JR1");
  });

  it("puts exactly one job entity in the head, addressed to this page", async () => {
    // Seeded as the bake writes it, so "one entity" means the page TOOK OVER
    // the baked block rather than adding a second beside it. Without the seed
    // this assertion passed whether the takeover worked or not.
    seedPrerenderedHead({ description: "The baked copy, from an earlier build." });
    invoke.mockResolvedValue({ data: { job: row(), description: DESC }, error: null });
    at(PATH);
    await waitFor(() => expect(jobEntities().length).toBe(1));
    expect(jobEntities()[0].description, "the baked block survived instead of being replaced")
      .toContain("staff nurse");
    expect(otherEntities()).toEqual(["WebSite", "BreadcrumbList"]);
    expect(jobEntities()[0].url).toBe(`${SITE}${PATH}`);
    expect(jobEntities()[0].title).toBe("Staff Nurse");
  });

  it("says the employer stated no pay rather than showing a figure it does not have", async () => {
    invoke.mockResolvedValue({ data: { job: row(), description: DESC }, error: null });
    at(PATH);
    expect(await screen.findByText(/states no pay/)).toBeTruthy();
    await waitFor(() => expect(jobEntities().length).toBe(1));
    expect(jobEntities()[0].baseSalary).toBeUndefined();
  });

  it("does not tell a seeker an agency posting came from the employer's own system", async () => {
    // The sentence is categorical — "never an aggregator, never a repost" —
    // and the board flags staffing agencies on every row and discloses them
    // with a badge. On an agency row the claim is false and the name above it
    // is the agency's. A claim we cannot make is omitted.
    invoke.mockResolvedValue({ data: { job: row({ agency: true }), description: DESC }, error: null });
    at(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "Staff Nurse" })).toBeTruthy();
    expect(screen.queryByText(/never an aggregator/)).toBeNull();
    // Everything the employer DID state is still there.
    expect(screen.getByText(/We are hiring a staff nurse/)).toBeTruthy();
  });

  it("keeps the sentence for a posting that really did come from the employer", async () => {
    invoke.mockResolvedValue({ data: { job: row({ agency: false }), description: DESC }, error: null });
    at(PATH);
    expect(await screen.findByText(/never an aggregator/)).toBeTruthy();
  });

  it("prints the employer's pay verbatim when they stated one", async () => {
    invoke.mockResolvedValue({ data: { job: row({ salary: "£30,000 - £34,000" }), description: DESC }, error: null });
    at(PATH);
    expect(await screen.findByText(/£30,000 - £34,000/)).toBeTruthy();
  });
});

describe("a posting that is gone is retracted, not shown", () => {
  for (const [what, over] of [
    ["the employer's feed stopped serving it", { missingSince: new Date().toISOString() }],
    ["the board's window has closed on it", { postedAt: new Date(Date.now() - 400 * 86_400_000).toISOString() }],
    ["the board no longer holds the row at all", null],
  ] as const) {
    it(`says so, carries no job markup and refuses indexing when ${what}`, async () => {
      const tag = seedRobotsTag();
      // The head as the bake left it: a live JobPosting entity, baked hours
      // ago, which this page has to REMOVE and not merely decline to add.
      seedPrerenderedHead();
      invoke.mockResolvedValue({
        data: over ? { job: row(over), description: DESC } : { job: null, description: null },
        error: null,
      });
      const view = at(PATH);
      expect(await screen.findByRole("heading", { level: 1, name: /no longer live/i })).toBeTruthy();
      // No entity at all — not a flagged one, and not the baked one left
      // standing beside the "no longer live" heading.
      await waitFor(() => expect(jobEntities()).toEqual([]));
      // And the blocks that are not ours are untouched.
      expect(otherEntities()).toEqual(["WebSite", "BreadcrumbList"]);
      // One directive, and it is the refusal.
      await waitFor(() => expect(tag.getAttribute("content")).toBe("noindex"));
      expect(robotsTags().length, "a second crawl directive was appended beside the first").toBe(1);
      // And it is symmetrical: leaving this URL must not leave the flag behind
      // on whatever the same tab renders next.
      view.unmount();
      expect(tag.getAttribute("content")).toBe("index, follow");
    });
  }

  it("clears an UNTAGGED baked entity too, because an older bake wrote one without an id", async () => {
    // The id is the contract with the bake and the bake keeps it now. A file
    // written before it did — or served from a cache — carries a JobPosting
    // block with no id, and leaving that standing on a retracted posting is
    // the whole defect. Anything in the head claiming to be a JobPosting is
    // this page's to clear.
    const untagged = document.createElement("script");
    untagged.type = "application/ld+json";
    untagged.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: "Staff Nurse" });
    document.head.appendChild(untagged);
    invoke.mockResolvedValue({ data: { job: row({ missingSince: new Date().toISOString() }), description: DESC }, error: null });
    at(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: /no longer live/i })).toBeTruthy();
    await waitFor(() => expect(jobEntities()).toEqual([]));
  });

  it("leaves a LIVE posting's crawl directive exactly as the file shipped it", async () => {
    const tag = seedRobotsTag();
    invoke.mockResolvedValue({ data: { job: row(), description: DESC }, error: null });
    at(PATH);
    await waitFor(() => expect(jobEntities().length).toBe(1));
    expect(tag.getAttribute("content")).toBe("index, follow");
    expect(robotsTags().length).toBe(1);
  });
});

describe("an id pasted whole still lands on the posting's one canonical URL", () => {
  it("redirects the compatibility URL to the three-segment address and asks the board once", async () => {
    invoke.mockResolvedValue({ data: { job: row(), description: DESC }, error: null });
    at(`/jobs/posting/${ID}`);
    // It resolves to the posting, not to a second page for the same posting:
    // two URLs both serving one job is the duplicate shape the reference tells
    // us to collapse with a canonical, and the simplest collapse is to have one.
    expect(await screen.findByRole("heading", { level: 1, name: "Staff Nurse" })).toBeTruthy();
    await waitFor(() => expect(jobEntities().length).toBe(1));
    expect(jobEntities()[0].url).toBe(`${SITE}${PATH}`);
  });

  it("sends an unreadable id back to the board rather than rendering a page about nothing", async () => {
    at("/jobs/posting/not-an-id");
    expect(await screen.findByText("THE BOARD")).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
  });
});
