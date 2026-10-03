import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  REDATE_MARGIN_MS,
  redatedPastTombstone,
  splitTombstoned,
  type Tombstone,
} from "../../supabase/functions/job-board/tombstone.ts";
import { normalizeWorkday, sanePostedAt } from "../../supabase/functions/job-board/normalize.ts";
import { codeOf } from "./helpers/strip-comments";

/**
 * AN ID IS STABLE; ITS DATE IS NOT.
 *
 * The aged-out tombstone was built on "an ATS posting id and its posting date
 * are both stable". Ashby breaks the second half: re-publishing a posting keeps
 * its id and moves publishedAt. Of 424 ids present in both the 2026-08-07
 * Wayback snapshot of the openai feed and the live feed on 2026-10-03, 49 had
 * a later publishedAt. A posting we stored past day 30 was tombstoned on its
 * old date, and when the employer re-dated it into the window the tombstone
 * refused it for 180 days. After .85 deployed, verify-deploy 7i read
 * ashby:snowflake at 105 served against 118 in-window on its own feed; all 13
 * missing ids had no row at all and every one was published before the
 * board's last read. openai was missing 7, inside the ±10% band.
 *
 * Two of those seven, as the snapshot and the live feed state them, are the
 * fixtures below.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const CODE = codeOf(FN);
const MOD = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/tombstone.ts"), "utf8"));
const NOTES = readFileSync(resolve(ROOT, "docs/job-board-index-notes.md"), "utf8");
const DEPLOY = readFileSync(resolve(ROOT, "docs/job-board-deploy-notes.md"), "utf8");

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

// ashby:openai, 2026-08-07 snapshot -> 2026-10-03 live feed.
const VENDOR_MANAGER = { id: "ashby:openai:1dade0fb-23c9-4a85-927e-9e8030826303", old: "2026-07-29T17:08:04.619+00:00", now: "2026-09-24T09:29:39.783+00:00" };
const GTM_STRATEGY = { id: "ashby:openai:08e8d03a-df94-46af-8664-cd9aab1af445", old: "2026-07-30T00:16:49.149+00:00", now: "2026-09-15T23:35:25.732+00:00" };

afterEach(() => { vi.useRealTimers(); });

describe("redatedPastTombstone", () => {
  it("lets in the openai postings Ashby re-dated after we aged them out", () => {
    for (const p of [VENDOR_MANAGER, GTM_STRATEGY]) {
      // The tombstone records the date the row aged out on; the row arrives
      // from ingest carrying sanePostedAt of the feed's publishedAt.
      expect(redatedPastTombstone(sanePostedAt(p.now, Date.parse("2026-10-03T17:00:00Z")), p.old), p.id).toBe(true);
    }
  });

  it("never lets in an undated row: that is the bamboohr/rippling loop the tombstone closed", () => {
    expect(redatedPastTombstone(null, "2014-05-23T00:00:00.000Z")).toBe(false);
    expect(redatedPastTombstone(undefined, "2014-05-23T00:00:00.000Z")).toBe(false);
    expect(redatedPastTombstone("", "2014-05-23T00:00:00.000Z")).toBe(false);
  });

  it("refuses when the tombstone holds no readable date — nothing to be newer than", () => {
    expect(redatedPastTombstone(VENDOR_MANAGER.now, null)).toBe(false);
    expect(redatedPastTombstone(VENDOR_MANAGER.now, "not a date")).toBe(false);
    expect(redatedPastTombstone("not a date", VENDOR_MANAGER.old)).toBe(false);
  });

  it("refuses the same date, an earlier date, and anything inside the margin", () => {
    const t = Date.parse("2026-08-01T12:00:00Z");
    expect(redatedPastTombstone(iso(t), iso(t))).toBe(false);
    expect(redatedPastTombstone(iso(t - DAY), iso(t))).toBe(false);
    expect(redatedPastTombstone(iso(t + REDATE_MARGIN_MS), iso(t))).toBe(false);
    expect(redatedPastTombstone(iso(t + REDATE_MARGIN_MS + 1), iso(t))).toBe(true);
  });

  it("does not read Workday's fetch-clock jitter as a re-date (the real normaliser, two reads a day apart)", () => {
    // normalizeWorkday dates "Posted N Days Ago" as fetch time minus N days,
    // so the same unchanged posting read at 00:30 and again at 23:50 the next
    // day lands almost a whole day later. That must stay refused.
    const item = { title: "Analyst", locationsText: "Cleveland, OH", externalPath: "/job/Cleveland/Analyst_R-1" };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T00:30:00Z"));
    const [first] = normalizeWorkday([{ ...item, postedOn: "Posted 3 Days Ago" }] as never, "Acme", "acme~wd5~External");
    vi.setSystemTime(new Date("2026-09-11T23:50:00Z"));
    const [second] = normalizeWorkday([{ ...item, postedOn: "Posted 4 Days Ago" }] as never, "Acme", "acme~wd5~External");
    expect(first.id).toBe(second.id);
    const drift = Date.parse(second.postedAt!) - Date.parse(first.postedAt!);
    expect(drift).toBeGreaterThan(20 * 3_600_000);
    expect(drift).toBeLessThan(REDATE_MARGIN_MS);
    expect(redatedPastTombstone(second.postedAt, first.postedAt)).toBe(false);
    // A genuine Workday repost ("Posted Today" on a row tombstoned on its old date) does walk in.
    const [reposted] = normalizeWorkday([{ ...item, postedOn: "Posted Today" }] as never, "Acme", "acme~wd5~External");
    expect(redatedPastTombstone(reposted.postedAt, iso(Date.parse(first.postedAt!) - 30 * DAY))).toBe(true);
  });
});

describe("splitTombstoned", () => {
  it("refuses, re-admits, and leaves alone rows that were never tombstoned", () => {
    const rows = [
      { id: VENDOR_MANAGER.id, posted_at: VENDOR_MANAGER.now },
      { id: GTM_STRATEGY.id, posted_at: GTM_STRATEGY.old },
      { id: "bamboohr:acme:5", posted_at: null },
      { id: "ashby:openai:never-aged", posted_at: "2026-10-02T00:00:00.000Z" },
    ];
    const tombs: Tombstone[] = [
      { id: VENDOR_MANAGER.id, posted_at: VENDOR_MANAGER.old },
      { id: GTM_STRATEGY.id, posted_at: GTM_STRATEGY.old },
      { id: "bamboohr:acme:5", posted_at: "2014-05-23T00:00:00.000Z" },
    ];
    const { refused, readmitted } = splitTombstoned(rows, tombs);
    expect(readmitted.map((r) => r.id)).toEqual([VENDOR_MANAGER.id]);
    expect([...refused].sort()).toEqual(["bamboohr:acme:5", GTM_STRATEGY.id].sort());
    expect(refused.has("ashby:openai:never-aged")).toBe(false);
    // The caller moves the tombstone to the row's own date, so it must be the row object itself.
    expect(readmitted[0]).toBe(rows[0]);
  });

  it("with no tombstones it touches nothing", () => {
    const { refused, readmitted } = splitTombstoned([{ id: "a", posted_at: "2026-10-01T00:00:00Z" }], []);
    expect(refused.size).toBe(0);
    expect(readmitted).toEqual([]);
  });

  it("is pure — no reads, no writes, no clock", () => {
    expect(MOD).not.toMatch(/\bfetch\(|\.from\(|Date\.now\(|import /);
  });
});

/**
 * THE LOOP THE TOMBSTONE CLOSED MUST STAY CLOSED.
 *
 * A model of one board over a month of visits, applying the same three rules
 * index.ts does (each pinned in the next block): ingest splits new rows with
 * splitTombstoned; a re-admitted row's tombstone moves to the row's date once
 * it is stored; the sweep deletes rows past the window and tombstones only ids
 * with no tombstone yet. `enrich` stands for the description filler, which on
 * Workday replaces the list date with the detail's startDate.
 */
function simulate(opts: {
  feedDate: (day: number) => string | null;
  enrich?: (stored: string | null) => string | null;
  tombstone: { posted_at: string | null };
  days: number;
  start: number;
  moveTombstone?: boolean;
  sweepOverwrites?: boolean;
}) {
  const id = "v:board:1";
  const tombs = new Map<string, Tombstone>([[id, { id, ...opts.tombstone }]]);
  let stored: { posted_at: string | null } | null = null;
  let entries = 0;
  for (let d = 0; d < opts.days; d++) {
    const now = opts.start + d * DAY;
    const cutoff = now - 30 * DAY;
    // Visit: the shared freshness filter, then the tombstone split.
    const feed = opts.feedDate(d);
    const dated = feed !== null && Date.parse(feed) < cutoff;
    if (!stored && !dated) {
      const row = { id, posted_at: feed };
      const { readmitted, refused } = splitTombstoned([row], [...tombs.values()]);
      if (!refused.has(id)) {
        stored = { posted_at: row.posted_at };
        entries++;
        if (readmitted.length && opts.moveTombstone !== false) tombs.set(id, { id, posted_at: row.posted_at });
      }
    }
    // The filler, then the pass-end sweep.
    if (stored && opts.enrich) stored.posted_at = opts.enrich(stored.posted_at);
    if (stored && stored.posted_at !== null && Date.parse(stored.posted_at) < cutoff) {
      if (!tombs.has(id) || opts.sweepOverwrites) tombs.set(id, { id, posted_at: stored.posted_at });
      stored = null;
    }
  }
  return { entries, tombstone: tombs.get(id)!.posted_at };
}

describe("over a month of visits", () => {
  const start = Date.parse("2026-10-03T06:00:00Z");

  it("an Ashby re-date comes back once and stays", () => {
    const r = simulate({ start, days: 30, feedDate: () => VENDOR_MANAGER.now, tombstone: { posted_at: VENDOR_MANAGER.old } });
    expect(r.entries).toBe(1);
    expect(r.tombstone).toBe(VENDOR_MANAGER.now);
  });

  it("an undated row never comes back (the 2026-08-24 loop)", () => {
    const r = simulate({ start, days: 30, feedDate: () => null, enrich: () => "2014-05-23T00:00:00.000Z", tombstone: { posted_at: "2014-05-23T00:00:00.000Z" } });
    expect(r.entries).toBe(0);
  });

  it("a Workday row the filler re-dates older comes back ONCE, not once a visit", () => {
    // The list dates the posting five days before the first visit, read off
    // the fetch clock, so alternate visits land up to 18h apart; the detail's
    // startDate says two months.
    const startDate = iso(start - 60 * DAY);
    const listDate = (d: number) => iso(start - 5 * DAY + (d % 2) * 18 * 3_600_000);
    const visitsInWindow = Array.from({ length: 30 }, (_, d) => d).filter((d) => Date.parse(listDate(d)) >= start + d * DAY - 30 * DAY).length;
    expect(visitsInWindow).toBeGreaterThan(20);
    const guarded = simulate({ start, days: 30, feedDate: listDate, enrich: () => startDate, tombstone: { posted_at: startDate } });
    expect(guarded.entries).toBe(1);
    // Why each guard is there: without the tombstone move, or with a sweep
    // that writes the older stored date back over it, the row re-enters on
    // every visit while its list date is in the window — a fresh first_seen
    // each time, the churn n099 removed.
    expect(simulate({ start, days: 30, feedDate: listDate, enrich: () => startDate, tombstone: { posted_at: startDate }, moveTombstone: false }).entries).toBe(visitsInWindow);
    expect(simulate({ start, days: 30, feedDate: listDate, enrich: () => startDate, tombstone: { posted_at: startDate }, sweepOverwrites: true }).entries).toBe(visitsInWindow);
  });

  it("a posting the employer re-dates twice comes back twice", () => {
    const second = iso(start + 40 * DAY);
    const r = simulate({ start, days: 60, feedDate: (d) => (d < 40 ? VENDOR_MANAGER.now : second), tombstone: { posted_at: VENDOR_MANAGER.old } });
    expect(r.entries).toBe(2);
    expect(r.tombstone).toBe(second);
  });
});

describe("index.ts applies those rules", () => {
  const ingestAt = CODE.indexOf("if (newRows.length > 0)");
  const ingest = CODE.slice(ingestAt, CODE.indexOf("const vanishedAll", ingestAt));

  it("ingest reads the tombstone's date and splits with the shared rule", () => {
    expect(CODE).toMatch(/import \{ splitTombstoned, type Tombstone \} from "\.\/tombstone\.ts";/);
    expect(ingest).toMatch(/\.select\("id, posted_at"\)/);
    expect(ingest).toMatch(/const verdict = splitTombstoned\(newRows, tombs\);/);
    expect(ingest).toMatch(/const blocked = verdict\.refused;/);
    expect(ingest).toMatch(/readmitted = verdict\.readmitted;/);
    // A failed read still degrades to "insert everything", never to an empty board.
    expect(ingest).toMatch(/aged-out check skipped/);
  });

  it("a re-admitted tombstone moves only after the insert has landed", () => {
    const insertAt = CODE.indexOf('from("job_board_postings").upsert(newRows.slice(i, i + 250)', ingestAt);
    const failAt = CODE.indexOf("if (!boardOk) {", insertAt);
    const moveAt = CODE.indexOf("if (readmitted.length > 0) {", failAt);
    const nextAt = CODE.indexOf("const truncatedFetch", failAt);
    expect(insertAt).toBeGreaterThan(ingestAt);
    expect(failAt).toBeGreaterThan(insertAt);
    expect(moveAt, "the move must follow the insert's failure exit, or a failed insert locks the row out on a date it never held").toBeGreaterThan(failAt);
    expect(moveAt).toBeLessThan(nextAt);
    const move = CODE.slice(moveAt, nextAt);
    expect(move).toMatch(/from\("job_board_aged_out"\)\.upsert\(\s*readmitted\.map\(/);
    expect(move).toMatch(/posted_at: r\.posted_at/);
    expect(move).toMatch(/onConflict: "id"/);
  });

  it("the sweep never writes an older date over an existing tombstone", () => {
    const s = CODE.indexOf("const untombstoned = agedRows.filter((r) => !alreadyTombstoned.has(String(r.id)));");
    expect(s, "the sweep tombstones only ids with no tombstone yet").toBeGreaterThan(0);
    const upsert = CODE.slice(s, CODE.indexOf("const oversizeHeld", s));
    expect(upsert).toMatch(/from\("job_board_aged_out"\)\.upsert\(\s*untombstoned\.map\(/);
    expect(upsert).not.toMatch(/agedRows\.map/);
    // And the set it filters on is read from the table before the loop.
    expect(CODE.lastIndexOf("const alreadyTombstoned = new Set<string>();", s)).toBeGreaterThan(0);
  });
});

describe("the record", () => {
  it("names the rule where the code points", () => {
    expect(FN.match(/job-board-index-notes\.md#n412-redated-past-tombstone/g)?.length).toBeGreaterThanOrEqual(2);
    expect(/^## n412-redated-past-tombstone$/m.test(NOTES), "docs/job-board-index-notes.md has no n412 section").toBe(true);
  });

  it("shipped as .87 or later, with a deploy note", () => {
    // A later bump keeps this rule; the note for the version that introduced it must stay.
    expect(CODE).toMatch(/const BUILD_VERSION = "2026-09-09\.(8[7-9]|9\d|\d{3,})"/);
    expect(/^## 2026-09-09\.87$/m.test(DEPLOY), "docs/job-board-deploy-notes.md has no .87 entry").toBe(true);
  });
});
