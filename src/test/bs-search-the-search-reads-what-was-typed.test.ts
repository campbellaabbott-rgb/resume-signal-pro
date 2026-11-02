// @vitest-environment node
/**
 * THE SEARCH READS WHAT WAS TYPED (S12-017, S13-013, S13-077, S13-015,
 * S13-014, S12-014), through the shipped handler with its database faked.
 *
 * Measured live on job-board.2026-09-09.96, 2026-11-01:
 *   - 'no remote nurse' and 'non-remote nurse' served a page of remote
 *     nursing jobs, nothing said ("Triage Nurse | Remote");
 *   - 'remote-first engineer' searched '-first engineer', a NOT in websearch;
 *   - 'jobs near me' served unrelated description matches under total 2;
 *   - 'nurse 94105' served nurses from Okmulgee and Dubai, the ZIP unnamed;
 *   - supervisor -"team lead" excluded 'team' and searched 'lead"';
 *   - 'cvs pharmacist' answered 1 job in some isolates (the router's live keys
 *     were per isolate).
 * Each is asked here of the handler, and its answer read as the page reads it.
 * Corpora (main against this branch, every case): board-stream-2026-11-01/
 * corpora/search/ (n1410-n1418).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootBoardList, calls, row, type BoardList } from "./helpers/board-list";
import { NEGATED_REMOTE_IN_TITLE, titleExcluded } from "../../supabase/functions/job-board/search-routing";
import { NEGATED_REMOTE_SOURCE } from "../../supabase/functions/job-board/normalize";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let board: BoardList;
beforeAll(async () => { board = await bootBoardList(); });
beforeEach(() => board.reset());

/** Every text the search sent: search_jobs' p_q and every textSearch argument (not the ZIP held check's one-id read). */
const searched = () => [
  ...board.db.rpcArgs("search_jobs").map((a) => String(a.p_q ?? "")),
  ...board.db.queries.filter((q) => !(calls(q, "select", "id") && calls(q, "limit", 1) && q.calls.some(([m, a]) => m === "textSearch" && /^\d{5}$/.test(String(a[1]))))).flatMap((q) => q.calls.filter(([m]) => m === "textSearch").map(([, a]) => String(a[1] ?? ""))),
];
const nurses = () => board.answer((q) => (q.rpc === "search_jobs" || (q.table === "job_board_postings" && calls(q, "textSearch"))
  ? { data: [row("greenhouse:h:1", "Triage Nurse | Remote"), row("greenhouse:h:2", "Registered Nurse"), row("greenhouse:h:3", "Nurse Practitioner (Remote)")], error: null }
  : undefined));

describe("S13-013: a negated remote strikes the remote reading", () => {
  it.each(["no remote nurse", "non-remote nurse", "nurse not remote"])("%s: the remote words leave the search and the remote titles are struck, said on the page", async (q) => {
    nurses();
    const r = await board.post({ action: "list", q, limit: 20, groupSimilar: false });
    expect(r.excludedTerms).toEqual(["remote"]);
    expect(searched().join(" | ")).not.toMatch(/remote|\bno\b|\bnon\b/i);
    expect((r.jobs as Array<{ title: string }>).map((j) => j.title)).toEqual(["Registered Nurse"]);
  });

  it.each([
    ["Staff Accountant I (Not Remote)", "Staff Accountant I (Not Remote)"],
    ["analyst non-remote", "Data Analyst - Non-Remote"],
    ["billing specialist not a remote position", "Billing Specialist (No Remote)"],
  ])("%s: a title that itself says it is not remote is the posting asked for, and is kept (n1411)", async (q, kept) => {
    board.answer((x) => (x.rpc === "search_jobs" || (x.table === "job_board_postings" && calls(x, "textSearch"))
      ? { data: [row("ukg:w:1", kept), row("ukg:w:2", "Remote Billing Analyst")], error: null }
      : undefined));
    const r = await board.post({ action: "list", q, limit: 20, groupSimilar: false });
    expect(r.excludedTerms).toEqual(["remote"]);
    expect((r.jobs as Array<{ title: string }>).map((j) => j.title)).toEqual([kept]);
  });

  it("a caller's own remote filter keeps main's reading: nothing is struck", async () => {
    nurses();
    const r = await board.post({ action: "list", q: "no remote nurse", remote: true, limit: 20, groupSimilar: false });
    expect(r.excludedTerms).toBeUndefined();
  });
});

describe("the remote exclusion reads past a title's own negation (n1411)", () => {
  it("strikes a title that offers remote, and keeps one that refuses it, whoever typed the exclusion", () => {
    expect(titleExcluded("Remote Nurse", ["remote"])).toBe(true);
    expect(titleExcluded("Nurse - Remote (Not Remote in CA)", ["remote"])).toBe(true);
    for (const t of ["Staff Accountant I (Not Remote)", "Analyst, Non-Remote", "Clerk - No Remote", "Nurse (not fully remote)"]) expect(titleExcluded(t, ["remote"]), t).toBe(false);
    expect(titleExcluded("Staff Accountant I (Not Remote)", ["accountant"])).toBe(true);
  });

  it("reads the negation by the pattern the work-mode reader uses, copied byte for byte into a file that imports nothing", () => {
    expect(NEGATED_REMOTE_IN_TITLE.source).toBe(NEGATED_REMOTE_SOURCE);
    expect(NEGATED_REMOTE_IN_TITLE.flags).toBe("gi");
  });
});

describe("S13-077: a word hyphened onto a work mode leaves with it", () => {
  it.each(["remote-first engineer", "remote-only engineer", "engineer remote-friendly"])("%s: lifted to the remote filter, 'engineer' searched, no NOT", async (q) => {
    nurses();
    const r = await board.post({ action: "list", q, limit: 20, groupSimilar: false });
    expect(r.intentFilters).toEqual(["remote"]);
    const s = searched();
    expect(s.length).toBeGreaterThan(0);
    for (const t of s) expect(t, t).not.toMatch(/(^|\s)-|-(\s|$)|first|only|friendly|fully/);
  });

  it.each([
    ["medical coder-remote", ["medical", "coder"], "remote"],
    ["nurse practitioner-hybrid", ["nurse", "practitioner"], "hybrid"],
    ["registered nurse-onsite", ["registered", "nurse"], "onsite"],
    ["rn-remote", ["rn"], "remote"],
    ["fully-remote engineer", ["fully", "engineer"], "remote"],
  ])("%s: the word the mode is hyphened onto stays searched, only the hyphen goes (n1412)", async (q, words, mode) => {
    nurses();
    const r = await board.post({ action: "list", q, limit: 20, groupSimilar: false });
    expect(r.intentFilters).toEqual([mode]);
    const s = searched();
    expect(s.length).toBeGreaterThan(0);
    for (const t of s) expect(t, t).not.toMatch(/(^|\s)-|-(\s|$)/);
    for (const w of words) expect(s.join(" | ").toLowerCase(), `${q} lost "${w}"`).toMatch(new RegExp(`\\b${w}`));
  });

  it("a trade term with a hyphen is searched, not lifted: remote-sensing analyst", async () => {
    nurses();
    const r = await board.post({ action: "list", q: "remote-sensing analyst", limit: 20, groupSimilar: false });
    expect(r.intentFilters).toBeUndefined();
  });
});

describe("S13-015: a search for places near the searcher searches no words, and the page says so", () => {
  it.each(["jobs near me", "near me", "jobs hiring near me", "jobs nearby", "openings around me"])("%s: no text search, 'search words' named as not applied", async (q) => {
    nurses();
    const r = await board.post({ action: "list", q, limit: 20, groupSimilar: false });
    expect(searched()).toEqual([]);
    expect(r.ignoredFilters).toContain("q");
  });

  it("a filler word beside a real one is dropped as before: 'nurse jobs near me' searches nurse", async () => {
    nurses();
    const r = await board.post({ action: "list", q: "nurse jobs near me", limit: 20, groupSimilar: false });
    expect(r.ignoredFilters ?? []).not.toContain("q");
    expect(searched().join(" ")).toMatch(/nurse/);
  });

  // Live .96: "career" 7,616 title matches (Career Advisor, Career Coach), "employment" 996, "opening" 1,953 (recheck, 2026-11-01).
  it.each(["career", "careers", "employment", "opening", "opportunity", "hiring", "vacancy", "jobs", "career opportunities", "employment opportunities", "jobs for me"])(
    "%s: a filler-only query that asks for no place near the searcher keeps main's title search", async (q) => {
      nurses();
      const r = await board.post({ action: "list", q, limit: 20, groupSimilar: false });
      expect(r.ignoredFilters ?? []).not.toContain("q");
      expect(searched().length).toBeGreaterThan(0);
    });
});

describe("S13-014: a number no stored title holds is a ZIP; it is dropped and named, and one a title holds is searched (n1414)", () => {
  /** The held check: one id from title_tsv for the number. `held` lists the numbers some stored title carries. */
  const titlesHold = (held: string[], fail = false) => board.answer((x) => {
    const n = x.table === "job_board_postings" && calls(x, "select", "id") && x.calls.find(([m, a]) => m === "textSearch" && /^\d{5}$/.test(String(a[1])));
    if (!n) return undefined;
    if (fail) return { data: null, error: { message: "canceling statement due to statement timeout" } };
    return { data: held.includes(String(n[1][1])) ? [{ id: "x:1" }] : [], error: null };
  });
  it.each(["nurse 94105", "94105 nurse", "nurse jobs near 10001-0001"])("%s: searches the role, names the ZIP as ignored", async (q) => {
    titlesHold([]);
    nurses();
    const r = await board.post({ action: "list", q, limit: 20, groupSimilar: false });
    const zip = /\d{5}(?:-\d{4})?/.exec(q)![0];
    expect(r.droppedTerms).toContain(zip);
    for (const t of searched()) expect(t).not.toContain(zip.slice(0, 5));
  });

  it.each(["ISO 13485 auditor", "auditor iso 27001", "Store Manager - (09760)", "IATF 16949 quality engineer"])("%s: a title holds the number, so it is searched as typed, as on main", async (q) => {
    titlesHold(["13485", "27001", "09760", "16949"]);
    nurses();
    const r = await board.post({ action: "list", q, limit: 20, groupSimilar: false });
    const n = /\d{5}/.exec(q)![0];
    expect(r.droppedTerms ?? []).not.toContain(n);
    expect(searched().join(" | ")).toContain(n);
  });

  it("a held check that fails keeps the number, as main reads it", async () => {
    titlesHold([], true);
    nurses();
    const r = await board.post({ action: "list", q: "nurse 94105", limit: 20, groupSimilar: false });
    expect(r.droppedTerms ?? []).not.toContain("94105");
  });

  it("a number with a unit after it is a measurement, searched as typed and never checked: cdl 26000 lbs", async () => {
    titlesHold([]);
    nurses();
    const r = await board.post({ action: "list", q: "cdl 26000 lbs", limit: 20, groupSimilar: false });
    expect(r.droppedTerms ?? []).not.toContain("26000");
  });

  it("a number that is all there is stays the search, as on main: 94105", async () => {
    titlesHold([]);
    nurses();
    const r = await board.post({ action: "list", q: "94105", limit: 20, groupSimilar: false });
    expect(r.droppedTerms ?? []).not.toContain("94105");
  });
});

describe("S12-017: a quoted phrase is excluded whole, and a requirement verb is not the excluded word", () => {
  it('supervisor -"team lead": the phrase is excluded, no quote is searched', async () => {
    board.answer((q) => (q.rpc === "search_jobs" || (q.table === "job_board_postings" && calls(q, "textSearch"))
      ? { data: [row("greenhouse:a:1", "Team Lead Supervisor"), row("greenhouse:a:2", "Supervisor, Lead Generation"), row("greenhouse:a:3", "Team-Lead Supervisor")], error: null }
      : undefined));
    const r = await board.post({ action: "list", q: 'supervisor -"team lead"', limit: 20, groupSimilar: false });
    expect(r.excludedTerms).toEqual(["team lead"]);
    for (const t of searched()) expect(t).not.toMatch(/"|team|lead/);
    expect((r.jobs as Array<{ title: string }>).map((j) => j.title)).toEqual(["Supervisor, Lead Generation"]);
  });

  it("nurse not requiring travel: 'travel' is excluded, 'requiring' is neither excluded nor searched", async () => {
    nurses();
    const r = await board.post({ action: "list", q: "nurse not requiring travel", limit: 20, groupSimilar: false });
    expect(r.excludedTerms).toEqual(["travel"]);
    for (const t of searched()) expect(t).not.toMatch(/requir|travel/);
  });

  // A participle follows its noun ("CDL not required"), so the next word is not its object: main's one-word reading (recheck, 2026-11-01).
  it.each([
    ["cdl not required driver", ["required"], /driver/],
    ["experience not needed warehouse", ["needed"], /warehouse/],
    ["degree not included nurse", ["included"], /nurse/],
  ])("%s: the participle is excluded, as on main, and the next word is still searched", async (q, ex, kept) => {
    nurses();
    const r = await board.post({ action: "list", q, limit: 20, groupSimilar: false });
    expect(r.excludedTerms).toEqual(ex);
    expect(searched().join(" | ")).toMatch(kept);
  });

  it("degree not required remote: the remote filter is still lifted and only 'required' is excluded, as on main", async () => {
    nurses();
    const r = await board.post({ action: "list", q: "degree not required remote", limit: 20, groupSimilar: false });
    expect(r.excludedTerms).toEqual(["required"]);
    expect(r.intentFilters).toContain("remote");
  });

  it("license not required part time: the part-time filter is still lifted, as on main", async () => {
    nurses();
    const r = await board.post({ action: "list", q: "license not required part time", limit: 20, groupSimilar: false });
    expect(r.excludedTerms).toEqual(["required"]);
    expect(r.excludedTerms).not.toContain("part");
  });
});

describe("S12-014: a short employer name routes the same in a cold isolate as in a warm one", () => {
  it.each([["ups", "UPS"], ["3m", "3M"], ["cvs", "CVS Health"]])("%s routes to %s with no employer list read yet", async (q, name) => {
    board.answer((x) => (x.table === "job_board_postings" ? { data: [row("workday:t:1", "Package Handler", { company: name })], error: null } : undefined));
    const r = await board.post({ action: "list", q, limit: 20, groupSimilar: false });
    expect(r.searchRoute).toBe("EMPLOYER");
    expect(r.companyMatched).toBe(name);
  });
});
