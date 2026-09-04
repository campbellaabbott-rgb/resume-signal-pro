/**
 * '"QUOTES" MATCH EXACT PHRASES' WAS FALSE FOR SIX WEEKS.
 *
 * The tip shipped 2026-07-18 (en.json phraseTip / phraseTipLong). On
 * 2026-08-20 the double quote joined sanitizeTerm's strip class — correctly,
 * because a typed quote inside a quoted or() value (`location.ilike."%, TX%"`)
 * closes it early. But queryTerms mapped EVERY whitespace token through
 * sanitizeTerm, so search_jobs received `product designer` and
 * websearch_to_tsquery read it as product AND designer: "Designer, Product
 * Marketing" ranked under a query whose quotes were the whole point.
 *
 * The fix tokenises balanced "…" pairs BEFORE the per-token sanitiser, so the
 * phrase survives as one multi-word term (unquoted, safe for every ILIKE
 * consumer) and phraseText() re-quotes it for the tsquery consumers. Nothing
 * in SQL changed: websearch_to_tsquery already emits 'regist' <-> 'nurs' for a
 * quoted pair, verified by executing the live search_jobs body in pglite —
 * "registered nurse" in quotes matched only adjacent occurrences while the
 * unquoted form matched both words anywhere (scratchpad/pglite-quoted-phrase).
 *
 * The REAL functions are extracted from index.ts and executed here, because a
 * regex that spells the mechanism passes while the mechanism is dead.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { sanitizeTerm } from "../../supabase/functions/_shared/location-terms";
import { salaryFromQueryText, SALARY_IN_QUERY } from "../../supabase/functions/job-board/filters.ts";
import { expandQuery } from "../../supabase/functions/job-board/search-alias";
import { scoreTitle, splitExclusions } from "../../supabase/functions/job-board/search-routing";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
/** Executable text only. A comment that spells the mechanism is not the mechanism. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*$/gm, "").replace(/ \/\/ [^\n]*$/gm, "");
const stripSql = (s: string) => s.replace(/--[^\n]*/g, "");

const RAW = read("supabase/functions/job-board/index.ts");
const BOARD = stripComments(RAW);
const SHARED = stripComments(read("supabase/functions/_shared/location-terms.ts"));
const EN = JSON.parse(read("src/i18n/locales/en.json")) as { jobsPage: Record<string, string> };

/** The shipped functions, transpiled and executed against the real sanitiser and pay-lift. */
const pipeline = (() => {
  const pick = (re: RegExp, name: string) => {
    const m = re.exec(RAW)?.[0];
    expect(m, `${name} has moved or been renamed`).toBeTruthy();
    return m!;
  };
  const src = [
    pick(/const QUERY_FILLER = new Set\(\[[\s\S]*?\]\);/, "QUERY_FILLER"),
    pick(/function ftsSafe\(t: string\): string \{[\s\S]*?\n\}/, "ftsSafe"),
    pick(/function ftsQuery\(raw: string\): string \{[\s\S]*?\n\}/, "ftsQuery"),
    pick(/function queryTerms\([\s\S]*?\n\}/, "queryTerms"),
    pick(/function phraseText\([\s\S]*?\n\}/, "phraseText"),
    "return { ftsSafe, ftsQuery, queryTerms, phraseText };",
  ].join("\n");
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function("sanitizeTerm", "salaryFromQueryText", "SALARY_IN_QUERY", js)(
    sanitizeTerm, salaryFromQueryText, SALARY_IN_QUERY,
  ) as {
    ftsSafe: (t: string) => string;
    ftsQuery: (t: string) => string;
    queryTerms: (raw: unknown) => { terms: string[]; dropped: string[]; liftedSalary: boolean };
    phraseText: (terms: readonly string[]) => string;
  };
})();
/** What search_jobs receives as p_q for a typed query (before alias expansion). */
const pq = (raw: string) => pipeline.phraseText(pipeline.queryTerms(raw).terms);

describe("a balanced pair of quotes survives to the RPC as one phrase", () => {
  it("keeps the pair, in place, and leaves an unquoted query byte-identical", () => {
    expect(pq('"registered nurse"')).toBe('"registered nurse"');
    expect(pq('"registered nurse" chicago')).toBe('"registered nurse" chicago');
    expect(pq('chicago "Registered Nurse"')).toBe('chicago "registered nurse"');
    expect(pq("registered nurse chicago")).toBe("registered nurse chicago");
    // The old pipeline — every token through the sanitiser — is the bug.
    const before = '"registered nurse"'.toLowerCase().split(/\s+/).map(sanitizeTerm).filter(Boolean).join(" ");
    expect(before, "sanity: the shipped pipeline used to strip the quotes").toBe("registered nurse");
  });

  it("hands the ILIKE consumers the phrase UNQUOTED — a quote in an or() branch closes it early", () => {
    // terms feed buildQuery's or(title.ilike…), count_jobs_capped's ILIKE and
    // the close-match title check. A contiguous substring match on
    // "registered nurse" is already an adjacency match; a literal quote in it
    // matches nothing.
    expect(pipeline.queryTerms('"registered nurse" chicago').terms).toEqual(["registered nurse", "chicago"]);
    for (const raw of ['"registered nurse"', 'nurse "chicago', '"" nurse', '"a" "b c" d', 'x"y z"']) {
      for (const t of pipeline.queryTerms(raw).terms) expect(t, `q=${raw} leaked a quote into a term`).not.toContain('"');
    }
    // and sanitizeTerm itself still strips the quote — the phrase survives
    // by tokenising BEFORE it, not by weakening it.
    const cls = /const sanitizeTerm = \(t: string\) => t\.replace\(\/\[([^\]]+)\]\/g, ""\)/.exec(SHARED)?.[1] ?? "";
    expect(cls, "sanitizeTerm must still strip the double quote").toContain('"');
  });

  it("a stray quote is stripped as it always was, and a single quoted word is just a word", () => {
    expect(pq('nurse "chicago')).toBe("nurse chicago");
    expect(pq('nurse chicago"')).toBe("nurse chicago");
    expect(pq('"nurses"')).toBe("nurses");
    expect(pq('""')).toBe("");
    expect(pq('"')).toBe("");
  });

  it("filler is kept INSIDE a phrase (the person asked for it) and still dropped outside", () => {
    expect(pq('"head of nursing"')).toBe('"head of nursing"');
    const outside = pipeline.queryTerms("head of nursing");
    expect(outside.terms).toEqual(["head", "nursing"]);
    expect(outside.dropped).toEqual(["of"]);
    expect(pipeline.queryTerms('"head of nursing"').dropped).toEqual([]);
  });

  it("composes with the pay lift, exclusions and alias expansion", () => {
    // Pay figure lifted, phrase kept.
    const pay = pipeline.queryTerms('"registered nurse" 100k');
    expect(pay.liftedSalary).toBe(true);
    expect(pay.terms).toEqual(["registered nurse"]);
    // Exclusions split off first, on the raw string; the phrase is untouched.
    const ex = splitExclusions('"registered nurse" -travel');
    expect(ex.excluded).toEqual(["travel"]);
    expect(pq(ex.positive)).toBe('"registered nurse"');
    // expandQuery refuses to touch a quoted query — "pm" inside quotes stays
    // "pm" — while the same words unquoted still expand.
    const quoted = expandQuery(pq('"senior pm"'));
    expect(quoted.q).toBe('"senior pm"');
    expect(quoted.expansions).toEqual([]);
    expect(expandQuery(pq("senior pm")).expansions.length, "sanity: pm still has aliases").toBeGreaterThan(0);
    // The scorer sees through the quotes: an adjacent title is not penalised
    // for the searcher having asked for adjacency, and beats a reversed one.
    expect(scoreTitle("Registered Nurse", '"registered nurse"')).toBe(scoreTitle("Registered Nurse", "registered nurse"));
    expect(scoreTitle("Registered Nurse", '"registered nurse"')).toBeGreaterThan(scoreTitle("Nurse, Registered", '"registered nurse"'));
  });

  it("the simple-config tiers get the pair too, and never a half-open one", () => {
    // ftsSafe feeds plain wfts() filters only; a balanced pair passes, an odd
    // count is stripped whole (websearch_to_tsquery would otherwise read a
    // phrase running to the end of the query — silently, not as an error).
    expect(pipeline.ftsSafe('"it manager"')).toBe('"it manager"');
    expect(pipeline.ftsSafe('"it manager')).toBe("it manager");
    expect(pipeline.ftsSafe('it manager"')).toBe("it manager");
    expect(pipeline.ftsSafe('"a, b" (c)')).toBe('"a b" c');
    expect(pipeline.ftsQuery("nurses"), "the possessive variant is untouched").toBe("nurses or nurse s");
    expect(pipeline.ftsQuery('"registered nurse"')).toBe('"registered nurse"');
    for (const site of [/\.textSearch\("title", ftsQuery\(qText\)/, /\.textSearch\("company", ftsQuery\(qText\)/]) {
      expect(BOARD, "the simple tiers must still bind through ftsQuery").toMatch(site);
    }
    expect(BOARD, "ftsSafe must not be spread into an or() branch").not.toMatch(/\.or\([^)]*ftsSafe/);
  });
});

describe("the wiring: phraseText feeds BOTH query derivations and the RPC, and only the tsquery consumers", () => {
  it("qText and its count twin are built with phraseText, never a plain join", () => {
    expect(BOARD).toMatch(/const qText = phraseText\(qt\.terms\)\.slice\(0, 200\)/);
    expect(BOARD).toMatch(/const qTextC = phraseText\(qtC\.terms\)\.slice\(0, 200\)/);
    expect(BOARD).not.toMatch(/qtC?\.terms\.join\(" "\)/);
  });

  it("search_jobs receives the expandQuery output of that text, on the ranked path and the count probe", () => {
    expect(BOARD).toMatch(/const \{ q: expandedQ, expansions \} = expandQuery\(qText\);/);
    expect(BOARD).toMatch(/client\.rpc\("search_jobs", \{\s*p_q: expandedQ,/);
    expect(BOARD).toMatch(/const \{ q: expQC \} = expandQuery\(qTextC\);/);
    expect(BOARD).toMatch(/client\.rpc\("search_jobs", \{\s*p_q: expQC,/);
  });

  it("the ILIKE facet count strips the quotes it would otherwise match literally", () => {
    // count_jobs_capped binds p.title ILIKE '%' || $10 || '%' — verified in
    // pglite: '"registered nurse"' counts 0, 'registered nurse' counts the
    // adjacent titles. The other ILIKE caller sends qTerms[0], already unquoted.
    expect(BOARD).toMatch(/client\.rpc\("count_jobs_capped", \{\s*p_fresh_cutoff: freshCutoffIso,\s*p_q: qText\.replace\(\/"\/g, ""\),/);
    expect(BOARD).toMatch(/p_q: qTerms\.length === 1 \? qTerms\[0\] : null,/);
  });

  it("tokenises the pairs before the per-token sanitiser", () => {
    const fn = /function queryTerms\([\s\S]*?\n\}/.exec(BOARD)?.[0] ?? "";
    expect(fn).toMatch(/\.match\(\/"\[\^"\]\*"\|\\S\+\/g\)/);
    expect(fn).toMatch(/t\.slice\(1, -1\)\.split\(\/\\s\+\/\)\.map\(sanitizeTerm\)/);
  });
});

describe("the SQL the phrase reaches parses it as a phrase", () => {
  const dir = resolve(__dirname, "../../supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const defines = (f: string) => /CREATE (OR REPLACE )?FUNCTION public\.search_jobs\(/.test(stripSql(read(`supabase/migrations/${f}`)));
  const latest = files.filter(defines).at(-1)!;

  it("the LATEST search_jobs builds its tsquery with websearch_to_tsquery, the parser that emits <-> for a quoted pair", () => {
    expect(latest, "no migration defines search_jobs").toBeTruthy();
    const sql = stripSql(read(`supabase/migrations/${latest}`));
    const body = sql.slice(sql.indexOf("FUNCTION public.search_jobs("));
    expect(body).toMatch(/q tsquery := websearch_to_tsquery\('english', p_q\);/);
    // plainto_tsquery / to_tsquery would read the quotes as noise or as syntax
    // errors respectively; neither is a phrase.
    expect(body).not.toMatch(/plainto_tsquery\([^)]*p_q/);
    expect(body).not.toMatch(/(^|[^_a-z])to_tsquery\('english', p_q\)/);
    // The related-segment ordering loosens & to | on the PARSED tree, so a
    // phrase's <-> stays whole (pglite: 'regist' <-> 'nurs' | 'merci').
    expect(body).toMatch(/replace\(querytree\(q\), '&', '\|'\)::tsquery/);
    // Both tiers match the same parsed query against a positional tsvector.
    expect(body).toMatch(/p\.title_tsv @@ \$1/);
    expect(body).toMatch(/p\.search_tsv @@ \$1/);
  });

  it("the tsvectors keep positions — a phrase operator against strip()ped vectors matches nothing", () => {
    const defs = files.filter((f) => /title_tsv tsvector\s+GENERATED ALWAYS AS/.test(stripSql(read(`supabase/migrations/${f}`))));
    expect(defs.length).toBeGreaterThan(0);
    const def = stripSql(read(`supabase/migrations/${defs.at(-1)!}`));
    expect(def).toMatch(/to_tsvector\('english', coalesce\(title, ''\)\)/);
    expect(def).not.toMatch(/strip\(to_tsvector/);
  });

  it("the tip still promises what the mechanism now delivers", () => {
    expect(EN.jobsPage.phraseTip).toMatch(/"quotes"/);
    expect(EN.jobsPage.phraseTipLong).toMatch(/quotes/);
  });
});
