// @vitest-environment node
/**
 * THE QUERY READER READS EVERY REAL QUERY AT LEAST AS WELL AS MAIN
 * (connect W1/W3 corpus rule, 2026-11-08).
 *
 * agent-mcp/query-place.ts now lifts more than a trailing "in <place>":
 * sponsorship words, date words, "jobs at <employer>", a place with no
 * preposition, a city with its country, and the board's other languages. Each
 * is a heuristic over free text, so it is held to a corpus
 * (fixtures/model-queries-2026-11.json, saved beside the build's other corpora
 * in ~/.config/resumebooster/seo-connect-build/corpora/):
 *
 *   - seeker: 186 queries people and models send (the browse lens's live calls
 *     among them), each with the reading it should get. Every one exact. The
 *     recheck's seventeen (source recheck-role-state and recheck-metro, 2026-11-08)
 *     are title words before a state code ("Customer Service TX" once searched
 *     a town called Service), which main kept whole and so must this reader,
 *     and a metro shorthand before a state code.
 *   - titles: 1,967 of the board's own titles that carry a place, a date, a
 *     sponsorship or an employer word, each with its row. A title typed as a
 *     query must still find its row: read whole, or lifted only to a place,
 *     country or employer the row itself has. Judged end to end, after the
 *     board's own trailing-place lift (job-board/query-place.ts), because that
 *     is what the board searches. Never a date window from a title.
 *   - country: S13-041's 1,115 country cases, scored 0 right, 1 nothing read,
 *     2 a wrong country.
 *   - locationArgs: 31 location arguments and what each is sent as.
 *
 * mainRight and mainScore are origin/main's reader on each case (f7961447),
 * recorded when the corpus was built, so "never worse than main" holds here
 * without reading git.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { liftTrailingPlace } from "../../supabase/functions/job-board/query-place";
import { readLocationArg, readQuery } from "../../supabase/functions/agent-mcp/query-place";

type Want = { query: string; location?: string; country?: string; remote?: true; maxAgeDays?: number; companies?: string[]; sponsorship?: true };
type TitleRow = { title: string; company: string; location: string | null; country: string | null; seed: string; mainRight: boolean };
type CountryCase = { q: string; place: string; want: string | null; group: string; mainScore: 0 | 1 | 2 };
const CORPUS = JSON.parse(readFileSync(resolve(__dirname, "fixtures/model-queries-2026-11.json"), "utf8")) as {
  seeker: Array<{ q: string; want: Want; source: string }>;
  locationArgs: Array<{ location: string; want: { location: string; country?: string } | null }>;
  titles: TitleRow[];
  country: CountryCase[];
};

/** job-board's QUERY_FILLER, read from its source so the end-to-end judge is the board's. */
const QUERY_FILLER: ReadonlySet<string> = (() => {
  const src = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
  const at = src.indexOf("const QUERY_FILLER = new Set([");
  if (at < 0) throw new Error("job-board QUERY_FILLER moved: point this test at it");
  const body = src.slice(at, src.indexOf("]);", at)).split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  return new Set([...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
})();

/** What the board searches: the connector's reading, then the board's own trailing-place lift on a query sent with no place. */
function endToEnd(r: Record<string, unknown>): Record<string, unknown> {
  if (r.location || r.country) return r;
  const lift = liftTrailingPlace(String(r.query ?? ""), QUERY_FILLER);
  return lift ? { ...r, query: lift.head || r.query, ...lift.patch } : r;
}

const KEYS = ["query", "location", "country", "remote", "maxAgeDays", "companies"] as const;
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const STATE: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware", FL: "florida", GA: "georgia",
  HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland",
  MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire",
  NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania",
  RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington",
  WV: "west virginia", WI: "wisconsin", WY: "wyoming", DC: "district of columbia", ON: "ontario", BC: "british columbia", AB: "alberta", QC: "quebec",
};

function titleOk(r: Record<string, unknown>, row: TitleRow): boolean {
  if (r.maxAgeDays !== undefined) return false;
  if (r.query === row.title) return true;
  const tokens = (x: string) => fold(x).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (r.sponsorship && !(tokens(String(r.query)).length && tokens(String(r.query)).every((w) => tokens(row.title).includes(w)))) return false;
  if (!String(r.query ?? "").trim()) return false;
  const loc = fold(row.location ?? "");
  if (typeof r.location === "string") {
    const l = fold(r.location);
    const cs = /^(.+),\s*([a-z]{2})$/.exec(l);
    const okLoc = loc.includes(l)
      || (cs ? loc.includes(cs[1]) && (loc.includes(`, ${cs[2]}`) || loc.includes(STATE[cs[2].toUpperCase()] ?? "@@")) : false)
      || Object.entries(STATE).some(([c, n]) => n === l && (loc.includes(`, ${c.toLowerCase()}`) || loc.includes(n)));
    if (!okLoc) return false;
  }
  if (typeof r.country === "string" && r.country !== row.country) return false;
  if (r.remote && !/remote|anywhere/.test(loc)) return false;
  if (Array.isArray(r.companies)) {
    const n = fold(String(r.companies[0])), c = fold(row.company ?? "");
    if (!(c.includes(n) || n.includes(c))) return false;
  }
  return true;
}

function countryScore(r: Record<string, unknown>, c: CountryCase): 0 | 1 | 2 {
  if (r.country && r.country !== c.want) return 2;
  if (r.country === c.want && c.want) return 0;
  if (typeof r.location === "string" && fold(c.place).includes(fold(r.location).replace(/,\s*/g, ", "))) return 0;
  if (typeof r.location === "string" && fold(c.place).replace(/,\s*/g, " ").includes(fold(r.location).replace(/,\s*/g, " "))) return 0;
  return c.want ? 1 : (r.location || r.country ? 2 : 0);
}

describe("the corpus is the size the rule asks for", () => {
  it("holds at least 300 real cases in all, and each part is whole", () => {
    expect(CORPUS.seeker.length).toBeGreaterThanOrEqual(150);
    expect(CORPUS.titles.length).toBeGreaterThanOrEqual(1_900);
    expect(CORPUS.country.length).toBeGreaterThanOrEqual(1_100);
    expect(CORPUS.seeker.length + CORPUS.titles.length + CORPUS.country.length + CORPUS.locationArgs.length).toBeGreaterThanOrEqual(300);
    expect(QUERY_FILLER.has("jobs")).toBe(true);
  });

  it("holds the recheck's title words before a state code", () => {
    expect(CORPUS.seeker.filter((s) => s.source === "recheck-role-state").length).toBeGreaterThanOrEqual(15);
    expect(CORPUS.seeker.map((s) => s.q)).toEqual(expect.arrayContaining(["Customer Service TX", "Nurse ICU CA", "Data Entry CA", "Customer Service, TX"]));
  });
});

describe("every seeker query gets the reading it should", () => {
  it("all of them, exactly", () => {
    const wrong = CORPUS.seeker.filter(({ q, want }) => {
      const r = readQuery(q) as Record<string, unknown>;
      return KEYS.some((k) => JSON.stringify(r[k] ?? null) !== JSON.stringify((want as Record<string, unknown>)[k] ?? null)) || !!r.sponsorship !== !!want.sponsorship;
    }).map(({ q, want }) => ({ q, want, got: readQuery(q) }));
    expect(wrong).toEqual([]);
  });
});

describe("a title typed as a query still finds its own row", () => {
  it("every title main read right, this reader reads right", () => {
    const lost = CORPUS.titles.filter((row) => row.mainRight && !titleOk(endToEnd(readQuery(row.title) as Record<string, unknown>), row))
      .map((row) => ({ title: row.title, location: row.location, country: row.country, got: endToEnd(readQuery(row.title) as Record<string, unknown>) }));
    expect(lost).toEqual([]);
  });

  it("no title becomes a date window", () => {
    expect(CORPUS.titles.filter((row) => readQuery(row.title).maxAgeDays !== undefined).map((r) => r.title)).toEqual([]);
  });
});

describe("a country is never read wronger than main read it", () => {
  it("each S13-041 case scores no worse, and the total does not rise", () => {
    let mine = 0, main = 0;
    const worse: unknown[] = [];
    for (const c of CORPUS.country) {
      const s = countryScore(readQuery(c.q) as Record<string, unknown>, c);
      mine += s;
      main += c.mainScore;
      if (s > c.mainScore) worse.push({ q: c.q, want: c.want, main: c.mainScore, got: readQuery(c.q) });
    }
    expect(worse).toEqual([]);
    expect(mine).toBeLessThanOrEqual(main);
  });
});

describe("a location argument is sent as the place it names", () => {
  it("every one", () => {
    const wrong = CORPUS.locationArgs.filter(({ location, want }) => {
      const r = readLocationArg(location);
      const got = r ? { location: r.location, ...(r.country ? { country: r.country } : {}) } : null;
      return JSON.stringify(got) !== JSON.stringify(want);
    });
    expect(wrong).toEqual([]);
  });
});
