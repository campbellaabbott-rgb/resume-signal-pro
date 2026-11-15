// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://resumebooster.work/" }
/**
 * THE BOARD NEVER PRINTS AN EMPLOYER NAME THE BAKE REFUSES (SEO check
 * 2026-11-15, F11, the app's half).
 *
 * The baked posting page judges its employer's name with the bake's gate
 * (scripts/prerender-names.mjs): a logo caption such as "TRAILBORN MASTER
 * MONOGRAM ORANGE" is not printed and the page says no employer, and "Inova
 * Military" (Inova's military site) prints as Inova. The /jobs card, the
 * detail pane, the phone sheet and the hydrated posting page asked
 * listingEmployer, which never asked that gate, so a reader saw the caption on
 * every one of them, and the posting page's own document title put it back in
 * the head a moment after the crawler's copy had left it out.
 *
 * Every surface is mounted here from the same rows, and the name each prints
 * is read from the page: the refused name nowhere, the repaired name where the
 * stored one stood.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "@/i18n";
import enListing from "@/i18n/shards/listing/en.json";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";
import { setLanderManifestForTests } from "@/lib/seo/lander-manifest";

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

const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

/** An ADP board named by its logo file's caption (the report's posting). */
const CAPTION = {
  id: "adp:b873581b-1203-4072-8b55-0d6dd9d414f5:9202017586566_8", title: "Front Desk Agent", company: "TRAILBORN MASTER MONOGRAM ORANGE",
  token: "b873581b-1203-4072-8b55-0d6dd9d414f5", source: "adp", location: "Denver, CO", country: "US", workMode: null,
  postedAt: at(2), missingSince: null, recheckedAt: new Date(Date.now() - 600_000).toISOString(),
  applyUrl: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=b873581b-1203-4072-8b55-0d6dd9d414f5&jobId=9202017586566_8",
  salary: null, agency: false,
} satisfies ListingJob;
const CAPTION_PATH = "/jobs/posting/adp/b873581b-1203-4072-8b55-0d6dd9d414f5/9202017586566_8";
const CAPTION_WORDS = /trailborn|monogram/i;

/** Inova's military career site, named by its audience after its employer. */
const AUDIENCE = {
  id: "oracle:elar~us2~CX_14001:300000123", title: "Registered Nurse", company: "Inova Military",
  token: "elar~us2~CX_14001", source: "oracle", location: "Fairfax, VA", country: "US", workMode: null,
  postedAt: at(2), missingSince: null, recheckedAt: new Date(Date.now() - 600_000).toISOString(),
  applyUrl: "https://elar.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_14001/job/300000123",
  salary: null, agency: false,
} satisfies ListingJob;
const AUDIENCE_PATH = "/jobs/posting/oracle/elar~us2~CX_14001/300000123";

const DESC = "We are hiring for the front of house team: greet guests, take reservations and keep the lobby running through the evening shift. ".repeat(4);

beforeAll(() => { i18n.addResourceBundle("en", "translation", enListing, true, true); });
beforeEach(() => { invoke.mockReset(); clearBoardBudgetRefusal(); setLanderManifestForTests("*"); });
afterEach(() => { cleanup(); clearBoardBudgetRefusal(); });

it("the seam asks the bake's gate: a refused name is no name, a repaired one is printed repaired", () => {
  expect(listingEmployer(CAPTION)).toBe("");
  expect(listingEmployer({ id: "adp:07372372-77a5-45e9-8573-f67327c3c3ec:9201", token: null, company: "Group withMVSB wtag" })).toBe("");
  expect(listingEmployer(AUDIENCE)).toBe("Inova");
  // A name the gate passes is printed as before.
  expect(listingEmployer({ id: "workday:ms~wd5~external:JR1", token: "ms~wd5~external", company: "Ms" })).toBe("Morgan Stanley");
});

const mountPosting = (row: ListingJob, path: string) => {
  invoke.mockResolvedValue({ data: { job: row, description: DESC }, error: null });
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} /></Routes>
    </MemoryRouter>,
  );
};

describe("a logo caption is printed on no surface", () => {
  it("the card", () => {
    render(<MemoryRouter><ul><JobCard job={CAPTION} ctx={{ surface: "board", density: "comfortable", hideEmployer: false, selected: false }} href="/x" /></ul></MemoryRouter>);
    expect(screen.getByText("Front Desk Agent")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(CAPTION_WORDS);
  });

  it("the pane", () => {
    render(<MemoryRouter><PostingDetail job={CAPTION} surface="board" description={{ text: DESC, state: "loaded" }} onClose={() => {}} /></MemoryRouter>);
    expect(document.body.textContent).toContain("Front Desk Agent");
    expect(document.body.textContent).not.toMatch(CAPTION_WORDS);
  });

  it("the phone sheet", async () => {
    render(
      <MemoryRouter>
        <PostingSheet job={CAPTION} open onClose={() => {}}>
          <PostingDetail job={CAPTION} surface="sheet" description={{ text: DESC, state: "loaded" }} />
        </PostingSheet>
      </MemoryRouter>,
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).not.toMatch(CAPTION_WORDS);
  });

  it("the posting page: its body, its document title and its markup", async () => {
    mountPosting(CAPTION, CAPTION_PATH);
    await screen.findByRole("heading", { level: 1, name: "Front Desk Agent" });
    await waitFor(() => expect(document.title).toContain("Front Desk Agent"));
    expect(document.title).not.toMatch(CAPTION_WORDS);
    expect(document.body.textContent).not.toMatch(CAPTION_WORDS);
    const description = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
    expect(description).not.toMatch(CAPTION_WORDS);
    expect(document.head.innerHTML + document.body.innerHTML).not.toMatch(CAPTION_WORDS);
  });
});

describe("a site's audience label comes off the employer's name on every surface", () => {
  it("the card", () => {
    render(<MemoryRouter><ul><JobCard job={AUDIENCE} ctx={{ surface: "board", density: "comfortable", hideEmployer: false, selected: false }} href="/x" /></ul></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Inova" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Military/);
  });

  it("the pane", () => {
    render(<MemoryRouter><PostingDetail job={AUDIENCE} surface="board" description={{ text: DESC, state: "loaded" }} onClose={() => {}} /></MemoryRouter>);
    const header = document.querySelector("[data-posting-header]") as HTMLElement;
    expect(within(header).getByRole("link", { name: "Inova" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Military/);
  });

  it("the posting page and its document title", async () => {
    mountPosting(AUDIENCE, AUDIENCE_PATH);
    await screen.findByRole("heading", { level: 1, name: "Registered Nurse" });
    await waitFor(() => expect(document.title).toContain("Inova"));
    expect(document.title).not.toMatch(/Military/);
    expect(document.body.textContent).not.toMatch(/Military/);
  });
});
