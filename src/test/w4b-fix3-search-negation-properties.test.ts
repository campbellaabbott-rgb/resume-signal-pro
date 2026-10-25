// @vitest-environment node
/**
 * NEGATED SEARCH PHRASES, GENERATED (wave 4 fix rounds 3 and 4, S12-017).
 *
 * The corpus test pins 591 labelled queries; this one walks combinations no
 * one listed, from a fixed seed so a failure reproduces:
 *   - a title, ONE negated word, then any place, known or not, any case, with
 *     or without a preposition, or an invented word in capitals: the place or
 *     word stays wanted and only the negated word is excluded, exactly as
 *     origin/main answers;
 *   - a pinned compound in any case, then any of those: both compound words
 *     are excluded and nothing after them;
 *   - random queries with no compound, no known multi-word place, no quote
 *     and no verb after "not": the answer is origin/main's, word for word;
 *   - any query: the positive words are the typed words, in order, minus the
 *     operators and the excluded words, and nothing is invented;
 *   - round 4: "T not A or B" excludes both; a pinned region or city after
 *     "not" is one exclusion and stays wanted after a negated word;
 *   - the title match is origin/main's (the 2026-10-25 descope took round 4's
 *     plural and hyphen folds out): a word strikes exactly the titles main's
 *     match strikes, and a hyphenated word strikes exactly the titles that
 *     hold it as typed, hyphen included. A title spelling it apart or run
 *     together is kept: main's open defect, a residual.
 * LIVE_RULE and LIVE_TITLE below are origin/main's splitExclusions and
 * titleExcluded (8a6561c4), copied as the oracle: what production answers today.
 * A hyphen inside an excluded word is the one place this rule's string differs
 * from main's ("part-time" for main's "parttime"); the oracle compares without it.
 */
import { describe, expect, it } from "vitest";
import { NEGATED_PLACES, NOT_COMPOUNDS, splitExclusions, titleExcluded } from "../../supabase/functions/job-board/search-routing";
import { knownPlace } from "../../supabase/functions/job-board/query-place";

type Out = { positive: string; excluded: string[] };

const LIVE_STOPWORDS = new Set(["for", "the", "a", "an", "of", "in", "at", "to", "on"]);
function LIVE_RULE(raw: string): Out {
  const text = String(raw ?? "").trim();
  if (!text) return { positive: text, excluded: [] };
  const positive: string[] = [];
  const excluded: string[] = [];
  let pendingNot: string | null = null;
  for (const w of text.split(/\s+/)) {
    if (pendingNot !== null) {
      if (LIVE_STOPWORDS.has(w.toLowerCase())) positive.push(pendingNot, w);
      else excluded.push(w.toLowerCase());
      pendingNot = null;
      continue;
    }
    if (/^not$/i.test(w)) { pendingNot = w; continue; }
    if (w.length > 1 && w.startsWith("-")) { excluded.push(w.slice(1).toLowerCase()); continue; }
    positive.push(w);
  }
  const clean = [...new Set(excluded.map((e) => e.replace(/[^a-z0-9+#.]/gi, "").toLowerCase()).filter((e) => e.length >= 2))];
  if (!positive.length || !clean.length) return { positive: text, excluded: [] };
  return { positive: positive.join(" "), excluded: clean };
}
function LIVE_TITLE(title: string, excluded: readonly string[]): boolean {
  if (!excluded.length) return false;
  const t = String(title ?? "").toLowerCase();
  return excluded.some((e) => new RegExp(`(^|[^a-z0-9])${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(t));
}
/** The same answer as main's, reading a kept hyphen as main's fold. */
const asLive = (o: Out): string => JSON.stringify({ positive: o.positive, excluded: o.excluded.map((e) => e.replace(/-/g, "")) });

/** mulberry32: a fixed seed, so a failing combination reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(20261024);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(R() * xs.length)];
const caseOf = (s: string, k: number) => (k === 0 ? s.toLowerCase() : k === 1 ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : k === 2 ? s.toUpperCase() : s);
const clean = (s: string) => s.split(/\s+/).map((w) => w.replace(/[^a-z0-9+#.-]/gi, "").replace(/\.+$/, "").replace(/^-+|-+$/g, "").toLowerCase()).filter(Boolean).join(" ");

const TITLES = ["nurse", "rn", "registered nurse", "warehouse", "driver", "truck driver", "teacher", "accountant", "barista", "cook",
  "line cook", "chef", "cashier", "electrician", "software engineer", "developer", "welder", "data analyst", "security guard",
  "pharmacist", "mechanic", "receptionist", "project manager", "caregiver", "plumber", "paralegal", "cna", "bartender", "recruiter"];
/** One-word negations. "night", "box", "call", "home" start compounds, and are paired below only with places. */
const NEGS = ["senior", "junior", "travel", "night", "overnight", "contract", "temp", "forklift", "cdl", "substitute", "icu", "agency",
  "lead", "manager", "sales", "commission", "weekend", "intern", "apprentice", "staffing", "union", "federal", "clearance", "part-time",
  "otr", "sous", "line", "remote", "prn", "er", "seasonal", "box", "call", "home", "c++", ".net", "crypto", "unpaid"];
const PLACES = ["Dallas", "Chicago", "Houston", "Austin", "Denver", "Phoenix", "Boston", "San Antonio", "Los Angeles", "Kansas City",
  "Salt Lake City", "St. Louis", "Fort Worth", "Jacksonville", "Tulsa", "Spokane", "Fresno", "San Jose", "Oakland", "Long Beach",
  "Richmond", "Norfolk", "Rochester", "Albany", "Hartford", "Providence", "Jackson", "Birmingham", "New Orleans", "Baton Rouge",
  "Little Rock", "Madison", "Texas", "Florida", "New Jersey", "North Carolina", "TX", "CA", "NY", "nyc", "sf", "la", "bay area", "dfw",
  "atl", "socal", "uk", "us", "nz", "canada", "germany", "new zealand", "london", "toronto", "Austin, TX", "Dallas TX", "San Jose, CA",
  "tulsa ok", "75201", "remote", "hybrid", "part time", "full time", "remote us", "new york", "York", "Reading", "Mobile", "Normal"];
const SYL = ["bor", "ell", "an", "ton", "vil", "ma", "ker", "ridge", "ham", "lo", "sta", "wen", "dor", "ast", "ion", "qu", "ex", "zel"];
const invented = () => { let w = ""; const n = 2 + Math.floor(R() * 3); for (let i = 0; i < n; i++) w += pick(SYL); return R() < 0.5 ? w[0].toUpperCase() + w.slice(1) : w; };
const COMPOUNDS = [...NOT_COMPOUNDS];

describe("one negated word never takes the next word (any place, any case, invented words)", () => {
  it("answers 'T P' with only the negated word excluded, exactly as origin/main does", () => {
    const bad: string[] = [];
    for (let k = 0; k < 4000; k++) {
      const t = caseOf(pick(TITLES), Math.floor(R() * 3));
      const n = pick(NEGS);
      const tail = R() < 0.2 ? invented() : caseOf(pick(PLACES), Math.floor(R() * 4));
      const prep = R() < 0.15 ? pick(["in", "near", "around"]) + " " : "";
      // A compound's first word followed by its own partner is the compound rule, tested below.
      if (NOT_COMPOUNDS.has(`${n} ${tail.split(" ")[0].toLowerCase().replace(/s$/, "")}`)) continue;
      const q = `${t} not ${n} ${prep}${tail}`;
      const want = { positive: `${t} ${prep}${tail}`, excluded: [clean(n)] };
      const got = splitExclusions(q);
      if (JSON.stringify(got) !== JSON.stringify(want) || asLive(got) !== JSON.stringify(LIVE_RULE(q))) bad.push(`${q} -> ${JSON.stringify(got)}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

describe("a pinned compound takes exactly its two words, in any case", () => {
  it("excludes the compound and keeps whatever follows", () => {
    const bad: string[] = [];
    for (let k = 0; k < 3000; k++) {
      const t = pick(TITLES);
      const c = caseOf(pick(COMPOUNDS), Math.floor(R() * 3));
      const plural = R() < 0.3 && !/s$/.test(c) ? "s" : "";
      const tail = R() < 0.2 ? "" : R() < 0.3 ? invented() : pick(PLACES);
      const verb = R() < 0.15 ? "requiring " : "";
      const q = `${t} not ${verb}${c}${plural}${tail ? ` ${tail}` : ""}`;
      const want = { positive: `${t}${tail ? ` ${tail}` : ""}`, excluded: [clean(c + plural)] };
      const got = splitExclusions(q);
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${q} -> ${JSON.stringify(got)}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("no compound word is a place, in any case, so no place can ride in as a compound's second word", () => {
    // A compound's first word is never taken alone as a place ("on" alone is the stopword veto), so only "ON call"'s "ON" is a place.
    for (const c of COMPOUNDS) for (const w of c.split(" ").slice(c.startsWith("on ") ? 1 : 0)) for (const k of [0, 1, 2]) expect(knownPlace(caseOf(w, k)), `${c}: ${w}`).toBeNull();
  });
});

describe("a sentence's full stop never rides into an exclusion (found by the fix 3 self-break)", () => {
  it("strikes the title the words name, with or without the stop", () => {
    expect(splitExclusions("nurse not night shift.")).toEqual({ positive: "nurse", excluded: ["night shift"] });
    expect(splitExclusions("engineer not manager.")).toEqual({ positive: "engineer", excluded: ["manager"] });
    expect(splitExclusions("developer not .net")).toEqual({ positive: "developer", excluded: [".net"] });
  });
});

describe("outside compounds, known multi-word places, quotes and verbs, the answer is origin/main's", () => {
  const VOCAB = [...new Set([...TITLES.flatMap((t) => t.split(" ")), ...NEGS, "Dallas", "Chicago", "Tulsa", "Jacksonville", "Madison",
    "Oakland", "TX", "tx", "nyc", "sf", "uk", "us", "nz", "remote", "jobs", "for", "in", "the", "-travel", "-senior", "-agency"])];
  const knownRun = (ws: string[]) => ws.some((_, i) => [2, 3].some((n) => i + n <= ws.length && knownPlace(ws.slice(i, i + n).join(" ")) !== null));
  it("matches origin/main word for word on random queries", () => {
    const bad: string[] = [];
    let tried = 0;
    for (let k = 0; k < 6000; k++) {
      const ws: string[] = [];
      const len = 2 + Math.floor(R() * 6);
      for (let i = 0; i < len; i++) ws.push(R() < 0.25 ? caseOf("not", Math.floor(R() * 3)) : R() < 0.1 ? invented() : pick(VOCAB));
      if (ws.some((w, i) => /^not$/i.test(w) && i + 1 < ws.length && /^not$/i.test(ws[i + 1]))) continue;
      if (ws.some((w, i) => i + 1 < ws.length && NOT_COMPOUNDS.has(`${w.toLowerCase()} ${ws[i + 1].toLowerCase().replace(/s$/, "")}`))) continue;
      if (knownRun(ws)) continue;
      tried++;
      const q = ws.join(" ");
      const got = splitExclusions(q);
      const live = LIVE_RULE(q);
      if (asLive(got) !== JSON.stringify(live)) bad.push(`${q} -> ${JSON.stringify(got)} live ${JSON.stringify(live)}`);
    }
    expect(tried).toBeGreaterThan(3000);
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("the positive words are the typed words, in order, and nothing is invented", () => {
    for (let k = 0; k < 3000; k++) {
      const ws: string[] = [];
      const len = 1 + Math.floor(R() * 7);
      for (let i = 0; i < len; i++) ws.push(R() < 0.2 ? "not" : R() < 0.15 ? pick(COMPOUNDS) : R() < 0.1 ? pick(PLACES) : pick(VOCAB));
      const q = ws.join(" ");
      const got = splitExclusions(q);
      const typed = q.split(/\s+/);
      const pos = got.positive.split(/\s+/).filter(Boolean);
      let at = 0;
      for (const p of pos) {
        while (at < typed.length && typed[at] !== p) at++;
        expect(at < typed.length, `${q}: positive word ${p} was not typed in this order`).toBe(true);
        at++;
      }
      for (const e of got.excluded) expect(clean(q).includes(e), `${q}: excluded ${e} was not typed`).toBe(true);
    }
  });
});

describe("round 4: 'not A or B', pinned regions and cities, and the title match", () => {
  const ONE = NEGS.filter((n) => !["night", "box", "call", "home", "line", "lead", "union"].includes(n) && !/[-+.]/.test(n));
  const TAILS = ["", " Dallas", " Tulsa", " remote", " San Jose", " New Orleans", " TX", " 75201"];
  it("'T not A or B' excludes both one-word negations and keeps the rest", () => {
    const bad: string[] = [];
    for (let k = 0; k < 2000; k++) {
      const t = pick(TITLES), a = pick(ONE), b = pick(ONE), tail = pick(TAILS);
      if (a === b) continue;
      const joiner = pick(["or", "nor", "Or"]);
      const q = `${t} not ${a} ${joiner} ${b}${tail}`;
      const got = splitExclusions(q);
      const want = { positive: `${t}${tail}`, excluded: [a, b] };
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${q} -> ${JSON.stringify(got)}`);
      // A capital OR in a query that is not all capitals is the searcher's operator: main's answer.
      const q2 = `${t} not ${a} OR ${b}${tail}`;
      if (asLive(splitExclusions(q2)) !== JSON.stringify(LIVE_RULE(q2))) bad.push(`${q2} -> ${JSON.stringify(splitExclusions(q2))}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("a pinned region or city after 'not' is one exclusion, and after a negated word it stays in the search", () => {
    const bad: string[] = [];
    for (const place of NEGATED_PLACES) {
      for (const k of [0, 1, 2]) {
        const p = caseOf(place, k), t = pick(TITLES), n = pick(ONE), tail = pick(TAILS);
        const q1 = `${t} not ${p}${tail}`;
        const g1 = splitExclusions(q1);
        if (JSON.stringify(g1) !== JSON.stringify({ positive: `${t}${tail}`, excluded: [place] })) bad.push(`${q1} -> ${JSON.stringify(g1)}`);
        const q2 = `${t} not ${n} ${p}`;
        const g2 = splitExclusions(q2);
        if (JSON.stringify(g2) !== JSON.stringify({ positive: `${t} ${p}`, excluded: [n] })) bad.push(`${q2} -> ${JSON.stringify(g2)}`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("no pinned place word is a compound word, so a pinned place never takes a compound's partner", () => {
    const compoundWords = new Set(COMPOUNDS.flatMap((c) => c.split(" ")));
    for (const p of NEGATED_PLACES) {
      const [first, second] = p.split(" ");
      expect(NOT_COMPOUNDS.has(`${first} ${second}`), p).toBe(false);
      expect(compoundWords.has(p.split(" ").slice(-1)[0]) && NOT_COMPOUNDS.has(p), p).toBe(false);
    }
  });

  const WORDS = ["news", "parts", "arts", "lines", "homes", "services", "windows", "sales", "goods", "graphics", "systems",
    "operations", "nights", "shifts", "manager", "travel", "agency", "nurse", "line", "home", "art", "part", "new", "window",
    "service", "senior", "lead", "cook", "night", "shift", "traveler", "c++", ".net", "rn", "er", "icu", "bus", "glass", "boss"];
  const TITLE_WORDS = [...WORDS, ...WORDS.map((w) => `${w}s`), ...WORDS.map((w) => `${w}es`), ...WORDS.map((w) => w.replace(/s$/, "")),
    "time", "business", "producer", "editor", "driver", "teacher", "aide", "consultant", "engineer", "-", ",", "/", "&"];
  const PLURAL = (w: string, title: string) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)([^a-z0-9]|$)`).test(title);
  it("a single word strikes exactly the titles origin/main strikes: no plural fold, so 'news' keeps New Grad and 'parts' keeps Part-Time", () => {
    const bad: string[] = [];
    let plurals = 0;
    for (let k = 0; k < 20000; k++) {
      const w = pick(WORDS);
      const title = Array.from({ length: 2 + Math.floor(R() * 4) }, () => pick(TITLE_WORDS)).join(" ");
      const mine = titleExcluded(title, [w]), live = LIVE_TITLE(title, [w]);
      if (mine !== live) bad.push(`${w} | ${title}: main ${live ? "strikes" : "keeps"} it, this rule ${mine ? "strikes" : "keeps"} it`);
      if (!live && PLURAL(w, title.toLowerCase())) plurals++;
    }
    expect(bad.slice(0, 10)).toEqual([]);
    expect(plurals, "no title held a plural of its word, so this cannot show the fold is gone").toBeGreaterThan(100);
    expect(titleExcluded("New Grad RN", ["news"])).toBe(false);
    expect(titleExcluded("Part-Time Driver", ["parts"])).toBe(false);
    expect(titleExcluded("Accounts Payable Manager", ["account"])).toBe(false);
  });

  it("a hyphenated word strikes exactly the titles that hold it as typed; apart or run together it is main's open defect, a residual", () => {
    const HY = ["part-time", "full-time", "night-shift", "live-in", "e-commerce", "co-op", "k-12", "x-ray", "on-call", "per-diem", "over-the-road"];
    const bad: string[] = [];
    for (const h of HY) {
      const parts = h.split("-");
      const ex = splitExclusions(`worker not ${h}`).excluded;
      expect(ex, `${h} is excluded as typed`).toEqual([h]);
      if (!titleExcluded(`${tc(parts.join("-"))} Worker`, ex)) bad.push(`${h} misses ${tc(parts.join("-"))} Worker`);
      // Residual, as on origin/main: a title that spells it apart is kept.
      if (titleExcluded(`${tc(parts.join(" "))} Worker`, ex)) bad.push(`${h} strikes ${tc(parts.join(" "))} Worker: a fold came back`);
      for (let k = 0; k < 300; k++) {
        const title = Array.from({ length: 2 + Math.floor(R() * 4) }, () => pick([...parts, h, ...TITLE_WORDS])).join(" ");
        const mine = titleExcluded(title, [h]);
        if (mine !== LIVE_TITLE(title, [h])) bad.push(`${h} | ${title}: differs from main's match of the same word`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

const tc = (s: string) => s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
