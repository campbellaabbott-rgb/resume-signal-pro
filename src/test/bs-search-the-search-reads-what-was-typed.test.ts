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

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

let board: BoardList;
beforeAll(async () => { board = await bootBoardList(); });
beforeEach(() => board.reset());

/** Every text the search sent: search_jobs' p_q and every textSearch argument. */
const searched = () => [
  ...board.db.rpcArgs("search_jobs").map((a) => String(a.p_q ?? "")),
  ...board.db.queries.flatMap((q) => q.calls.filter(([m]) => m === "textSearch").map(([, a]) => String(a[1] ?? ""))),
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

  it("a caller's own remote filter keeps main's reading: nothing is struck", async () => {
    nurses();
    const r = await board.post({ action: "list", q: "no remote nurse", remote: true, limit: 20, groupSimilar: false });
    expect(r.excludedTerms).toBeUndefined();
  });
});

describe("S13-077: a word hyphened onto a work mode leaves with it", () => {
  it.each(["remote-first engineer", "remote-only engineer", "engineer remote-friendly", "fully-remote engineer"])("%s: lifted to the remote filter, 'engineer' searched, no NOT", async (q) => {
    nurses();
    const r = await board.post({ action: "list", q, limit: 20, groupSimilar: false });
    expect(r.intentFilters).toEqual(["remote"]);
    const s = searched();
    expect(s.length).toBeGreaterThan(0);
    for (const t of s) expect(t, t).not.toMatch(/(^|\s)-|-(\s|$)|first|only|friendly|fully/);
  });

  it("a trade term with a hyphen is searched, not lifted: remote-sensing analyst", async () => {
    nurses();
    const r = await board.post({ action: "list", q: "remote-sensing analyst", limit: 20, groupSimilar: false });
    expect(r.intentFilters).toBeUndefined();
  });
});

describe("S13-015: words no title holds search nothing, and the page says so", () => {
  it.each(["jobs near me", "near me", "jobs hiring near me"])("%s: no text search, 'search words' named as not applied", async (q) => {
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
});

describe("S13-014: a ZIP is no title word; it is dropped and named", () => {
  it.each(["nurse 94105", "94105 nurse", "nurse jobs near 10001-0001"])("%s: searches the role, names the ZIP as ignored", async (q) => {
    nurses();
    const r = await board.post({ action: "list", q, limit: 20, groupSimilar: false });
    const zip = /\d{5}(?:-\d{4})?/.exec(q)![0];
    expect(r.droppedTerms).toContain(zip);
    for (const t of searched()) expect(t).not.toContain(zip.slice(0, 5));
  });

  it("a number with a unit after it is a measurement, searched as typed: cdl 26000 lbs", async () => {
    nurses();
    const r = await board.post({ action: "list", q: "cdl 26000 lbs", limit: 20, groupSimilar: false });
    expect(r.droppedTerms ?? []).not.toContain("26000");
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
});

describe("S12-014: a short employer name routes the same in a cold isolate as in a warm one", () => {
  it.each([["ups", "UPS"], ["3m", "3M"], ["cvs", "CVS Health"]])("%s routes to %s with no employer list read yet", async (q, name) => {
    board.answer((x) => (x.table === "job_board_postings" ? { data: [row("workday:t:1", "Package Handler", { company: name })], error: null } : undefined));
    const r = await board.post({ action: "list", q, limit: 20, groupSimilar: false });
    expect(r.searchRoute).toBe("EMPLOYER");
    expect(r.companyMatched).toBe(name);
  });
});
