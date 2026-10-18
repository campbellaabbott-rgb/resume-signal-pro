/**
 * THE HOMEPAGE PRINTS ONLY THE ROWS, AND THE READ TIMES, THE BOARD WOULD.
 *
 * Review P4: Paylocity, Breezy and UKG move a posting's date when it is
 * edited, so a row from them cannot stand under "posted in the last 7 days";
 * the mockup's row 2 (Paylocity, "posted 7 days ago") is exactly that. An
 * undated row has no age to print either. Review P2: JobCard prints any
 * recheckedAt it is handed, so the homepage hands it one only where the
 * employer's fill-curve row says we read the whole board (feedReadStatable),
 * with the pd/wire guard's own two-board fixture: Acme read in full, Domino's
 * read in laps.
 */
import { describe, expect, it } from "vitest";
import { REDATING_SOURCES } from "@/lib/listing/age";
import type { ListingJob } from "@/lib/listing/types";
import {
  applyFeedReadGate,
  curveTokens,
  HOME_LIST_BODY,
  HOME_ROWS_MAX,
  HOME_ROWS_WINDOW_DAYS,
  selectHomeRows,
  withoutFeedRead,
} from "@/lib/home/rows";

const NOW = new Date("2026-10-18T12:00:00Z");
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

const row = (over: Partial<ListingJob> & { token: string }): ListingJob => ({
  id: `${over.source ?? "greenhouse"}:${over.token}:1`,
  source: "greenhouse",
  company: over.token,
  title: "Platform Engineer",
  location: "New York, NY",
  postedAt: iso(2 * DAY),
  recheckedAt: iso(4 * 60_000),
  missingSince: null,
  agency: false,
  ...over,
});

describe("which rows the homepage keeps", () => {
  it("asks the board for the newest week, without agency boards, once", () => {
    expect(HOME_LIST_BODY).toMatchObject({ action: "list", sort: "newest", maxAgeDays: HOME_ROWS_WINDOW_DAYS, excludeAgencies: true, includeFacets: false, limit: 40 });
    expect(HOME_ROWS_WINDOW_DAYS).toBe(7);
  });

  it("drops every system that moves its dates (REDATING_SOURCES), even with a fresh date", () => {
    expect([...REDATING_SOURCES].sort()).toEqual(["breezy", "paylocity", "ukg"]);
    const jobs = [
      ...REDATING_SOURCES.map((s, i) => row({ token: `redate${i}`, source: s, id: `${s}:redate${i}:1`, postedAt: iso(0) })),
      row({ token: "acme" }),
    ];
    const kept = selectHomeRows(jobs, { now: NOW });
    expect(kept.map((j) => j.source)).toEqual(["greenhouse"]);
  });

  it("reads the system from the id when the source column is missing (a Paylocity id is still Paylocity)", () => {
    const j = row({ token: "sherwood", source: null, id: "paylocity:47b89897:3567447" });
    expect(selectHomeRows([j], { now: NOW })).toEqual([]);
  });

  it("drops undated rows, rows older than the window, gone rows and agency rows", () => {
    const jobs = [
      row({ token: "undated", postedAt: null }),
      row({ token: "badDate", postedAt: "soon" }),
      row({ token: "old", postedAt: iso((HOME_ROWS_WINDOW_DAYS + 1) * DAY) }),
      row({ token: "gone", missingSince: iso(DAY) }),
      row({ token: "agency", agency: true }),
      row({ token: "edge", postedAt: iso(HOME_ROWS_WINDOW_DAYS * DAY) }),
    ];
    expect(selectHomeRows(jobs, { now: NOW }).map((j) => j.token)).toEqual(["edge"]);
  });

  it("keeps one row per employer, by board and by printed name, newest first, at most five", () => {
    const jobs = [
      row({ token: "a", title: "One" }),
      row({ token: "a", id: "greenhouse:a:2", title: "Two" }),
      row({ token: "b" }),
      row({ token: "c", company: "B" }),
      row({ token: "d" }), row({ token: "e" }), row({ token: "f" }), row({ token: "g" }),
    ];
    const kept = selectHomeRows(jobs, { now: NOW });
    expect(kept.map((j) => j.token)).toEqual(["a", "b", "d", "e", "f"]);
    expect(kept).toHaveLength(HOME_ROWS_MAX);
    expect(kept[0].title).toBe("One");
  });

  it("an empty or broken reply keeps nothing", () => {
    expect(selectHomeRows(null, { now: NOW })).toEqual([]);
    expect(selectHomeRows([{ id: "" } as ListingJob, { id: "x:y:1", title: "" } as ListingJob], { now: NOW })).toEqual([]);
  });
});

describe("the feed-read stamp is said only of a board we read in full", () => {
  const FULL = row({ token: "acme", company: "Acme" });
  const LAPS = row({ token: "dominos", company: "Domino's", title: "Delivery Driver" });
  const curve = (token: string, bucket: string, feed_state?: string | null) => ({ company_token: token, observability_bucket: bucket, feed_state });

  it("asks the fill curve for the kept boards only, once each", () => {
    expect(curveTokens([FULL, LAPS, row({ token: "acme", id: "greenhouse:acme:9" })])).toEqual(["acme", "dominos"]);
  });

  it("keeps the read time on the full-read board and drops it on the lap-read board", () => {
    const [full, laps] = applyFeedReadGate([FULL, LAPS], [curve("acme", "full_read"), curve("dominos", "lap_proven")]);
    expect(full.recheckedAt).toBe(FULL.recheckedAt);
    expect(laps.recheckedAt).toBeNull();
  });

  it("drops it for every lap bucket, for a full read whose newest feed failed, and for a board the curve did not return", () => {
    for (const bucket of ["lap_proven", "lap_pending", "unprovable"]) {
      expect(applyFeedReadGate([FULL], [curve("acme", bucket)])[0].recheckedAt).toBeNull();
    }
    expect(applyFeedReadGate([FULL], [curve("acme", "full_read", "error")])[0].recheckedAt).toBeNull();
    expect(applyFeedReadGate([FULL], [curve("acme", "full_read", "empty")])[0].recheckedAt).toBe(FULL.recheckedAt);
    expect(applyFeedReadGate([FULL], [])[0].recheckedAt).toBeNull();
  });

  it("before the curve answers (or when it never does) no row carries a stamp", () => {
    expect(applyFeedReadGate([FULL, LAPS], null).every((j) => j.recheckedAt === null)).toBe(true);
    expect(withoutFeedRead([FULL, LAPS]).every((j) => j.recheckedAt === null)).toBe(true);
  });

  it("never mutates the board's rows", () => {
    const before = JSON.stringify(FULL);
    applyFeedReadGate([FULL], [curve("acme", "lap_proven")]);
    expect(JSON.stringify(FULL)).toBe(before);
  });
});
