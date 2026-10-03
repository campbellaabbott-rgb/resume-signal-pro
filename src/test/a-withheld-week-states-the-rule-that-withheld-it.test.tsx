// A WITHHELD WEEK STATES THE RULE THAT WITHHELD IT.
//
// /hiring-trends withholds a week's takedown count when it reads above
// CLOSURE_WEEK_PLAUSIBILITY times the 90-day closure record's average week
// (src/lib/hiring-trends-trust.ts, mirrored in the prerender). Four public
// sentences tell the reader that rule: the tile's reason, the weekly chart's
// caption and the "How we measure" entry on the React page, and the reason the
// prerendered page prints for crawlers. The first build of this change shipped
// all four stating a rule the code does not apply. Three said the week was
// held above twice the record's DAILY figure -- seven times stricter than the
// arithmetic, so every week the page printed broke the rule printed beside it
// (172,263 published on the 2026-10-01 record, against a stated ceiling of
// about 47k). The caption said "far above", which is no rule at all. The
// guards of that build pinned the sentences word for word, so they pinned the
// wrong ones and stayed green.
//
// So this file pins no wording. It READS THE RULE OUT OF EACH SENTENCE -- the
// multiplier, whether the average is of a day or of a week, and the window of
// the record -- and puts it to the verdict that actually decides, on records
// both younger and older than the window: a week a hair under the stated
// ceiling must be printed, and a week a hair over it must be withheld for
// exceeding the record. A sentence that states no complete rule fails too,
// because a reader cannot check it either.
//
// Reading the rule this way also caught the verdict drifting from its own
// words. observed_days is the age of the whole closure ledger, which is no
// longer pruned, and closed_90d is a 90-day count; dividing the second by the
// first stops being the record's average day once the ledger is 90 days deep
// (79 on 2026-10-01), and the ceiling then sinks a little every day. The
// records here run to 400 days deep, so an uncapped divisor fails every
// sentence that names a 90-day record.
//
// The last case holds the copy to a fact the SQL guard proves: the weekly
// series drops the boards in showcase_excluded and closed_90d keeps them
// (a-week-of-takedowns-cannot-outnumber-its-own-quarter.test.ts seeds one and
// counts it in the 90-day total only), so no sentence may call the two the
// same filter. The week is a part of that total, on a narrower filter.
//
// Red on the first build of this change: every page and crawler sentence
// disagrees with the verdict or states no rule, both "same filter" sentences
// are present, and the uncapped verdict fails the 90-day window past 90 days
// deep (each run recorded in the commit).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    functions: { invoke: async () => ({ data: {} }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import HiringTrends from "../pages/HiringTrends";
import { closureVerdict, heldClosureSentence, type ClosureVerdict } from "@/lib/hiring-trends-trust";

type Verdict = (week: unknown, record: unknown) => ClosureVerdict;
const tsVerdict = closureVerdict as Verdict;

// ── reading a rule out of a sentence ────────────────────────────────────────

/** What a sentence says the ceiling is: `times` x the record's average over
 *  `perDays` days, the record being the last `windowDays` days (or all of it,
 *  while it is younger than that). */
interface StatedRule { times: number; perDays: number; windowDays: number }

const NUMBER_WORDS: Record<string, number> = {
  twice: 2, thrice: 3, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function statedRule(sentence: string): StatedRule | string {
  const times = sentence.match(/\bmore than (twice|thrice|(\w+) times)\b/i);
  const per = sentence.match(/\b(daily|weekly) average\b|\baverage (day|week)\b/i);
  const window = sentence.match(/\b(\d+)-day closure record\b/i);
  if (!times || !per || !window) {
    return `states no complete ceiling rule (multiplier: ${times ? "yes" : "NO"}, a day or a week: ${per ? "yes" : "NO"}, window: ${window ? "yes" : "NO"}) -- "${sentence}"`;
  }
  const word = (times[2] ?? times[1]).toLowerCase();
  const n = NUMBER_WORDS[word] ?? Number(word);
  if (!Number.isFinite(n)) return `the multiplier "${word}" is not a number -- "${sentence}"`;
  const unit = (per[1] ?? per[2]).toLowerCase();
  return { times: n, perDays: unit === "daily" || unit === "day" ? 1 : 7, windowDays: Number(window[1]) };
}

/** Records younger than the window, at it, and well past it. */
const RECORDS = [7, 30, 79, 89, 90, 91, 120, 180, 400].flatMap((days) =>
  [1_854_930, 250_000].map((total) => ({ closed_90d: total, observed_days: days })),
);

/** Every record on which the verdict does not do what the sentence says. */
function disagreements(sentence: string, verdict: Verdict): string[] {
  const rule = statedRule(sentence);
  if (typeof rule === "string") return [rule];
  const out: string[] = [];
  for (const r of RECORDS) {
    const stated = rule.times * (r.closed_90d / Math.min(r.observed_days, rule.windowDays)) * rule.perDays;
    const under = verdict({ closed: stated * 0.999 }, r);
    const over = verdict({ closed: stated * 1.001 }, r);
    const at = `${r.closed_90d.toLocaleString("en-US")} over ${r.observed_days} days`;
    if (under.state !== "published") {
      out.push(`${at}: the sentence prints ${Math.round(stated * 0.999).toLocaleString("en-US")} and the verdict withholds it -- "${sentence}"`);
    }
    if (over.state !== "held" || over.reason !== "exceeds_record") {
      out.push(`${at}: the sentence withholds ${Math.round(stated * 1.001).toLocaleString("en-US")} and the verdict prints it -- "${sentence}"`);
    }
  }
  return out;
}

/** The text of every innermost element that tells a reader a week is withheld
 *  against the closure record, cut to the sentences that do it. */
function ceilingSentences(root: ParentNode): string[] {
  const says = (t: string) => /withh(?:e|o)ld/i.test(t) && /closure record/i.test(t);
  const hits = [...root.querySelectorAll<HTMLElement>("*")].filter((e) => says(e.textContent ?? ""));
  const innermost = hits.filter((e) => ![...e.children].some((c) => says(c.textContent ?? "")));
  return innermost.flatMap((e) =>
    (e.textContent ?? "").replace(/\s+/g, " ").trim().split(/(?<=\.)\s+/).filter(says),
  );
}

// ── the page and the prerender, as each renders ──────────────────────────────

const RECORD = { closed_90d: 1_854_930, observed_days: 79, total_open: 752_000, computed_at: "2026-10-01T23:05:00+00:00" };
/** The live rows of 2026-10-01: four weeks the ceiling holds, one it prints. */
const ROWS = [
  { week_start: "2026-08-31", new_postings: 253266, entry_new: 20452, remote_new: 7807, closed: 172263 },
  { week_start: "2026-09-07", new_postings: 303025, entry_new: 23170, remote_new: 8337, closed: 845110 },
  { week_start: "2026-09-14", new_postings: 345732, entry_new: 32030, remote_new: 10798, closed: 870536 },
  { week_start: "2026-09-21", new_postings: 332381, entry_new: 30000, remote_new: 9000, closed: 806570 },
  { week_start: "2026-09-28", new_postings: 144411, entry_new: 16998, remote_new: 6064, closed: 499871 },
];

async function mountPage(rows: unknown[]) {
  rpc.mockImplementation((fn: string) => {
    if (fn === "get_stats_cache") {
      return Promise.resolve({ data: { computed_at: "2026-10-01T23:12:00+00:00", stale_parts: [], ghost_stats: RECORD, hiring_trends: rows, trending_categories: [] } });
    }
    return Promise.resolve({ data: [] });
  });
  render(<MemoryRouter><HiringTrends /></MemoryRouter>);
  await waitFor(() => expect(document.body.textContent).toContain("new roles posted last week"));
}

const PRERENDER = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
const START = "// >>> DATA-PAGE FIGURE BUILDER START";
const END = "// <<< DATA-PAGE FIGURE BUILDER END";
function loadSlice(src = PRERENDER): { verdict: Verdict; build: (p: unknown) => { trends: { html: string } } } {
  const a = src.indexOf(START);
  const b = src.indexOf(END);
  expect(a, "the builder's start marker moved").toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  const [verdict, build] = new Function(`${src.slice(a, b)}; return [closureWeekVerdict, dataPageFigures];`)();
  return { verdict, build };
}
const payload = (rows: unknown[]) => ({
  stats: { computed_at: "2026-10-01T22:12:00+00:00", stale_parts: [], ghost_stats: RECORD, hiring_trends: rows, trending_categories: [] },
  transparency: null,
  freshness: null,
});
const parse = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;

beforeEach(() => { rpc.mockReset(); });

describe("every sentence that states the ceiling states the rule the verdict applies", () => {
  it("the tile's reason, straight from heldClosureSentence", () => {
    const held = closureVerdict({ closed: 806_570 }, RECORD);
    expect(held.state).toBe("held");
    const sentence = heldClosureSentence(held as Extract<ClosureVerdict, { state: "held" }>);
    expect(disagreements(sentence, tsVerdict)).toEqual([]);
  });

  it("the React page: the tile, the chart caption and the How-we-measure entry", async () => {
    await mountPage(ROWS);
    const found = ceilingSentences(document.body);
    // Three places say it; a page that stopped saying it in one of them is a
    // change somebody should make on purpose, not one this test absorbs.
    expect(found, found.join("\n")).toHaveLength(3);
    expect(found.flatMap((s) => disagreements(s, tsVerdict))).toEqual([]);
  });

  it("the prerendered page, against its own mirror of the verdict and against the page's", () => {
    const { verdict, build } = loadSlice();
    const found = ceilingSentences(parse(build(payload(ROWS.slice(0, 4))).trends.html));
    expect(found, "the crawler page printed no ceiling reason for a held week").toHaveLength(1);
    expect(found.flatMap((s) => disagreements(s, verdict))).toEqual([]);
    expect(found.flatMap((s) => disagreements(s, tsVerdict))).toEqual([]);
  });
});

describe("teeth: the reader this file stands in for would have caught the first build", () => {
  it("a sentence naming the record's daily figure disagrees with the verdict on every record", () => {
    const d = disagreements("Withheld — the week reads at more than twice the daily average of our own 90-day closure record.", tsVerdict);
    expect(d.length).toBe(RECORDS.length);
    expect(d.every((x) => x.includes("the verdict withholds it") === false)).toBe(true);
  });

  it("a sentence with no multiplier states no rule", () => {
    const d = disagreements("A week with no takedown bar is withheld: it read far above our own 90-day closure record.", tsVerdict);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatch(/^states no complete ceiling rule/);
  });

  it("a verdict dividing by the ledger's whole age fails the 90-day window, and only past 90 days", () => {
    const uncapped = PRERENDER.replace("Math.min(days, CLOSURE_RECORD_WINDOW_DAYS)", "days");
    expect(uncapped, "the mirror's divisor moved; point this mutant at it").not.toBe(PRERENDER);
    const { verdict } = loadSlice(uncapped);
    const d = disagreements("Withheld — the week reads at more than twice the average week of our own 90-day closure record.", verdict);
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((x) => /over (9[1-9]|1\d\d|[2-9]\d\d) days/.test(x)), d.join("\n")).toBe(true);
  });
});

describe("no sentence calls the weekly takedown filter the 90-day total's own", () => {
  // The weekly series also drops the boards in showcase_excluded, which
  // closed_90d keeps: the SQL guard seeds such a board and finds it in the
  // 90-day total only. Each week is a PART of that total, on a narrower
  // filter, and that is what the copy may say.
  const SAME = /\bsame (?:filter|rule|exclusions?)\b[^.]*\b90-day\b/i;

  it("on the React page", async () => {
    await mountPage(ROWS);
    expect(document.body.textContent ?? "").not.toMatch(SAME);
    expect(document.body.textContent ?? "").toMatch(/so a week is a part of that total/);
  });

  it("on the crawler page, with a published week (the label that carried it)", () => {
    const { build } = loadSlice();
    const text = parse(build(payload([{ ...ROWS[0], closed_flagged: 0 }, { ...ROWS[1], closed: 160000, closed_flagged: 685110 }])).trends.html).textContent ?? "";
    expect(text).toContain("172,263");
    expect(text).not.toMatch(SAME);
    expect(text).toMatch(/so the week is a part of that total/);
  });
});
