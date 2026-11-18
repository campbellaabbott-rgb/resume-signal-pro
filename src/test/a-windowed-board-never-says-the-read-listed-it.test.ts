/**
 * A WINDOWED BOARD NEVER SAYS THE READ LISTED IT.
 *
 * WHAT HAPPENED. The API4 design's open sentence was "Listed in the
 * employer's own system when we last read its board, {ago}" on every board.
 * A large board (Workday, Oracle) is read a window at a time, and its stamp
 * says when we read part of the board, not that the read listed this posting
 * (public-api/last-verified.ts; about 37k served postings were found closed
 * on big Oracle and Workday boards). Owner decision GD6: "feed read {ago}"
 * only on a board read in full. And the not-carried sentence left out the two
 * ways a live posting goes unrecorded: the 30-day fence and the capped walk
 * (Workday stops at 2,000 and hides 82,353 live postings) (critique-api B-4).
 *
 * THE PROPERTY, over every bucket the observability table can hold, an
 * unknown word and none, every read state, and capped or not:
 *   - an open posting's sentence says a read listed it only on a board read
 *     to its end whose newest read completed, and that is not capped; every
 *     other board's sentence makes no claim that the posting was seen;
 *   - a not-carried sentence always names the 30-day fence, and names the
 *     part of a large board we never read unless the board is read in full
 *     and uncapped;
 *   - no check sentence says "open right now", "verified open", "real-time",
 *     "hired" or "filled": a check reports what we saw, never more.
 * The teeth: a shaper that ignores the bucket is caught, and so is a sentence
 * carrying a banned phrase.
 */
import { describe, expect, it } from "vitest";
import {
  EMPLOYER_COPY,
  TRUTH_COPY,
  day30RefusalSentence,
  truthFromRow,
  type PostingTruthRow,
  type TruthOptions,
} from "../../supabase/functions/public-api/posting-truth";
import { DATE_CLASS_NOTE } from "../../supabase/functions/public-api/date-classes";
import { DAY_30_REASONS, fillGateCopy } from "../../supabase/functions/_shared/hiring-record-gate";

const NOW = new Date("2026-12-06T12:00:00Z");
const OPTS: TruthOptions = { now: NOW, withheldSources: ["usajobs", "smartrecruiters"], withheldReason: "withheld" };

const BUCKETS: Array<string | null> = ["full_read", "lap_proven", "lap_pending", "unprovable", "unobserved", "a_word_we_do_not_know", null];
/** A read and its state come from one board_state row: both or neither. */
const READS: Array<{ at: string | null; state: string | null }> = [
  { at: "2026-12-06T09:00:00Z", state: "ok" },
  { at: "2026-12-06T09:00:00Z", state: "empty" },
  { at: "2026-12-06T09:00:00Z", state: "truncated" },
  { at: "2026-12-06T09:00:00Z", state: "error" },
  { at: "2026-12-06T09:00:00Z", state: "dark" },
  { at: null, state: null },
];
const CAPPED: Array<boolean | null> = [true, false, null];

const row = (bucket: string | null, read: { at: string | null; state: string | null }, capped: boolean | null, over: Partial<PostingTruthRow> = {}): PostingTruthRow => ({
  pt_id: "workday:acme~wd5~Careers:1", pt_source: "workday", pt_token: "acme~wd5~Careers", pt_title: "Planner", pt_company: "Acme",
  pt_row_found: true, pt_listed: true, pt_in_window: true, pt_missing_since: null, pt_posted_at: "2026-12-01T00:00:00Z",
  pt_has_closure: false, pt_closed_at: null, pt_seen_gone_at: null, pt_aged_at: null, pt_board_known: true,
  pt_bucket: bucket, pt_read_at: read.at, pt_read_state: read.state, pt_capped: capped,
  ...over,
});

/** A sentence that says a read saw the posting listed. */
const CLAIMS_THE_READ_LISTED_IT = /was listed|whole board|listed it|saw it listed/i;
const MAY_CLAIM = (bucket: string | null, state: string | null, at: string | null, capped: boolean | null) =>
  bucket === "full_read" && (state === "ok" || state === "empty") && at !== null && capped !== true;

type Combo = { bucket: string | null; read: { at: string | null; state: string | null }; capped: boolean | null };
const GRID: Combo[] = BUCKETS.flatMap((bucket) => READS.flatMap((read) => CAPPED.map((capped) => ({ bucket, read, capped }))));

/** Every combination whose open sentence claims more, or less, than the read allows. */
function openViolations(sentenceOf: (r: PostingTruthRow) => string): string[] {
  const bad: string[] = [];
  for (const { bucket, read, capped } of GRID) {
    const s = sentenceOf(row(bucket, read, capped));
    const claims = CLAIMS_THE_READ_LISTED_IT.test(s);
    const may = MAY_CLAIM(bucket, read.state, read.at, capped);
    if (claims && !may) bad.push(`claims a listing on ${bucket}/${read.state}/capped=${capped}: ${s}`);
    if (may && !claims) bad.push(`withholds a listing it read on ${bucket}/${read.state}/capped=${capped}: ${s}`);
  }
  return bad;
}

describe("a windowed board never says the read listed it", () => {
  it("the grid is the whole space: seven buckets, six reads, three cap states", () => {
    expect(GRID.length).toBe(7 * 6 * 3);
    expect(GRID.filter((c) => MAY_CLAIM(c.bucket, c.read.state, c.read.at, c.capped)).length, "the claim is reachable at all").toBe(4);
  });

  it("an open posting's sentence claims the read listed it only on a full read, completed and uncapped", () => {
    expect(openViolations((r) => {
      const t = truthFromRow(r.pt_id, r, OPTS);
      expect(t.state).toBe("open");
      return t.sentence;
    })).toEqual([]);
  });

  it("on a board read in parts the sentence says so, with the time of the part we read", () => {
    const t = truthFromRow("x:y:1", row("lap_proven", READS[0], false), OPTS);
    expect(t.sentence).toBe("This board is read in parts; we last read part of it 3 hours ago.");
    expect(t.read?.inParts).toBe(true);
    const capped = truthFromRow("x:y:1", row("full_read", READS[0], true), OPTS);
    expect(CLAIMS_THE_READ_LISTED_IT.test(capped.sentence), "a capped walk is a part, whatever its bucket says").toBe(false);
    expect(capped.sentence).toMatch(/read in parts/);
  });

  it("a not-carried sentence names the fence always, and the unread part unless the board is read in full", () => {
    for (const { bucket, read, capped } of GRID) {
      const t = truthFromRow("x:y:gone", row(bucket, read, capped, { pt_row_found: false, pt_listed: false, pt_in_window: false, pt_posted_at: null }), OPTS);
      expect(t.state).toBe("not_carried");
      expect(t.sentence).toMatch(/dated more than 30 days ago/);
      const fullUncapped = bucket === "full_read" && capped !== true;
      expect(/past the part of a large board we read/.test(t.sentence), `${bucket}/capped=${capped}: ${t.sentence}`).toBe(!fullUncapped);
    }
  });
});

/** The words a check may never use, held here and never in the checked code. */
const BANNED = [/open right now/i, /verified open/i, /real-time/i, /\bhired\b/i, /\bfilled\b/i];
const bannedIn = (texts: string[]): string[] => texts.filter((t) => BANNED.some((b) => b.test(t)));

describe("and no check sentence claims more than a read", () => {
  it("none of the fixed sentences carries a banned phrase", () => {
    const fixed = [
      ...Object.values(TRUTH_COPY), ...Object.values(EMPLOYER_COPY), ...Object.values(DATE_CLASS_NOTE),
      ...["not_computed_yet", "lap", "unproven read", "interval", "unread", "events", ...DAY_30_REASONS].map(day30RefusalSentence),
    ];
    expect(fixed.length).toBeGreaterThan(20);
    expect(bannedIn(fixed)).toEqual([]);
  });

  it("nor does any sentence the grid produces", () => {
    const produced = GRID.map(({ bucket, read, capped }) => truthFromRow("x:y:1", row(bucket, read, capped), OPTS).sentence);
    expect(bannedIn(produced)).toEqual([]);
  });
});

describe("teeth", () => {
  it("a shaper that ignores the bucket is caught on every windowed board", () => {
    const naive = () => fillGateCopy(TRUTH_COPY.openFullRead, { ago: "3 hours ago" });
    const bad = openViolations(naive);
    expect(bad.length).toBe(GRID.length - 4);
    expect(bad.some((b) => b.startsWith("claims a listing on lap_proven/ok"))).toBe(true);
  });

  it("a shaper that never claims is caught too, so the claim is not just banned", () => {
    expect(openViolations(() => "This board is read in parts; we last read part of it 3 hours ago.").length).toBe(4);
  });

  it("a banned phrase is found", () => {
    expect(bannedIn(["This posting is verified open.", "The role was filled.", "Listed when we last read part of the board."])).toHaveLength(2);
  });
});
