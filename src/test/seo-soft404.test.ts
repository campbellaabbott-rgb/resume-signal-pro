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
import { postingValidThrough, type PostingRow } from "../components/jobs/posting-page";

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
  const posting = read("../components/jobs/posting-page.ts");
  const row = (postedAt: string) => ({ id: "greenhouse:acme:1", postedAt, missingSince: null }) as PostingRow;

  it("the pane writes the posting page's own markup, at its own ?job= address", () => {
    // One builder for every JobPosting this site writes (the trusted-pages
    // round, 2026-10-25): the pane's own block named the stored company and
    // marked any remote label as telework.
    expect(jobs).toMatch(/const baked = postingJsonLd\(detailJob, detailDesc, \{ site: "https:\/\/resumebooster\.work" \}\);/);
    expect(jobs).toMatch(/\.\.\.baked,\s*url: `https:\/\/resumebooster\.work\/jobs\?job=\$\{encodeURIComponent\(detailJob\.id\)\}`/);
  });

  it("validThrough is the end of the board's 30-day window", () => {
    // 30 days is FRESH_WINDOW_DAYS — the serving window the board enforces.
    // If that constant ever changes, the mirror must change with it or the
    // markup promises a lifetime the board no longer honors.
    expect(posting).toMatch(/export const BOARD_FRESH_WINDOW_DAYS = 30;/);
    expect(posting).toMatch(/validThrough: `\$\{validThrough\}T23:59:59\+00:00`/);
    const idx = readFileSync(
      resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
    expect(idx).toMatch(/const FRESH_WINDOW_DAYS = 30;/);
    expect(postingValidThrough(row("2026-10-01"), new Date("2026-10-05T12:00:00Z"))).toBe("2026-10-31");
  });

  it("an already-old posting gets a validThrough in the past", () => {
    // Google reads a past validThrough as expired, which is true: the board
    // drops the posting at the end of its window. Only an employer's
    // "tomorrow" is read as today (postingDatePosted), so a window never
    // spans more than 30 days between the markup's own two dates.
    const now = new Date("2026-10-20T12:00:00Z");
    expect(postingValidThrough(row("2026-09-01"), now)).toBe("2026-10-01");
    expect(postingValidThrough(row("2026-10-21"), now)).toBe("2026-11-19");
  });

  it("still invents no salary and no company deadline fields", () => {
    const paneStart = jobs.indexOf("const baked = postingJsonLd(");
    const paneBlock = jobs.slice(paneStart, jobs.indexOf("document.createElement", paneStart));
    expect(paneStart).toBeGreaterThan(0);
    expect(paneBlock).not.toMatch(/baseSalary|applicationDeadline/);
    const ldStart = posting.indexOf("export function postingJsonLd(");
    const ldBlock = posting.slice(ldStart, posting.indexOf("\n}\n", ldStart));
    expect(ldStart).toBeGreaterThan(0);
    expect(ldBlock.replace(/\/\/[^\n]*/g, "")).not.toMatch(/baseSalary|applicationDeadline/);
  });
});

