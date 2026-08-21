import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE BOARD'S ONLY TOTAL BLACKOUT, AND ITS WORST WRONG ANSWER.
 *
 * MEASURED: q="AT&T" returned ZERO against 493 live AT&T postings, and no
 * rescue tier fired. q="AT&T engineer" was worse than empty — it returned 60
 * generic engineers from Bosch, ProSidian and AECOM, presenting other
 * companies' jobs as AT&T matches.
 *
 * The jobs were never unreachable. The filter works and the directory was
 * already in every response:
 *   {"companies":["att~wd1~ATTGeneral"]}                 -> 484 rows
 *   {"companies":["att~wd1~ATTGeneral"],"q":"engineer"}  ->  55 rows
 * Only the routing was missing.
 *
 * NO QUERY-SIDE TEXT FIX COULD HAVE WORKED. Every tsvector in the schema is
 * built with the 'english' configuration, which discards "at" as a stopword and
 * "t" as a one-character token, so AT&T is not in the index at all. Matching
 * against a DIRECTORY sidesteps the index, which is what makes this free of SQL.
 *
 * THE RISK THIS TRADES FOR, and the reason most of the assertions below are
 * about NOT firing: a false positive is worse than the miss it replaces.
 * Routing "shell assessed internship program" — a real query from this board's
 * own miss log — to Shell would bury every other employer's assessed-internship
 * roles behind a filter the searcher never asked for, and they would have no
 * way to know why.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

/**
 * The shipped router, reconstructed. Vitest cannot import a Deno module, so the
 * behaviour is re-implemented from the same rules and the SOURCE assertions
 * below pin that the shipped code still implements them. Neither half is
 * sufficient alone: the reimplementation would drift silently, and the source
 * checks cannot tell you what the function returns.
 */
const AMBIGUOUS = (() => {
  const block = /const AMBIGUOUS_COMPANY_WORDS = new Set\(\[([\s\S]*?)\]\);/.exec(FN)?.[1] ?? "";
  return new Set([...block.matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]));
})();
const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

type Entry = { name: string; token: string };
function route(q: string, facet: Entry[]) {
  const byName = new Map<string, { tokens: Set<string>; display: string; entries: number }>();
  for (const e of facet) {
    const key = fold(e.name);
    if (!key) continue;
    const cur = byName.get(key);
    if (cur) { cur.tokens.add(e.token); cur.entries += 1; }
    else byName.set(key, { tokens: new Set([e.token]), display: e.name, entries: 1 });
  }
  const take = (k: string, residual: string) => {
    const h = byName.get(k);
    if (!h || h.entries > 1) return null;
    return { tokens: [...h.tokens], matchedName: h.display, residualQ: residual };
  };
  const folded = fold(q);
  if (folded.length < 2) return null;
  const whole = take(folded, "");
  if (whole) return whole;
  const words = q.trim().split(/\s+/).filter(Boolean);
  for (let n = words.length - 1; n >= 1; n--) {
    const span = fold(words.slice(0, n).join(""));
    if (span.length < 3) continue;
    if (n === 1 && AMBIGUOUS.has(span)) continue;
    const hit = take(span, words.slice(n).join(" "));
    if (hit) return hit;
  }
  return null;
}

const DIR: Entry[] = [
  { name: "AT&T", token: "att~wd1~ATTGeneral" },
  { name: "General Motors", token: "gm~wd1~GM" },
  { name: "Target", token: "target~wd1~T" },
  { name: "Shell", token: "shell~wd3~S" },
  { name: "Domino's", token: "dominos" },
  { name: "Acme", token: "acme-a" },
  { name: "ACME", token: "acme-b" },   // two entries folding to one name
  { name: "HP", token: "hp~wd1~HP" },
];

describe("an employer name reaches its own jobs", () => {
  it("routes the name that was returning nothing at all", () => {
    const r = route("AT&T", DIR);
    expect(r?.tokens, "AT&T must route to its company token").toEqual(["att~wd1~ATTGeneral"]);
    expect(r?.residualQ, "the whole query was the name, so nothing is left to search for").toBe("");
    // Punctuation and case are folded away — the index cannot see "&" either.
    expect(route("at&t", DIR)?.tokens).toEqual(["att~wd1~ATTGeneral"]);
    expect(route("ATT", DIR)?.tokens).toEqual(["att~wd1~ATTGeneral"]);
    expect(route("Domino's", DIR)?.tokens).toEqual(["dominos"]);
  });

  it("keeps the rest of the query as a search WITHIN that employer", () => {
    // The case that was serving wrong answers rather than none.
    const r = route("AT&T engineer", DIR);
    expect(r?.tokens).toEqual(["att~wd1~ATTGeneral"]);
    expect(r?.residualQ, "the role must survive as the text query").toBe("engineer");
    // Longest span wins, so a two-word employer is not mistaken for a one-word one.
    const gm = route("general motors engineer", DIR);
    expect(gm?.matchedName).toBe("General Motors");
    expect(gm?.residualQ).toBe("engineer");
  });

  it("REFUSES a common word used generically — the false positive that matters", () => {
    // From this board's own miss log. Routing it hides every other employer's
    // assessed-internship programme behind a filter nobody asked for.
    expect(route("shell assessed internship program", DIR), "must not route to Shell").toBeNull();
    expect(route("target manager", DIR), "must not route to Target").toBeNull();
    // But the same names ARE reachable by typing them alone, which is an
    // unambiguous statement of intent.
    expect(route("shell", DIR)?.matchedName).toBe("Shell");
    expect(route("target", DIR)?.matchedName).toBe("Target");
    // "general" alone is ambiguous as a prefix, yet "General Motors" is not.
    expect(route("general engineer", DIR), "a bare ambiguous word must not route").toBeNull();
  });

  it("refuses when two different employers fold to the same name", () => {
    expect(route("acme", DIR), "Acme and ACME are two entries — guessing hides one").toBeNull();
  });

  it("does not fire on ordinary job searches", () => {
    for (const q of ["engineer", "registered nurse", "remote python developer", "warehouse", ""]) {
      expect(route(q, DIR), `"${q}" must not be treated as an employer`).toBeNull();
    }
  });

  it("the shipped code implements these rules, not a paraphrase of them", () => {
    expect(/export function routeEmployerQuery\(/.test(FN)).toBe(true);
    // Ambiguity guard applies only to a ONE-WORD span; a two-word coincidence
    // is vanishingly rarer and must stay routable.
    expect(/if \(n === 1 && AMBIGUOUS_COMPANY_WORDS\.has\(span\)\) continue;/.test(FN)).toBe(true);
    // Two directory entries folding together is refused, never guessed.
    expect(/if \(!hit \|\| hit\.entries > 1\) return null;/.test(FN)).toBe(true);
    // Longest span first.
    expect(/for \(let n = words\.length - 1; n >= 1; n--\)/.test(FN)).toBe(true);
    expect(AMBIGUOUS.size, "the ambiguity list failed to parse — every refusal check above is vacuous")
      .toBeGreaterThan(20);
  });

  it("never overrides a company filter the caller set explicitly", () => {
    // Asked of the DERIVED filter, not the raw body — board-filter-contract
    // forbids reading a filter off the request, because the second derivation
    // is the one that drifts.
    expect(
      /preFilters\.applied\.companies\.length === 0/.test(FN),
      "an explicit companies filter must win over an inferred one, and the check must read " +
        "the derived filter rather than body.companies",
    ).toBe(true);
    expect(/body\.companies/.test(FN), "no filter may be re-derived from the raw body").toBe(false);
  });

  it("ACTUALLY APPLIES the route — computing it and announcing it is not enough", () => {
    // THIS ASSERTION EXISTS BECAUSE ITS ABSENCE COST THE WHOLE FEATURE.
    //
    // A commit dropped the three lines that rewrite the body, and every one of
    // the other tests in this file stayed GREEN. routeEmployerQuery still ran,
    // the response still announced companyMatched, the disclosure count was
    // still 4 — and no companies filter was ever applied, so "AT&T" returned
    // exactly the zero rows it had before, while claiming it had matched AT&T.
    // Worse than the original bug, because the payload asserted a match that
    // had not happened.
    //
    // Everything the old tests checked was upstream of the effect. A feature is
    // not the computation of an intent, it is the application of one.
    expect(
      /if \(employerRoute\) \{\s*\n\s*body = \{ \.\.\.body, companies: employerRoute\.tokens, q: employerRoute\.residualQ \};/.test(FN),
      "the employer route must REWRITE the request — without this the filter is never bound " +
        "and the board announces a match it did not make",
    ).toBe(true);
    // And the rewrite must be consumed: the derivation that feeds the board has
    // to be the one taken AFTER it.
    expect(/employerRoute \|\| intentLift\)\s*\n\s*\? normalizeFilters\(body, JOB_SOURCES\.length\)/.test(FN),
      "the post-rewrite normalizeFilters must be the one that feeds the board").toBe(true);
  });

  it("is applied before filters are derived, and disclosed on every list path", () => {
    // Rewriting the body up front means the count probe, the facet query and
    // the list all see one normalised request — the four-path divergence that
    // caused five defects in two days.
    const routeAt = FN.indexOf("const employerRoute = preFilters.applied.companies.length === 0");
    const normAt = FN.indexOf("const { applied, ignored: ignoredFilters } =");
    expect(routeAt, "routing not found").toBeGreaterThan(-1);
    expect(routeAt < normAt, "routing must happen BEFORE normalizeFilters").toBe(true);
    expect((FN.match(/\.\.\.employerDisclosure\(employerRoute\)/g) ?? []).length,
      "the visitor must be told on every list path that the board narrowed to one employer").toBe(4);
    expect(/companyMatched: r\.matchedName/.test(FN)).toBe(true);
  });
});
