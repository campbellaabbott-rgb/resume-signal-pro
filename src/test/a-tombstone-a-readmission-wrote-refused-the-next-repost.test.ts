import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DATE_MOVES_AFTER_INSERT,
  REDATE_MARGIN_MS,
  splitTombstoned,
  type Tombstone,
} from "../../supabase/functions/job-board/tombstone.ts";
import { codeOf } from "./helpers/strip-comments";

/**
 * A TOMBSTONE THAT A RE-ADMISSION WROTE REFUSED THE NEXT REPOST (SNOWFLAKE-3).
 *
 * Three ashby:snowflake postings published 2026-10-06 20:59-21:07Z were never
 * stored, though the reads at 02:05Z and 19:54Z the next day stored neighbours
 * published half an hour later. The one id-level refusal on that path is the
 * aged-out tombstone. The first hypothesis was a tombstone with no date; no
 * writer can produce one (the seed and the sweep write effective_posted of rows
 * selected by effective_posted < cutoff, and a re-admission writes the date it
 * just parsed). What CAN refuse a fresh, dated posting is a tombstone holding a
 * date INSIDE the window: a re-admission moves the tombstone to the feed's date
 * (n412), and if that row then leaves by a closure or a prune, the same id
 * published again within REDATE_MARGIN_MS of that date, or on the same date,
 * was refused until it aged out. The NULL case is handled too, from aged_at.
 */
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();
const START = Date.parse("2026-10-01T06:00:00Z");

/**
 * One board, one id, a visit a day, the same three rules index.ts applies:
 * ingest splits new rows with splitTombstoned at this pass's cutoff; a
 * re-admitted row's tombstone moves to its date once stored; the sweep deletes
 * rows past the window and tombstones only ids with no tombstone yet. `close`
 * removes the stored row on that day the way a closure or a prune does: no
 * tombstone is written.
 */
function simulate(opts: {
  id?: string;
  feedDate: (day: number) => string | null;
  tombstone: Omit<Tombstone, "id">;
  days: number;
  close?: (day: number) => boolean;
  listed?: (day: number) => boolean;
  enrich?: (stored: string | null) => string | null;
}) {
  const id = opts.id ?? "ashby:snowflake:66eeda70";
  const source = id.split(":")[0];
  const tombs = new Map<string, Tombstone>([[id, { id, ...opts.tombstone }]]);
  let stored: { posted_at: string | null } | null = null;
  const entries: number[] = [];
  for (let d = 0; d < opts.days; d++) {
    const now = START + d * DAY;
    const cutoff = now - 30 * DAY;
    if (stored && opts.close?.(d)) stored = null;
    const feed = opts.feedDate(d);
    const listed = opts.listed ? opts.listed(d) : true;
    const datedOld = feed !== null && Date.parse(feed) < cutoff;
    if (listed && !stored && !datedOld) {
      const row = { id, source, posted_at: feed };
      const { readmitted, refused } = splitTombstoned([row], [...tombs.values()], { cutoffMs: cutoff });
      if (!refused.has(id)) {
        stored = { posted_at: row.posted_at };
        entries.push(d);
        if (readmitted.length) tombs.set(id, { ...tombs.get(id)!, posted_at: row.posted_at });
      }
    }
    if (stored && opts.enrich) stored.posted_at = opts.enrich(stored.posted_at);
    if (stored && stored.posted_at !== null && Date.parse(stored.posted_at) < cutoff) {
      if (!tombs.has(id)) tombs.set(id, { id, posted_at: stored.posted_at, aged_at: iso(now) });
      stored = null;
    }
  }
  return { entries, stored: stored !== null, tombstone: tombs.get(id)! };
}

describe("a posting re-admitted once, then closed, comes back when the employer posts it again", () => {
  // Aged out in September on its August date; Ashby re-dates it on 10-02
  // (re-admitted, tombstone moved to 10-02); the employer unlists it on 10-04
  // (a closure: deleted, no tombstone); it is published again on 10-04 21:00,
  // two and a half days after the date the tombstone now holds.
  const first = iso(START + 1 * DAY);
  const again = iso(START + 3 * DAY + 15 * 3_600_000);
  const feedDate = (d: number) => (d < 3 ? first : again);

  it("is stored again on the first read after the repost", () => {
    const r = simulate({
      feedDate, days: 10,
      tombstone: { posted_at: "2026-08-05T10:00:00.000Z", aged_at: "2026-09-05T03:00:00.000Z" },
      listed: (d) => d !== 3, close: (d) => d === 3,
    });
    expect(r.entries).toEqual([0, 4]);
    expect(r.stored).toBe(true);
    expect(r.tombstone.posted_at).toBe(again);
  });

  it("comes back on the same date too (unlisted for a day, then relisted unchanged)", () => {
    const r = simulate({
      feedDate: () => first, days: 10,
      tombstone: { posted_at: "2026-08-05T10:00:00.000Z", aged_at: "2026-09-05T03:00:00.000Z" },
      listed: (d) => d !== 3, close: (d) => d === 3,
    });
    expect(r.entries).toEqual([0, 4]);
  });

  it("the split alone: an in-window tombstone on Ashby lets a no-older date in, an older one stays out", () => {
    const cutoff = START - 30 * DAY;
    const t: Tombstone = { id: "ashby:x:1", posted_at: iso(START - 2 * DAY), aged_at: "2026-09-01T00:00:00Z" };
    const ok = splitTombstoned([{ id: "ashby:x:1", source: "ashby", posted_at: iso(START - DAY) }], [t], { cutoffMs: cutoff });
    expect(ok.readmitted.length).toBe(1);
    const older = splitTombstoned([{ id: "ashby:x:1", source: "ashby", posted_at: iso(START - 3 * DAY) }], [t], { cutoffMs: cutoff });
    expect([...older.refused]).toEqual(["ashby:x:1"]);
    // Without the pass's cutoff the module cannot tell a re-admission's date from an aged one: refused, as before.
    expect(splitTombstoned([{ id: "ashby:x:1", source: "ashby", posted_at: iso(START - DAY) }], [t]).refused.size).toBe(1);
  });
});

describe("the loops the tombstone closed stay closed", () => {
  it("a Workday row the filler re-dates older still comes back ONCE, not once a visit", () => {
    expect(DATE_MOVES_AFTER_INSERT.has("workday")).toBe(true);
    const startDate = iso(START - 60 * DAY);
    const listDate = (d: number) => iso(START - 5 * DAY + (d % 2) * 18 * 3_600_000);
    const r = simulate({
      id: "workday:acme~wd5~External:R-1", feedDate: listDate, days: 30,
      enrich: () => startDate, tombstone: { posted_at: startDate, aged_at: iso(START - 20 * DAY) },
    });
    expect(r.entries.length).toBe(1);
  });

  it("an undated row never comes back, whatever the tombstone holds", () => {
    for (const tombstone of [{ posted_at: "2014-05-23T00:00:00.000Z" }, { posted_at: null, aged_at: "2026-08-24T00:00:00Z" }, { posted_at: iso(START - DAY) }]) {
      const r = simulate({ id: "bamboohr:acme:5", feedDate: () => null, enrich: () => "2014-05-23T00:00:00.000Z", tombstone, days: 30 });
      expect(r.entries, JSON.stringify(tombstone)).toEqual([]);
    }
  });

  it("an aged tombstone still refuses the same old date and anything inside the margin", () => {
    const cutoff = START - 30 * DAY;
    const t: Tombstone = { id: "ashby:x:2", posted_at: iso(START - 40 * DAY), aged_at: iso(START - 10 * DAY) };
    // A date inside the window but within the margin of an AGED tombstone date cannot exist (it is past the cutoff);
    // the aged date itself is refused upstream by the freshness filter, and here by the split.
    expect(splitTombstoned([{ id: "ashby:x:2", source: "ashby", posted_at: iso(START - 40 * DAY + REDATE_MARGIN_MS) }], [t], { cutoffMs: cutoff }).refused.size).toBe(1);
  });
});

describe("a tombstone with no date", () => {
  const cutoff = START - 30 * DAY;
  const t: Tombstone = { id: "ashby:x:3", posted_at: null, aged_at: iso(START - 10 * DAY) };

  it("lets in a dated row newer than its write by more than the margin", () => {
    expect(splitTombstoned([{ id: "ashby:x:3", source: "ashby", posted_at: iso(START - DAY) }], [t], { cutoffMs: cutoff }).readmitted.length).toBe(1);
  });

  it("refuses a date inside the margin of its write, an undated row, and a tombstone with no write time", () => {
    expect(splitTombstoned([{ id: "ashby:x:3", source: "ashby", posted_at: iso(START - 8 * DAY) }], [t], { cutoffMs: cutoff }).refused.size).toBe(1);
    expect(splitTombstoned([{ id: "ashby:x:3", source: "ashby", posted_at: null }], [t], { cutoffMs: cutoff }).refused.size).toBe(1);
    expect(splitTombstoned([{ id: "ashby:x:3", source: "ashby", posted_at: iso(START - DAY) }], [{ id: "ashby:x:3", posted_at: null }], { cutoffMs: cutoff }).refused.size).toBe(1);
  });

  it("on Workday too, once: the re-admission gives the tombstone a date and the margin rule takes over", () => {
    const r = simulate({
      id: "workday:acme~wd5~External:R-2", days: 20,
      feedDate: (d) => iso(START - 4 * DAY + (d % 2) * 18 * 3_600_000),
      enrich: () => iso(START - 60 * DAY),
      tombstone: { posted_at: null, aged_at: iso(START - 9 * DAY) },
    });
    expect(r.entries.length).toBe(1);
  });
});

describe("index.ts hands the split what it needs", () => {
  const CODE = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8"));
  const at = CODE.indexOf("if (newRows.length > 0)");
  const ingest = CODE.slice(at, CODE.indexOf("const vanishedAll", at));

  it("reads the tombstone's write time and passes this pass's cutoff", () => {
    expect(ingest).toMatch(/\.select\("id, posted_at, aged_at"\)/);
    expect(ingest).toMatch(/splitTombstoned\(newRows, tombs, \{ cutoffMs: freshCutoffMs \}\)/);
  });
});
