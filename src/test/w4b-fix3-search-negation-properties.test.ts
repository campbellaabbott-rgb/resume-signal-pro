// @vitest-environment node
/**
 * NEGATED SEARCH PHRASES, GENERATED (wave 4 fix 3, S12-017).
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
 *     operators and the excluded words, and nothing is invented.
 * LIVE_RULE below is origin/main's splitExclusions (8a6561c4), copied as the
 * oracle: what production answers today.
 */
import { describe, expect, it } from "vitest";
import { NOT_COMPOUNDS, splitExclusions } from "../../supabase/functions/job-board/search-routing";
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
const clean = (s: string) => s.split(/\s+/).map((w) => w.replace(/[^a-z0-9+#.]/gi, "").replace(/\.+$/, "").toLowerCase()).filter(Boolean).join(" ");

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
      if (JSON.stringify(got) !== JSON.stringify(want) || JSON.stringify(got) !== JSON.stringify(LIVE_RULE(q))) bad.push(`${q} -> ${JSON.stringify(got)}`);
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
    for (const c of COMPOUNDS) for (const w of c.split(" ")) for (const k of [0, 1, 2]) expect(knownPlace(caseOf(w, k)), `${c}: ${w}`).toBeNull();
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
      if (JSON.stringify(got) !== JSON.stringify(live)) bad.push(`${q} -> ${JSON.stringify(got)} live ${JSON.stringify(live)}`);
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
