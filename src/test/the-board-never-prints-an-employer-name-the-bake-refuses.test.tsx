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
import { postingMarkupGate, postingNameVerdict } from "@/components/jobs/posting-page";
import { displayEmployer } from "@/lib/display-name";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

/**
 * ONLY A REFUSAL OF THE TEXT ITSELF BLANKS THE BOARD'S NAME (review of
 * 2026-11-15). The gate also refuses a name for reasons that say nothing about
 * whether a reader can use it: a name its board's tenant code spells
 * ("Abercrombie" on abercrombie~wd108~anf, 372 open roles), a generic word or
 * label. Those keep a posting out of the job markup, and the bake gives such a
 * row no page, but the board printed them on main: blanking them took the
 * employer, and the link to its company page, off 9,104 open roles' cards,
 * panes, sheets and AI hand-offs (168 names over 45,103 real pairs, 66 of them
 * refused only as a tenant code). Only a logo or colour caption, a file name,
 * a web, email or careers-site address is no name at all.
 */
const ABERCROMBIE = {
  id: "workday:abercrombie~wd108~anf:R1", title: "Store Manager", company: "Abercrombie",
  token: "abercrombie~wd108~anf", source: "workday", location: "Columbus, OH", country: "US", workMode: null,
  postedAt: at(2), missingSince: null, recheckedAt: new Date(Date.now() - 600_000).toISOString(),
  applyUrl: "https://abercrombie.wd108.myworkdayjobs.com/en-US/anf/job/Columbus-OH/Store-Manager_R1",
  salary: null, agency: false,
} satisfies ListingJob;

describe("a name the gate refuses for its board, not for its text, is printed as main printed it", () => {
  it("the seam: a tenant code or a generic word keeps its name; a caption or an address does not", () => {
    // The gate still refuses it, so it is never a hiringOrganization.
    expect(postingNameVerdict(ABERCROMBIE).reason).toBe("tenant code");
    expect(postingMarkupGate(ABERCROMBIE, DESC)).toBeNull();
    expect(listingEmployer(ABERCROMBIE)).toBe("Abercrombie");
    // An Ashby board the catalogue names "Jobs" (turnkey): a generic word, printed as main printed it.
    const generic = { id: "ashby:turnkey:1", token: "turnkey", company: "Jobs" };
    expect(postingNameVerdict(generic).reason).toBe("generic word");
    expect(listingEmployer(generic)).toBe(displayEmployer(generic.token, generic.company).text);
    expect(listingEmployer(generic)).not.toBe("");
    expect(listingEmployer(CAPTION)).toBe("");
    expect(listingEmployer({ id: "oracle:emqk~ca3~CX_1:107235", token: "emqk~ca3~CX_1", company: "HealthCareersInSask.ca" })).toBe("");
    expect(listingEmployer({ id: "recruitee:bodymasters:1", token: "bodymasters", company: "info@bodymasters.de" })).toBe("");
  });

  it("the card prints it, with its link", () => {
    render(<MemoryRouter><ul><JobCard job={ABERCROMBIE} ctx={{ surface: "board", density: "comfortable", hideEmployer: false, selected: false }} href="/x" /></ul></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Abercrombie" })).toBeTruthy();
  });

  it("the pane prints it in its header, with its link", () => {
    render(<MemoryRouter><PostingDetail job={ABERCROMBIE} surface="board" description={{ text: DESC, state: "loaded" }} onClose={() => {}} /></MemoryRouter>);
    const header = document.querySelector("[data-posting-header]") as HTMLElement;
    expect(within(header).getByRole("link", { name: "Abercrombie" })).toBeTruthy();
  });

  it("the AI hand-off carries the name the card prints", () => {
    const jobs = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
    expect(jobs).toMatch(/const handoffJobOf = \(job: BoardJob\): HandoffJob => \(\{[^}]*company: listingEmployer\(job\),/);
    expect(listingEmployer(ABERCROMBIE)).toBe("Abercrombie");
  });
});
