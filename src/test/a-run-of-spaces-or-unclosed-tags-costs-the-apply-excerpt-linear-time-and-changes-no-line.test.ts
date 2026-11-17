/**
 * A RUN OF SPACES OR UNCLOSED TAGS COSTS THE APPLY EXCERPT LINEAR TIME AND
 * CHANGES NO LINE (MCP upgrade 3, W1 lane L4, wave 1).
 *
 * WHAT WAS WRONG. postingExcerptOf, which apply_myself runs on the board's
 * description with no length cap, cost time in proportion to the square of
 * some descriptions' length. Measured on main's copy (c7abaf00d, what
 * production serves) in node, fastest of three, at 14, 28, 56 and 100 KB:
 * "Requirements" then a run of spaces 101, 397, 1,574 and 5,027 ms; a run of
 * "<" 78, 302, 1,187 and 3,784 ms; repeated "<p " 51, 201, 790 and 2,498 ms.
 * At 100 KB a run of no-break spaces cost 4,983 ms, of tabs 4,368, blank
 * lines holding spaces 3,599, "\r\n" pairs 2,188, repeated "<br " 1,872,
 * repeated "</p" 2,497 and "<p x" lines 756. One crafted or badly formatted
 * posting could hold an apply_myself call past the edge function's CPU
 * limit. Both causes sit in the shared helpers it calls: the shared sentence
 * break's bullet pattern reads a white-space run again from each character
 * in it when no bullet ends the run, and its block-tag pattern, like the tag
 * pattern in textOf, reads from each "<" to the end of the text when no ">"
 * follows.
 *
 * WHAT IS NOW TRUE. postingExcerptOf writes each run of white space as one
 * character (a line break when the run holds one) and each "<" that no ">"
 * follows as "&lt;", in the whole text before the break and again in each
 * sentence before textOf; the shared helpers are not edited. Each shape
 * below costs under BOUND_100_MS at 100 KB and BOUND_500_MS at 500 KB (in
 * vitest the slowest measured 15 and 75 ms, a run of bare bullets of all
 * four kinds, each one an empty sentence; next a run of "<" closed by
 * "<br>", 9 and 48 ms), and the shapes together cost at 500 KB no more than
 * GROWTH_MAX times what they cost at 100 KB (5.3 measured; the square of the
 * length would be 25). And it reads no more than EXCERPT_READ_MAX
 * characters, over four times the longest fixture text, so a description has
 * a ceiling as well as a slope: that bullet shape measured 151 ms at the
 * limit and 156 ms at four times it, where reading on cost 619 ms there and
 * kept growing with the length.
 *
 * And the lines picked are the same: postingExcerptOf equals the frozen copy
 * of c7abaf00d's function (fixtures/posting-excerpt.before-l4.ts) on every
 * distinct text of 40 characters or more in the fixtures (18,829 when
 * written, 2,368 of them with an excerpt, among them the 597 fixture
 * postings and two whole application pages of 130 and 238 KB), on 3,000
 * random strings of markup, white space and requirement words, and on each
 * shape below at 4 KB. It reads that far and not only to the 100,000
 * characters the module's other readers stop at: cut there, it picked other
 * lines from those two pages.
 *
 * NOT YET TRUE OF apply_myself AS A WHOLE. On the same uncapped description
 * it also runs the shared terms reader, whose boilerplate pass splits the
 * raw text on the same shared sentence break with nothing normalised.
 * Measured in Deno at 14, 28, 56 and 100 KB: "Requirements" then spaces
 * 204, 433, 1,639 and 5,107 ms; a run of mixed Unicode spaces 296, 825,
 * 3,300 and 10,459 ms; repeated "<p " 33, 113, 418 and 1,293 ms. That
 * reader and its call sit in the shared helpers and the connector's entry
 * file, outside this lane's files, so apply_myself's CPU-limit bug stays
 * open until they are fixed there.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXCERPT_READ_MAX, postingExcerptOf } from "../../supabase/functions/agent-mcp/posting-excerpt";
import { postingExcerptOf as postingExcerptBefore } from "./fixtures/posting-excerpt.before-l4";
import { POSTINGS, RESUMES } from "./fixtures/cv-matching-corpus";
import { NON_HEALTHCARE_POSTINGS, NURSING_POSTING } from "./fixtures/non-healthcare-postings";
import { ACCOUNTANT, ENGINEER, NURSE, SALESPERSON, TEACHER } from "./fixtures/one-cv-in-several-languages";
import { EVIDENCE, PROXIES } from "./fixtures/shortlist-redaction-corpus";
import SPLIT from "./fixtures/perks-test-split.json";
import BOILER from "./fixtures/posting-terms-boilerplate-2026-11.json";
import LANG from "./fixtures/posting-language-corpus-2026-11-15.json";

const FIXTURES = path.resolve(__dirname, "fixtures");
/** The shortest fixture string read as a text: a sentence, not a label or an id. */
const MIN_TEXT = 40;

/** Every string in a parsed fixture, however deep. */
function stringsIn(v: unknown, out: string[]): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsIn(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) stringsIn(x, out);
  return out;
}

/** Every distinct real text in the fixtures, with the file it came from: JSON strings, whole HTML, XML and RSS files, and the TS corpora's strings. */
function realTexts(): Map<string, string> {
  const texts = new Map<string, string>();
  const add = (t: string, from: string) => { if (!texts.has(t)) texts.set(t, from); };
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const ext = path.extname(p);
      if (![".json", ".html", ".xml", ".rss"].includes(ext)) continue;
      const raw = fs.readFileSync(p, "utf8");
      for (const s of ext === ".json" ? stringsIn(JSON.parse(raw), []) : [raw]) {
        if (s.length >= MIN_TEXT) add(s, path.relative(FIXTURES, p));
      }
    }
  };
  walk(FIXTURES);
  const corpora = { POSTINGS, RESUMES, NON_HEALTHCARE_POSTINGS, NURSING_POSTING, ACCOUNTANT, ENGINEER, NURSE, SALESPERSON, TEACHER, EVIDENCE, PROXIES };
  for (const [name, v] of Object.entries(corpora)) for (const s of stringsIn(v, [])) if (s.length >= MIN_TEXT) add(s, name);
  // The 597 postings the lane's other tests read, whatever their length.
  for (const t of POSTINGS_597) add(t, "597 postings");
  return texts;
}

const POSTINGS_597: string[] = [
  ...(SPLIT as { rows: Array<{ description: string }> }).rows.map((r) => r.description),
  ...(BOILER as { rows: Array<{ description: string }> }).rows.map((r) => r.description),
  ...(LANG as { cases: Array<{ text: string }> }).cases.map((c) => c.text),
];

/** The texts on which the two functions pick different lines, named by where each came from. */
function differences(texts: Iterable<[string, string]>): string[] {
  const out: string[] = [];
  for (const [t, from] of texts) {
    const now = postingExcerptOf(t);
    const before = postingExcerptBefore(t);
    if (JSON.stringify(now) !== JSON.stringify(before)) out.push(`${from} (${t.length} chars): ${JSON.stringify(before).slice(0, 200)} became ${JSON.stringify(now).slice(0, 200)}`);
  }
  return out;
}

/** A small seeded generator, so the random strings are the same on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The pieces random strings are built from: tags whole and broken, entities, every kind of white space, sentence ends, bullets and the words the excerpt looks for. */
const PIECES = [
  "<", ">", "<<", ">>", "<p>", "</p>", "<p ", "<p class=\"a\">", "<li>", "</li>", "<ul>", "<br>", "<br/>", "<br />", "<BR>", "<br\n/>", "<div\nclass=\"x\">",
  "<span>", "</span>", "<span", "<h3>", "</h3>", "<td", "</tr>", "<b>", "<x y=\">\">", "&lt;", "&gt;", "&amp;", "&nbsp;", "&#60;", "&#x3c;", "&lt;p&gt;", "&", ";",
  " ", "  ", "   ", "\n", "\n\n", " \n ", "\r\n", "\r", "\t", "\t\t", " ", "  ", " ", "　", "﻿", " \t \n",
  ".", ". ", "! ", "? ", ".\n", "•", " • ", "·", "▪", "●", " ● ", "U.S.", "e.g.",
  "Requirements", "Requirements:", "Key Requirements", "How to apply", "To apply, please submit your CV and cover letter", "Must have a degree", "3 years of experience required",
  "We are an equal opportunity employer", "Benefits", "Responsibilities:", "Qualifications", "Visa sponsorship is not available", "closing date 30 November", "portfolio",
  "About the role", "lorem ipsum dolor sit amet", "x", "and", "Minimum qualifications include a licence", "background check", "references",
];

function randomText(rand: () => number): string {
  const n = 1 + Math.floor(rand() * rand() * 240);
  let s = "";
  for (let i = 0; i < n; i++) s += PIECES[Math.floor(rand() * PIECES.length)];
  return s;
}

/** `head`, then `unit` repeated, then `tail`: about `n` characters. */
const rep = (head: string, unit: string, tail: string, n: number) =>
  head + unit.repeat(Math.max(1, Math.ceil((n - head.length - tail.length) / unit.length))) + tail;

const REAL_POSTING = (SPLIT as { rows: Array<{ description: string }> }).rows.map((r) => r.description).sort((a, b) => b.length - a.length)[0];

/** Hostile shapes: the three measured on main, and others that read white space, "<" or entities. */
const SHAPES: Array<[string, (n: number) => string]> = [
  ["'Requirements' then a run of spaces", (n) => "Requirements" + " ".repeat(n - 12)],
  ["a run of '<'", (n) => "<".repeat(n)],
  ["repeated '<p '", (n) => rep("", "<p ", "", n)],
  ["a run of no-break spaces", (n) => "a" + " ".repeat(n - 2) + "b"],
  ["a run of tabs", (n) => "a" + "\t".repeat(n - 2) + "b"],
  ["a run of spaces, tabs and no-break spaces", (n) => "a" + " \t ".repeat(Math.ceil(n / 3)) + "b"],
  ["blank lines holding spaces", (n) => rep("", " \n ", "", n)],
  ["'\\r\\n' pairs", (n) => rep("x", "\r\n", "y", n)],
  ["blank lines", (n) => rep("", "\n", "", n)],
  ["a run of '<' then a line break and '>'", (n) => "<".repeat(n - 2) + "\n>"],
  ["a run of '<' closed by '<br>'", (n) => "<".repeat(n - 4) + "<br>"],
  ["a '<' whose '>' is at the end", (n) => "<" + "x ".repeat(Math.floor((n - 2) / 2)) + ">"],
  ["repeated '<p x' closed at the end", (n) => rep("", "<p x ", ">", n)],
  ["repeated '<p x' lines", (n) => rep("", "<p x\n", "", n)],
  ["repeated '<br '", (n) => rep("", "<br ", "", n)],
  ["repeated '</p'", (n) => rep("", "</p", "", n)],
  ["'&lt;' entities", (n) => rep("", "&lt;", "", n)],
  ["'&lt;p ' entities", (n) => rep("", "&lt;p ", "", n)],
  ["spaces then a bullet", (n) => " ".repeat(n - 1) + "•"],
  ["bullets", (n) => rep("", "• ", "", n)],
  ["bare bullets of all four kinds", (n) => rep("", "•·▪●", "", n)],
  ["one-letter lines", (n) => rep("", "a\n", "", n)],
  ["one word", (n) => "a".repeat(n)],
  ["prose with no sentence break", (n) => rep("", "lorem ipsum dolor sit amet consectetur ", "", n)],
  ["requirement sentences", (n) => rep("Requirements\n", "Must have a degree and 3 years of experience. ", "", n)],
  ["'committed to a a a ...'", (n) => rep("committed to ", "a ", "", n)],
  ["the longest fixture posting, repeated", (n) => rep("", `${REAL_POSTING}\n`, "", n)],
];

const msOf = (f: () => unknown) => {
  const s = performance.now();
  f();
  return performance.now() - s;
};
const fastest = (t: string, runs = 3) => Math.min(...Array.from({ length: runs }, () => msOf(() => postingExcerptOf(t))));

/**
 * Per shape, fastest of three. Alone, the slowest measured 15 ms at 100 KB and
 * 75 ms at 500 KB; main took 5,027 ms at 100 KB. The bounds sit about ten
 * times above the lone figures because the pre-push hook runs every test file
 * at once, which slowed the costliest shape about four times (574 ms where it
 * measured 145 ms alone) and failed a push at a bound of 500. Growth with the
 * length, not the bounds, is what tells linear from quadratic.
 */
const BOUND_100_MS = 750;
const BOUND_500_MS = 3_000;
/** All shapes' cost at 500 KB over their cost at 100 KB: 5 when linear, 25 when it grows with the square. */
const GROWTH_MAX = 7;
/** The costliest shape at four times EXCERPT_READ_MAX, fastest of three (145 ms alone, 578 ms in a full suite). */
const BOUND_CAP_MS = 4_000;
/** Its cost at four times EXCERPT_READ_MAX over its cost at EXCERPT_READ_MAX: 1 when the rest is not read, 4 when it is. */
const CAP_GROWTH_MAX = 2;

describe("the apply excerpt picks the same lines as before", () => {
  it("on every real text in the fixtures: at least 1,500, the 597 postings among them", () => {
    const texts = realTexts();
    expect(texts.size).toBeGreaterThanOrEqual(1_500);
    expect(POSTINGS_597.length).toBe(597);
    for (const t of POSTINGS_597) expect(texts.has(t)).toBe(true);
    // Some of them must have lines to pick, or equal output would prove nothing.
    expect([...texts.keys()].filter((t) => postingExcerptOf(t).length > 0).length).toBeGreaterThanOrEqual(500);
    expect([...texts.keys()].some((t) => t.length > 100_000)).toBe(true);
    expect(differences(texts)).toEqual([]);
  }, 120_000);

  it("on 3,000 random strings of markup, white space and requirement words", () => {
    const rand = seeded(20261117);
    const texts: Array<[string, string]> = Array.from({ length: 3_000 }, (_, i) => [randomText(rand), `random #${i}`]);
    expect(texts.filter(([t]) => postingExcerptBefore(t).length > 0).length).toBeGreaterThanOrEqual(1_000);
    expect(differences(texts)).toEqual([]);
  }, 120_000);

  it("on each hostile shape at 4 KB, where the function before still finishes", () => {
    const texts: Array<[string, string]> = SHAPES.flatMap(([name, make]) => [[make(4_000), name], [`Requirements\n${make(4_000)}\nMust hold a valid licence.`, `${name}, between lines`]] as Array<[string, string]>);
    expect(differences(texts)).toEqual([]);
  }, 120_000);

  it("keeps a '<' with no '>' after it, and a long tag still a tag", () => {
    expect(postingExcerptOf("Requirements:\nSalary < 50k is required, with a degree <<< here")).toEqual(postingExcerptBefore("Requirements:\nSalary < 50k is required, with a degree <<< here"));
    expect(postingExcerptOf("Requirements:\nSalary < 50k is required, with a degree <<< here")).toContain("Salary < 50k is required, with a degree <<< here");
    const longTag = `Requirements:\n<span style="${"x".repeat(5_000)}">A degree is required</span>`;
    expect(postingExcerptOf(longTag)).toEqual(["A degree is required"]);
  });
});

describe("the apply excerpt costs time in proportion to a description's length", () => {
  // Every pattern compiled and run once, so no shape pays for the first call.
  for (const [, make] of SHAPES) postingExcerptOf(make(2_000));

  it.each(SHAPES)("%s: under the bound at 100 KB and 500 KB", (name, make) => {
    const at100 = fastest(make(100_000));
    const at500 = fastest(make(500_000));
    expect(at100, `${name} at 100 KB: ${at100.toFixed(1)} ms`).toBeLessThan(BOUND_100_MS);
    expect(at500, `${name} at 500 KB: ${at500.toFixed(1)} ms`).toBeLessThan(BOUND_500_MS);
  }, 60_000);

  it("five times the length costs at most GROWTH_MAX times as much, over all the shapes", () => {
    let at100 = 0;
    let at500 = 0;
    for (const [, make] of SHAPES) {
      at100 += fastest(make(100_000), 5);
      at500 += fastest(make(500_000), 5);
    }
    expect(at500 / at100, `100 KB: ${at100.toFixed(1)} ms, 500 KB: ${at500.toFixed(1)} ms`).toBeLessThan(GROWTH_MAX);
  }, 120_000);
});

describe("the apply excerpt reads no more than EXCERPT_READ_MAX characters", () => {
  const LINE = "You must hold a valid licence.";
  /** `n` line breaks, then `LINE`. */
  const lineAfter = (n: number) => "\n".repeat(n) + LINE;

  it("is longer than every real text in the fixtures, so it moves no fixture line", () => {
    const longest = Math.max(...[...realTexts().keys()].map((t) => t.length));
    expect(longest).toBeGreaterThan(200_000);
    expect(EXCERPT_READ_MAX).toBeGreaterThanOrEqual(4 * longest);
  }, 120_000);

  it("quotes a line that ends at the limit and not one that starts there", () => {
    expect(lineAfter(EXCERPT_READ_MAX - LINE.length).length).toBe(EXCERPT_READ_MAX);
    expect(postingExcerptOf(lineAfter(EXCERPT_READ_MAX - LINE.length))).toEqual([LINE]);
    expect(postingExcerptOf(lineAfter(EXCERPT_READ_MAX))).toEqual([]);
  }, 60_000);

  it("costs the costliest shape at four times the limit about what it costs at the limit", () => {
    const make = SHAPES.find(([name]) => name === "bare bullets of all four kinds")![1];
    const atMax = fastest(make(EXCERPT_READ_MAX));
    const atFour = fastest(make(4 * EXCERPT_READ_MAX));
    expect(atFour, `${atMax.toFixed(1)} ms at the limit, ${atFour.toFixed(1)} ms at four times it`).toBeLessThan(BOUND_CAP_MS);
    expect(atFour / atMax, `${atMax.toFixed(1)} ms at the limit, ${atFour.toFixed(1)} ms at four times it`).toBeLessThan(CAP_GROWTH_MAX);
  }, 60_000);
});
