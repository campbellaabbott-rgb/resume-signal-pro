// @vitest-environment node
/**
 * NEGATED SEARCH PHRASES, GENERATED: THE SHIPPED ANSWER IS ORIGIN/MAIN'S
 * (wave 4 descope, 2026-10-25; S12-017 left wave 4).
 *
 * Four fix rounds changed how far "not" reaches and how an excluded word
 * strikes a title, and every recheck found inputs where a round was worse than
 * origin/main. The descope of 2026-10-25 took the title folds out but kept
 * rounds 3 and 4's split, and its recheck found that mix worse than main too:
 * a single-letter slash pair ("not a/p") excluded nothing, a slash pair that
 * names one thing ("med/surg") struck "Med Tech" titles, and a compound typed
 * with a space or as a plural ("not part time", "not night shifts") stopped
 * striking the hyphenated and singular titles main strikes. So the whole
 * exclusion path is origin/main's again, byte for byte, and S12-017 is its own
 * search project.
 *
 * This file walks combinations no one listed, from a fixed seed so a failure
 * reproduces, and asks one thing of each: the shipped splitExclusions answers
 * exactly what origin/main's does, and the shipped titleExcluded strikes
 * exactly the titles origin/main's strikes. The shapes it walks are the ones
 * the rounds changed: one negated word before any place, known or invented;
 * round 4's pinned compounds, typed with a space, a hyphen, run together or
 * as a plural, before titles spelled each of those ways; round 4's pinned
 * regions and cities; slash pairs of letters, words and digits; "not A or B";
 * a verb or an article after "not"; quoted phrases; and random queries.
 * ORIGIN_MAIN is origin/main's code at ef4fb53e, frozen in
 * fixtures/w4b-fix3-search/origin-main-exclusion.ts. ROUND4_COMPOUNDS and
 * ROUND4_PLACES are the lists round 4 pinned, kept here as data so the walk
 * still reaches the shapes they named; nothing in the shipped code reads them.
 */
import { describe, expect, it } from "vitest";
import * as SHIPPED from "../../supabase/functions/job-board/search-routing";
import * as ORIGIN_MAIN from "./fixtures/w4b-fix3-search/origin-main-exclusion";

const ROUND4_COMPOUNDS = ["night shift", "overnight shift", "graveyard shift", "weekend shift", "evening shift", "swing shift",
  "rotating shift", "split shift", "double shift", "day shift", "late shift", "early shift", "morning shift", "first shift",
  "second shift", "third shift", "1st shift", "2nd shift", "3rd shift", "noc shift", "nite shift", "pm shift", "am shift",
  "afternoon shift", "mid shift", "midnight shift", "box truck", "dump truck", "tow truck", "call center", "call centre",
  "contact center", "contact centre", "home health", "home care", "customer service", "field service", "help desk", "tech support",
  "technical support", "data entry", "fast food", "general labor", "general labour", "team lead", "team leader", "part time",
  "full time", "entry level", "per diem", "new grad", "commission only", "cold calling", "cold call", "door knocking",
  "heavy lifting", "long haul", "cold storage", "line cook", "tech lead", "assisted living", "skilled nursing", "light industrial",
  "fine dining", "heavy equipment", "reach truck", "day care", "overnight travel", "on call", "home health care", "home health aide",
  "long term care", "door to door", "12 hour shift", "10 hour shift", "8 hour shift"];
const ROUND4_PLACES = ["san jose", "new orleans", "long beach", "baton rouge", "little rock", "sioux falls", "fort lauderdale",
  "st louis", "grand rapids", "corpus christi", "fort myers", "fort wayne", "fort collins", "colorado springs", "palo alto",
  "santa rosa", "santa ana", "santa clara", "santa barbara", "santa monica", "santa cruz", "san mateo", "san bernardino", "ann arbor",
  "virginia beach", "boca raton", "winston salem", "new haven", "thousand oaks", "round rock", "sugar land", "college station",
  "cedar park", "cedar rapids", "st petersburg", "st paul", "saint paul", "palm beach", "west palm beach", "palm springs",
  "overland park", "chapel hill", "south bend", "green bay", "mountain view", "redwood city", "menlo park", "newport news",
  "cape coral", "myrtle beach", "iowa city", "atlantic city", "staten island", "new england", "west coast", "east coast",
  "gulf coast", "long island", "inland empire", "silicon valley", "twin cities", "east bay", "pacific northwest",
  "upstate new york", "central valley", "south florida", "north florida", "central florida", "north texas", "south texas",
  "central texas", "east texas", "west texas", "southern california", "northern california"];

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
const R = rng(20261025);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(R() * xs.length)];
const caseOf = (s: string, k: number) => (k === 0 ? s.toLowerCase() : k === 1 ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : k === 2 ? s.toUpperCase() : s);
const tc = (s: string) => s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const TITLES = ["nurse", "rn", "registered nurse", "warehouse", "driver", "truck driver", "teacher", "accountant", "barista", "cook",
  "line cook", "chef", "cashier", "electrician", "software engineer", "developer", "welder", "data analyst", "security guard",
  "pharmacist", "mechanic", "receptionist", "project manager", "caregiver", "plumber", "paralegal", "cna", "bartender", "recruiter",
  "clerk", "technician", "rep", "agent", "aide", "worker"];
const NEGS = ["senior", "junior", "travel", "night", "overnight", "contract", "temp", "forklift", "cdl", "substitute", "icu", "agency",
  "lead", "manager", "sales", "commission", "weekend", "intern", "apprentice", "staffing", "union", "federal", "clearance", "part-time",
  "otr", "sous", "line", "remote", "prn", "er", "seasonal", "box", "call", "home", "c++", ".net", "crypto", "unpaid", "news", "parts",
  "account", "accounts", "contracts", "nights", "shifts", "full-time", "e-commerce", "k-12", "live-in", "on-call", "per-diem"];
const PLACES = ["Dallas", "Chicago", "Houston", "Austin", "Denver", "Phoenix", "Boston", "San Antonio", "Los Angeles", "Kansas City",
  "Salt Lake City", "St. Louis", "Fort Worth", "Jacksonville", "Tulsa", "Spokane", "Fresno", "San Jose", "Oakland", "Long Beach",
  "Richmond", "Norfolk", "Rochester", "Albany", "Hartford", "Providence", "Jackson", "Birmingham", "New Orleans", "Baton Rouge",
  "Little Rock", "Madison", "Texas", "Florida", "New Jersey", "North Carolina", "TX", "CA", "NY", "nyc", "sf", "la", "bay area", "dfw",
  "atl", "socal", "uk", "us", "nz", "canada", "germany", "new zealand", "london", "toronto", "Austin, TX", "Dallas TX", "San Jose, CA",
  "tulsa ok", "75201", "remote", "hybrid", "part time", "full time", "remote us", "new york", "York", "Reading", "Mobile", "Normal"];
const SLASHES = ["a/p", "a/r", "p/t", "f/t", "l/d", "w/e", "med/surg", "tcp/ip", "ob/gyn", "ar/ap", "lpn/lvn", "icu/ccu", "ui/ux",
  "jr/sr", "senior/lead", "travel/agency", "24/7", "9/80", "3/12", "m/f", "c/c++"];
const SYL = ["bor", "ell", "an", "ton", "vil", "ma", "ker", "ridge", "ham", "lo", "sta", "wen", "dor", "ast", "ion", "qu", "ex", "zel"];
const invented = () => { let w = ""; const n = 2 + Math.floor(R() * 3); for (let i = 0; i < n; i++) w += pick(SYL); return R() < 0.5 ? w[0].toUpperCase() + w.slice(1) : w; };

/** Every spelling of a phrase a title might carry: apart, hyphenated, run together, and with or without a plural last word. */
function spellings(phrase: string): string[] {
  const ws = phrase.split(/[\s/-]+/).filter(Boolean);
  const sing = ws.map((w, i) => (i === ws.length - 1 ? w.replace(/(?<=[^s])s$/, "") : w));
  const plur = ws.map((w, i) => (i === ws.length - 1 && !/s$/.test(w) ? `${w}s` : w));
  return [...new Set([ws, sing, plur].flatMap((x) => [x.join(" "), x.join("-"), x.join(""), x.join("/")]))];
}
/** Titles around a phrase: before the head, after a dash, in brackets, alone, and beside unrelated words. */
function titlesFor(head: string, phrase: string): string[] {
  const H = tc(head);
  return spellings(phrase).flatMap((s) => [`${tc(s)} ${H}`, `${H} - ${tc(s)}`, `${H} (${tc(s)})`, `${H} ${s.toUpperCase()}`]);
}
const OTHER_TITLES = ["Certified Med Tech", "Nuclear Med Tech - Per Diem", "Med Spa Nurse", "IP Engineer", "AP Clerk", "A/P Clerk",
  "Accounts Payable Manager", "Contracts Administrator", "New Grad RN", "Part-Time Driver", "Store Managers", "Long Beach Driver",
  "Nurse - New York", "Night Shift RN", "Box Truck Driver", "Call Center Agent", "Customer Services Rep", "Parttime Barista",
  "Ecommerce Developer", "K12 Teacher", "Cashier (Full-Time & Part-Time)", "Cashier - PT", "Travel ER Nurse", "ER Nurse"];

const bad: string[] = [];
/** The shipped answer to q, and its strikes over the given titles, against origin/main's. Records any difference. */
function same(q: string, titles: readonly string[] = []): void {
  const got = SHIPPED.splitExclusions(q), want = ORIGIN_MAIN.splitExclusions(q);
  if (JSON.stringify(got) !== JSON.stringify(want)) { bad.push(`${q}: shipped ${JSON.stringify(got)}, origin/main ${JSON.stringify(want)}`); return; }
  for (const t of [...titles, ...OTHER_TITLES]) {
    const a = SHIPPED.titleExcluded(t, got.excluded), b = ORIGIN_MAIN.titleExcluded(t, want.excluded);
    if (a !== b) bad.push(`${q} | ${t}: shipped ${a ? "strikes" : "keeps"} it, origin/main ${b ? "strikes" : "keeps"} it`);
  }
}
const run = (fn: () => void) => { bad.length = 0; fn(); return bad.slice(0, 10); };

describe("the shipped exclusion answers every generated query exactly as origin/main does", () => {
  it("one negated word before any place, any case, a preposition or an invented word", () => {
    expect(run(() => {
      for (let k = 0; k < 3000; k++) {
        const t = caseOf(pick(TITLES), Math.floor(R() * 3)), n = pick(NEGS);
        const tail = R() < 0.2 ? invented() : caseOf(pick(PLACES), Math.floor(R() * 4));
        const prep = R() < 0.15 ? `${pick(["in", "near", "around"])} ` : "";
        same(`${t} not ${n} ${prep}${tail}`, titlesFor(t.split(" ")[0], n));
        same(`${t} -${n} ${prep}${tail}`);
      }
    })).toEqual([]);
  });

  it("round 4's pinned compounds, typed apart, hyphenated, run together or plural, before titles spelled every way", () => {
    expect(run(() => {
      for (const c of ROUND4_COMPOUNDS) {
        for (const typed of spellings(c)) {
          const t = pick(TITLES), tail = R() < 0.4 ? "" : ` ${pick(PLACES)}`;
          const head = t.split(" ")[0];
          same(`${t} not ${caseOf(typed, Math.floor(R() * 3))}${tail}`, titlesFor(head, c));
          same(`${t} not requiring ${typed}${tail}`, titlesFor(head, c));
          same(`${t} not the ${typed}`, titlesFor(head, c));
          same(`${t} -"${typed}"${tail}`, titlesFor(head, c));
        }
      }
    })).toEqual([]);
  });

  it("round 4's pinned regions and cities, alone and after a negated word", () => {
    expect(run(() => {
      for (const p of ROUND4_PLACES) for (const k of [0, 1, 2]) {
        const t = pick(TITLES), n = pick(NEGS);
        same(`${t} not ${caseOf(p, k)}`, titlesFor(t.split(" ")[0], p));
        same(`${t} not ${n} ${caseOf(p, k)}`, titlesFor(t.split(" ")[0], n));
      }
    })).toEqual([]);
  });

  it("slash pairs of letters, words and digits, after 'not' and after a minus, alone or in 'not A or B'", () => {
    expect(run(() => {
      for (const s of SLASHES) for (const t of TITLES) {
        const titles = [...titlesFor(t.split(" ")[0], s), ...s.split("/").map((w) => `${tc(w)} ${tc(t)}`)];
        same(`${t} not ${s}`, titles);
        same(`${t} -${s}`, titles);
        same(`${t} not -${s}`, titles);
        same(`${t} not ${s} Dallas`, titles);
        same(`${t} not ${s} or ${pick(SLASHES)}`, titles);
      }
    })).toEqual([]);
  });

  it("'not A or B', a capital OR, and a list with commas", () => {
    expect(run(() => {
      for (let k = 0; k < 2000; k++) {
        const t = pick(TITLES), a = pick(NEGS), b = pick(NEGS), tail = pick(["", " Dallas", " remote", " San Jose", " TX"]);
        const titles = [...titlesFor(t.split(" ")[0], a), ...titlesFor(t.split(" ")[0], b)];
        same(`${t} not ${a} ${pick(["or", "nor", "Or", "OR"])} ${b}${tail}`, titles);
        same(`${t} not ${a}, or ${b}${tail}`, titles);
        same(`${t.toUpperCase()} NOT ${a.toUpperCase()} OR ${b.toUpperCase()}`, titles);
      }
    })).toEqual([]);
  });

  it("random queries over the same words, with stray operators, quotes and stops", () => {
    const VOCAB = [...new Set([...TITLES.flatMap((t) => t.split(" ")), ...NEGS, ...ROUND4_COMPOUNDS.flatMap((c) => c.split(" ")),
      ...ROUND4_PLACES.flatMap((p) => p.split(" ")), ...SLASHES, "jobs", "for", "in", "the", "a", "-travel", "-senior", "\"team", "lead\"",
      "shift.", "night,", "-", "not", "NOT", "requiring", "with"])];
    expect(run(() => {
      for (let k = 0; k < 8000; k++) {
        const ws = Array.from({ length: 1 + Math.floor(R() * 7) }, () => (R() < 0.2 ? caseOf("not", Math.floor(R() * 3)) : R() < 0.08 ? invented() : pick(VOCAB)));
        const q = ws.join(" ");
        same(q, ws.filter((w) => !/^not$/i.test(w)).slice(0, 3).map((w) => `${tc(w.replace(/[^a-z0-9/-]/gi, ""))} Worker`));
      }
    })).toEqual([]);
  });
});
