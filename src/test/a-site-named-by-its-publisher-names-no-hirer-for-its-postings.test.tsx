/**
 * A SITE NAMED BY ITS PUBLISHER NAMES NO HIRER FOR ITS POSTINGS.
 *
 * trust/pages named LCS's two Oracle career sites (eexs~us2~CX_3001 "All Jobs"
 * and eexs~us2~CX_11009 "All Community Jobs") after LCS, the employer that
 * publishes them: lcsliving.com links them as "Work for LCS". The company page
 * is right to print LCS. Its postings are another matter. The review read the
 * live detail of oracle:eexs~us2~CX_3001:41168 (Part Time Caregiver, Kalamazoo
 * MI): its text says "Friendship Village is seeking a compassionate and
 * energetic Caregiver", the catalogue carries Friendship Village Kalamazoo as a
 * board of its own (eexs~us2~CX_14027), six of eight postings read in full
 * never mention LCS, and the requisitions state no legal employer. Yet with the
 * override, main's name gate passed "LCS" and postingJsonLd marked the posting
 * up with hiringOrganization LCS, where the old name "All" had withheld it.
 *
 * So a site named by its publisher is a board in the multi-employer style: the
 * board's own surfaces print the publisher, and a posting names no hirer. It
 * gets no posting page of its own (as a USAJOBS row does not), postingEmployer
 * names nobody, and no JobPosting is written for it anywhere: not by the bake,
 * not by the posting page after hydration, not by the board's detail pane.
 * Each case below runs beside a control on a board that names its hirer, so a
 * refusal is shown to come from the board, not from a field the row lacks.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
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

import Jobs from "../pages/Jobs";
import * as postingPage from "../components/jobs/posting-page";
import * as companyDisplay from "../lib/company-display";
import { postingRowEligible } from "../../scripts/prerender-pages.mjs";
import {
  EMPLOYER_NAME_OVERRIDES,
  PUBLISHER_ONLY_BOARDS,
  boardDisplayName,
  boardNamesItsHirer,
  employerDisplayName,
} from "../lib/employer-names";

vi.setConfig(MOUNT_TEST_BUDGET);

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const LCS_ALL = "eexs~us2~CX_3001";
const LCS_COMMUNITY = "eexs~us2~CX_11009";
const HONEYWELL = "icfcjb~ocs~CX_1";

/** The live row the review read (2026-10-25), dated two days back so it is live whenever this runs. */
const LCS_ROW = {
  id: `oracle:${LCS_ALL}:41168`, source: "oracle", token: LCS_ALL, company: "LCS",
  title: "Part Time - Caregiver - Assisted Living - Third Shift (10:30p-6:30a)",
  location: "Kalamazoo, MI, United States", country: "US", remote: false, workMode: null,
  employmentType: null, department: null, category: "healthcare",
  postedAt: ago(2), lastSeen: ago(1), recheckedAt: ago(0), missingSince: null,
  applyUrl: `https://eexs.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_3001/job/41168`,
  salary: "$16.00 per hour", salaryMinAnnual: null, salaryMaxAnnual: null, salaryPeriod: "hour", salaryCurrency: "USD",
  experienceBand: null, minYears: null, agency: false,
};
/** The posting's own words: they name the community, never LCS. */
const LCS_TEXT = "Friendship Village’s mission is to facilitate vibrant senior living in a Life-Care community. We strive to create a community where people want to live, work, and visit.\n\nFriendship Village is seeking a compassionate and energetic Caregiver.";
/** The control: the same row on a board whose name is its hirer's. */
const CONTROL_ROW = { ...LCS_ROW, id: `oracle:${HONEYWELL}:99123249`, token: HONEYWELL, company: "Honeywell Aerospace", applyUrl: "https://icfcjb.fa.ocs.oraclecloud.com/x" };

const D = { ...postingPage, ...companyDisplay };
const SITE = "https://resumebooster.work";

describe("the two LCS sites are named by their publisher and name no hirer for their postings", () => {
  it("the list holds exactly the two LCS sites, each an override, and every other board names its hirer", () => {
    expect([...PUBLISHER_ONLY_BOARDS].sort()).toEqual([LCS_COMMUNITY, LCS_ALL]);
    for (const t of PUBLISHER_ONLY_BOARDS) {
      expect(EMPLOYER_NAME_OVERRIDES.has(t), `${t} must be an override key: the company page names the publisher`).toBe(true);
      expect(boardNamesItsHirer(t), t).toBe(false);
    }
    for (const t of [HONEYWELL, "recruiting~REG1001RWHM~3f9058a6-91f2-4cf1-bf33-bc76cb9f0522", "usajobs", "", null, undefined]) {
      expect(boardNamesItsHirer(t), String(t)).toBe(true);
    }
  });

  it("the board's own surfaces still print LCS: its company page, its facet chip and a card", () => {
    expect(boardDisplayName(LCS_ALL, "All")).toBe("LCS");
    expect(employerDisplayName(LCS_ALL, "All")).toBe("LCS");
    expect(companyDisplay.boardName(LCS_COMMUNITY, "All Community")).toBe("LCS");
  });

  it("the posting names no employer, where the control names its own", () => {
    expect(postingPage.postingEmployer(LCS_ROW)).toBe("");
    expect(postingPage.postingEmployer({ id: LCS_ROW.id, token: null, company: "LCS" }), "the token read from the id").toBe("");
    expect(postingPage.postingEmployer(CONTROL_ROW)).toBe("Honeywell Aerospace");
  });

  it("postingJsonLd writes no JobPosting for it, and does for the control", () => {
    expect(postingPage.postingJsonLd(LCS_ROW, LCS_TEXT, { site: SITE })).toBeNull();
    const ld = postingPage.postingJsonLd(CONTROL_ROW, LCS_TEXT, { site: SITE }) as { hiringOrganization?: { name?: string } } | null;
    expect(ld?.hiringOrganization?.name).toBe("Honeywell Aerospace");
  });

  it("the bake gives it no posting page of its own, and gives the control one", () => {
    expect(postingRowEligible(LCS_ROW, D)).toBe(false);
    expect(postingRowEligible({ ...LCS_ROW, token: LCS_COMMUNITY, id: `oracle:${LCS_COMMUNITY}:41168` }, D)).toBe(false);
    expect(postingRowEligible(CONTROL_ROW, D)).toBe(true);
  });
});

describe("the board's detail pane writes no JobPosting for a posting of an LCS site", () => {
  function mount(row: typeof LCS_ROW) {
    window.history.replaceState({}, "", `/jobs?job=${encodeURIComponent(row.id)}`);
    rpc.mockImplementation(async () => ({ data: [], error: null }));
    invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
      const b = o?.body ?? {};
      if (fn === "job-board" && b.action === "detail") return { data: { job: row, description: LCS_TEXT } };
      if (fn === "job-board" && b.action === "list") {
        if (b.facetCounts) return { data: { categories: {} } };
        if (b.countOnly) return { data: { total: 1 } };
        return { data: { jobs: [row], total: 1, totalAllCompanies: 1, companies: [], companiesCount: 1, categories: {}, failedSources: [], failedCount: 0, refreshedAt: null, hasMore: false } };
      }
      return { data: {} };
    });
    return render(<MemoryRouter><Jobs /></MemoryRouter>);
  }
  const tag = () => document.getElementById("job-posting-ld");
  const canonical = () => document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "";

  beforeEach(() => {
    document.head.innerHTML = '<link rel="canonical" href="https://resumebooster.work/jobs">';
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  it("the control's pane writes one, naming its employer", async () => {
    const v = mount(CONTROL_ROW);
    await waitFor(() => expect(document.body.textContent ?? "").toContain("Friendship Village is seeking"), SLOW);
    await waitFor(() => expect(tag()).not.toBeNull(), SLOW);
    expect(JSON.parse(tag()!.textContent ?? "{}").hiringOrganization?.name).toBe("Honeywell Aerospace");
    v.unmount();
  });

  it("the LCS posting's pane opens with its description (its canonical moves to it) and writes none", async () => {
    const v = mount(LCS_ROW);
    await waitFor(() => expect(document.body.textContent ?? "").toContain("Friendship Village is seeking"), SLOW);
    expect(canonical()).toContain(encodeURIComponent(LCS_ROW.id));
    expect(tag(), "a JobPosting naming the site's publisher as the hirer").toBeNull();
    v.unmount();
  });
});
