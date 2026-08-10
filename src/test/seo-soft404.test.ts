/**
 * GSC FLAGGED "SOFT 404" (email 2026-08-07), AND IT WAS STRUCTURAL.
 *
 * Measured before the fix: every path on resumebooster.work returns HTTP 200
 * with the app shell (static SPA fallback, no per-URL status lever, Googlebot
 * gets byte-identical HTML — no dynamic rendering). A dead /jobs?job=<id> deep
 * link rendered "no longer live — it was filled or taken down" under a head
 * still saying index,follow with canonical=/jobs. ~27,000 postings were purged
 * in one day when their real dates arrived, and ~16k/day age out of the 30-day
 * window permanently — so the dead-URL stream is structural, not a one-off.
 *
 * Google's three sanctioned expiry signals are 404/410, noindex, and a past
 * validThrough. A static SPA can emit exactly two of them:
 *
 *   noindex, injected at render time on dead states — discovered when Google
 *   re-renders each orphaned URL;
 *
 *   validThrough on LIVE postings — the only signal that works in advance,
 *   picked up on routine recrawl before the URL ever dies. Ours is
 *   posted_at + 30d: not an invented company deadline but the board's own
 *   serving guarantee (FRESH_WINDOW_DAYS drops the posting at that instant),
 *   which is what keeps it inside the JSON-LD honesty fence.
 */
import { describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { markDeadForRobots, clearDeadForRobots } from "../lib/seo-robots";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

afterEach(() => clearDeadForRobots());

describe("the robots module actually mutates the head", () => {
  it("marks: injects exactly one noindex meta and sets the title", () => {
    markDeadForRobots("Posting no longer available — Resume Booster");
    markDeadForRobots("Posting no longer available — Resume Booster"); // idempotent
    const tags = document.querySelectorAll('meta[name="robots"][content="noindex"]');
    expect(tags.length).toBe(1);
    expect(document.title).toBe("Posting no longer available — Resume Booster");
  });

  it("clears: the flag is fully removed, so it can never leak onto a live view", () => {
    markDeadForRobots();
    clearDeadForRobots();
    expect(document.querySelectorAll('meta[name="robots"][content="noindex"]').length).toBe(0);
  });

  it("mark without a title leaves the title alone", () => {
    document.title = "Live board";
    markDeadForRobots();
    expect(document.title).toBe("Live board");
  });
});

describe("the dead-link state is wired to it", () => {
  const jobs = read("../pages/Jobs.tsx");

  it("Jobs.tsx marks on deadLink and restores on cleanup", () => {
    // The effect must be keyed on deadLink, mark inside it, and clear in its
    // cleanup — symmetric, so browsing onward from a dead link un-flags.
    const eff = jobs.slice(jobs.indexOf("if (!deadLink) return;"));
    expect(eff.slice(0, 400)).toMatch(/markDeadForRobots\(/);
    expect(eff.slice(0, 600)).toMatch(/return \(\) => \{ clearDeadForRobots\(\);/);
  });

  it("NotFound marks on mount and clears on unmount", () => {
    const nf = read("../pages/NotFound.tsx");
    expect(nf).toMatch(/markDeadForRobots\(\);/);
    expect(nf).toMatch(/return clearDeadForRobots;/);
  });
});

describe("the JobPosting markup carries the board's own expiry", () => {
  const jobs = read("../pages/Jobs.tsx");

  it("emits validThrough = postedAt + 30 days", () => {
    // 30 days is FRESH_WINDOW_DAYS — the serving window the board enforces.
    // If that constant ever changes, this must change with it or the markup
    // promises a lifetime the board no longer honors.
    expect(jobs).toMatch(/validThrough: new Date\(Date\.parse\(detailJob\.postedAt!\.slice\(0, 10\)\) \+ 30 \* 86_400_000\)/);
    const idx = readFileSync(
      resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
    expect(idx).toMatch(/const FRESH_WINDOW_DAYS = 30;/);
  });

  it("derives it from the RAW postedAt, not the clamped datePosted", () => {
    // The clamp exists because Workday date-only stamps can parse as future
    // UTC midnights; validThrough must track the true serving window instead,
    // so an already-old posting gets a PAST validThrough — which Google reads
    // as expired, and which is true.
    const block = jobs.slice(jobs.indexOf("validThrough:"), jobs.indexOf("validThrough:") + 200);
    expect(block).not.toMatch(/datePosted/);
  });

  it("still invents no salary and no company deadline fields", () => {
    const ldStart = jobs.indexOf('"@type": "JobPosting"');
    const ldBlock = jobs.slice(ldStart, jobs.indexOf("document.createElement", ldStart));
    expect(ldBlock).not.toMatch(/baseSalary|applicationDeadline/);
  });
});
