// A SAVED JOB YOU CANNOT FIND ON THE BOARD.
//
// The board already knew which postings you had saved and which you had
// applied to — savedIds/appliedIds drive the bookmark state and the "Applied"
// check — and which you had opened, in rb_viewed_jobs, which dims a visited
// title. None of it was usable as a VIEW: there was no way to see just your
// saved jobs, and no way to get the ones you had already read or applied to
// off the screen. LinkedIn My Jobs, Indeed Saved and Hiring.cafe all have this.
//
// Two things make it more than a filter:
//
//  1. IT MUST COST NOTHING. All three id sets are already in memory (the
//     tracker read) or in this device's localStorage, so the views narrow the
//     rows already loaded and issue no request.
//
//  2. WHICH IS EXACTLY WHY THE EMPTY STATE IS THE HARD PART. Because it
//     narrows the PAGE, an empty Saved view does not mean an empty tracker,
//     and saying so is the difference between a filter and a page that looks
//     like it lost the user's saved jobs.
//
// Pinned against comment-stripped source — a guard literal sitting in a
// comment has passed while the code was dead five times in this repo.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const RAW = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const JOBS = strip(RAW);

describe("a saved job you cannot find on the board", () => {
  it("all three views narrow the loaded list, in the same place the dismissals do", () => {
    expect(JOBS).toMatch(/if \(savedOnly\) list = list\.filter\(\(j\) => savedIds\.has\(j\.id\)\);/);
    expect(JOBS).toMatch(/if \(hideApplied\) list = list\.filter\(\(j\) => !appliedIds\.has\(j\.id\)\);/);
    expect(JOBS).toMatch(/if \(hideViewed\) list = list\.filter\(/);
    // Derived state must recompute when any of its inputs move, or a toggle
    // renders as pressed over a list that never changed.
    const deps = JOBS.match(/savedOnly, hideViewed, hideApplied, savedIds, appliedIds, viewedIds, detailJob\?\.id\]\)/);
    expect(deps, "the memo must depend on every set it reads").not.toBeNull();
  });

  it("the posting being read is exempt from hide-viewed", () => {
    // openDetail writes the id into viewedIds the instant a card is clicked, so
    // without the exemption the row the reader just opened vanishes from the
    // list behind the panel they are reading.
    expect(JOBS).toMatch(/if \(hideViewed\) list = list\.filter\(\(j\) => !viewedIds\.has\(j\.id\) \|\| j\.id === detailJob\?\.id\);/);
  });

  it("hide-viewed reuses the existing device record and stores nothing new", () => {
    // The brief allowed inventing a tracking mechanism only if it was declared.
    // Nothing was invented: rb_viewed_jobs already existed to dim visited
    // titles, and this feature only reads it. If a new key ever appears here,
    // this test is where someone has to say what it stores.
    expect(JOBS).toMatch(/localStorage\.getItem\("rb_viewed_jobs"/);
    const written = [...RAW.matchAll(/localStorage\.setItem\("([^"]+)"/g)].map((m) => m[1]).sort();
    expect([...new Set(written)]).toEqual([
      "rb_board_last_visit", "rb_board_oriented", "rb_board_welcomed",
      "rb_density", "rb_dismissed_jobs", "rb_recent_jobs",
      "rb_recent_searches", "rb_viewed_jobs",
    ]);
  });

  it("an empty Saved view says which of two different things happened", () => {
    // Nothing saved at all is a "here is how" moment. Postings saved but none
    // of them on this page is a page-scope limit — and it has to name the real
    // number and point at the place that holds them all, or a client-side
    // filter reads as "your saved jobs are gone".
    expect(JOBS).toMatch(/savedOnly && displayJobs\.length === 0 &&/);
    expect(JOBS).toMatch(/savedIds\.size === 0/);
    expect(JOBS).toMatch(/t\("jobsPage\.savedViewEmptyNone"/);
    expect(JOBS).toMatch(/t\("jobsPage\.savedViewEmptyPage", "[^"]*\{\{n\}\}[^"]*", \{ n: savedIds\.size \}\)/);
    expect(JOBS, "the way out of a page-scoped empty state").toMatch(/t\("jobsPage\.savedViewOpenTracker"/);
    expect(JOBS).toMatch(/<Link to="\/account"/);
    // And the hide-toggles get their own, distinct, honest line.
    expect(JOBS).toMatch(/!savedOnly && \(hideViewed \|\| hideApplied\) && displayJobs\.length === 0 &&/);
    expect(JOBS).toMatch(/t\("jobsPage\.hideEmpty"/);
  });

  it("the Saved tooltip states the page scope rather than implying the whole board", () => {
    // The Actively-hiring tooltip had to be corrected for exactly this: it
    // implied it filtered the board when it filters the rows already fetched.
    const tip = RAW.match(/t\("jobsPage\.savedViewTip", "([^"]+)"/)?.[1] ?? "";
    expect(tip).toContain("already loaded on this page");
    expect(tip).toContain("rather than re-searching the whole board");
  });

  it("no control is rendered that could never change the list", () => {
    // A signed-out visitor has no tracker and a first arrival has opened
    // nothing; a dead toggle is worse than no toggle, and on this page it also
    // costs mobile fold.
    expect(JOBS).toMatch(/\{session && \(\s*<button[\s\S]{0,400}?setSavedOnly/);
    expect(JOBS).toMatch(/\{viewedIds\.size > 0 && \(/);
    expect(JOBS).toMatch(/\{session && appliedIds\.size > 0 && \(/);
  });

  it("a view is not a filter: none of it reaches the request body", () => {
    // boardFilterBody is this page's one answer to "is the board filtered", and
    // activeBoardFilterKeys derives the chip row from it. A local view leaking
    // in would put a chip on screen the reader never set and cannot clear.
    const body = JOBS.slice(JOBS.indexOf("export function boardFilterBody"), JOBS.indexOf("export function activeBoardFilterKeys"));
    for (const k of ["savedOnly", "hideViewed", "hideApplied", "savedIds", "appliedIds", "viewedIds"]) {
      expect(body, `${k} must not reach the request body`).not.toContain(k);
    }
  });

  it("every new string is translated in all nine locales", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    const keys = [
      "savedView", "savedViewTip", "savedViewEmptyNone", "savedViewEmptyPage",
      "savedViewOpenTracker", "hideViewed", "hideViewedTip", "hideApplied",
      "hideAppliedTip", "hideEmpty",
    ];
    for (const f of files) {
      const j = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as { jobsPage?: Record<string, unknown> };
      for (const k of keys) {
        const v = j.jobsPage?.[k];
        expect(typeof v, `${f}: jobsPage.${k}`).toBe("string");
        expect(String(v).trim().length, `${f}: jobsPage.${k} must be a real translation`).toBeGreaterThan(0);
      }
      // `n`, not i18next's `count`: passing `count` selects a plural form, and
      // these strings have no _one/_other variants to select.
      expect(String(j.jobsPage?.savedViewEmptyPage), `${f}: the real number is interpolated`).toContain("{{n}}");
      expect(String(j.jobsPage?.savedViewEmptyPage), `${f}: no plural selector`).not.toContain("{{count}}");
    }
  });
});
