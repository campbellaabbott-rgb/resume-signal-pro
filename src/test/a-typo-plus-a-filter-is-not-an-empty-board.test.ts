import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * ONE TYPO PLUS ANY FILTER RETURNED ZERO JOBS.
 *
 * Measured live 2026-08-22 against the deployed board:
 *   {"q":"nurrse"}                            -> 17 rows, disclosed as close matches
 *   {"q":"nurrse","country":"US"}             -> 0 rows, total 0, NO disclosure
 *   {"q":"nurrse","category":"healthcare"}    -> 0 rows, total 0, NO disclosure
 *   {"q":"nurrse","workMode":"remote"}        -> 0 rows, total 0, NO disclosure
 * A single mistyped letter, plus any narrowing at all, emptied the board and
 * said nothing about why. Not "no close matches" — no page.
 *
 * THE CAUSE was a shared fence: every rescue tier stood down whenever a filter
 * was active. That was the right call for exactly one reason — two of the three
 * tiers are RPCs that took no filter arguments, and the trigram one did not even
 * RETURN country or work mode, so the edge function could not narrow its rows
 * afterwards either. Standing down was honest about the limitation. It was also
 * indistinguishable, on screen, from "there is nothing like this".
 *
 * THREE TIERS, THREE DIFFERENT ANSWERS, and the differences are the point:
 *
 *   exact-word   never needed the fence. It is not an RPC — it is buildQuery
 *                with a different matcher, so every filter was already binding
 *                on every call. Fencing it discarded a correct answer for free.
 *   trigram      takes the filters as parameters now, and applies them BEFORE
 *                its own cap. That ordering is the whole fix: hydrate-and-
 *                refilter was measured and rejected because the cap lands first
 *                — of the 60 rows it returns for a misspelling, 2 survive a GB
 *                filter, so the visitor still sees an empty page.
 *   semantic     still cannot filter in SQL, so it hydrates its ids back
 *                through buildQuery. What survives is shown; what does not is
 *                honestly absent.
 *
 * AND THE WIN IS SMALLER THAN IT LOOKS, which the migration comment says out
 * loud rather than leaving to be discovered. The trigram operator does not
 * reach every posting whose title contains the misspelled word, so the pool is
 * a few hundred rows, not thousands. A GB-filtered typo search goes from 2 rows
 * to a full page; a remote-filtered one returns zero either way and falls
 * through to the semantic tier. The page does not always fill. It stops lying
 * about why.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const FILTERS = readFileSync(resolve(ROOT, "supabase/functions/job-board/filters.ts"), "utf8");

/** The newest migration that defines the trigram rescue. */
const RESCUE_SQL = (() => {
  const dir = resolve(ROOT, "supabase/migrations");
  const hits = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => /CREATE (OR REPLACE )?FUNCTION public\.fuzzy_title_search\(/.test(readFileSync(resolve(dir, f), "utf8")))
    .sort();
  return hits.length ? readFileSync(resolve(dir, hits[hits.length - 1]), "utf8") : "";
})();

describe("a typo plus a filter is not an empty board", () => {
  it("the rescue SQL exists and is the newest definition", () => {
    expect(RESCUE_SQL, "no migration defines the trigram rescue").not.toBe("");
  });

  it("the trigram rescue accepts every filter the board can apply", () => {
    for (const p of [
      "p_location text", "p_remote boolean", "p_country text", "p_category text",
      "p_experience text\\[\\]", "p_salary_floor numeric", "p_companies text\\[\\]",
      "p_posted_after timestamptz", "p_max_age_days integer", "p_work_mode text",
      "p_vendors text\\[\\]",
    ]) {
      expect(
        new RegExp(p).test(RESCUE_SQL),
        `the rescue cannot honour a filter it does not take: ${p.replace("\\\\", "")}`,
      ).toBe(true);
    }
  });

  it("the rescue returns the columns a filtered row must prove", () => {
    // country and work_mode were absent from the result columns, so rowToJob
    // emitted null for both and filterViolations flagged every rescued row
    // against a filter the database HAD honoured. A rescue that cannot be
    // audited is a rescue that gets switched off again.
    const ret = RESCUE_SQL.slice(RESCUE_SQL.indexOf("CREATE FUNCTION public.fuzzy_title_search("));
    const table = ret.slice(ret.indexOf("RETURNS TABLE"), ret.indexOf("LANGUAGE"));
    expect(table).toMatch(/\bcountry text\b/);
    expect(table).toMatch(/\bwork_mode text\b/);
  });

  it("the rescue cannot serve a posting the employer has already withdrawn", () => {
    // It had no presence predicate at all — the one read path still able to
    // show a job stamped as gone from its employer's feed, on the queries where
    // the board has least else to offer and a dead link is most likely clicked.
    const body = RESCUE_SQL.slice(RESCUE_SQL.indexOf("CREATE FUNCTION public.fuzzy_title_search("));
    expect(body).toMatch(/missing_since IS NULL/);
    // The semantic tier had the identical hole, and the claim that the trigram
    // one was "the last such path" was simply false when it was written.
    // RESOLVED INDEPENDENTLY, not assumed to share a file with the trigram
    // rescue. The two used to be re-issued together; 20260827160000 rewrote the
    // semantic tier on its own (its ANN was unbounded and timing out on every
    // call), so the newest definition of each now lives in a different
    // migration. Slicing the trigram file for it returned the last character of
    // the file — a string that trivially fails the fence assertion below and
    // says nothing about the function it was meant to check.
    const semDir = resolve(ROOT, "supabase/migrations");
    const SEM_SQL = readdirSync(semDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(resolve(semDir, f), "utf8"))
      .filter((t) => t.includes("FUNCTION public.search_jobs_semantic("))
      .pop() ?? "";
    const sem = SEM_SQL.slice(SEM_SQL.indexOf("FUNCTION public.search_jobs_semantic("));
    expect(sem, "the semantic rescue is not in any migration").not.toBe("");
    expect(sem).toMatch(/missing_since IS NULL/);
  });

  it("the arity change drops the signature that is actually live", () => {
    // A DROP naming a signature that no longer exists is a silent no-op, and
    // the plain CREATE after it then fails with "already exists". A missed DROP
    // on an arity change leaves two candidates and PostgREST answers the
    // ambiguity code to EVERY call — the outage this repo took on 2026-08-20.
    const drop = RESCUE_SQL.indexOf("DROP FUNCTION IF EXISTS public.fuzzy_title_search(text, timestamptz, integer)");
    const create = RESCUE_SQL.indexOf("CREATE FUNCTION public.fuzzy_title_search(");
    expect(drop, "the live three-argument signature is not dropped").toBeGreaterThan(-1);
    expect(drop).toBeLessThan(create);
    // AND THE GRANTS COME BACK, because DROP discards them. Either spelling
    // counts: an explicit GRANT per signature, or the catalog loop
    // 20260827170000 uses — that migration REVOKES these three from anon (they
    // are SECURITY DEFINER, so the grant was the whole access control, and anon
    // could page the corpus straight off PostgREST at any offset) and re-grants
    // service_role over every overload pg_proc actually holds. A hand-listed
    // grant would miss an overload this database carries and the migrations do
    // not describe.
    const explicitGrant = /GRANT EXECUTE ON FUNCTION public\.fuzzy_title_search\(/.test(RESCUE_SQL);
    const catalogGrant = /p\.proname IN \([^)]*'fuzzy_title_search'[^)]*\)/.test(RESCUE_SQL)
      && /GRANT EXECUTE ON FUNCTION %s TO service_role/.test(RESCUE_SQL);
    expect(explicitGrant || catalogGrant,
      "DROP discards grants — the rescue must be re-granted, explicitly or from the catalog").toBe(true);
  });

  it("the edge function binds the filters instead of standing down", () => {
    expect(FN).toMatch(/const rescueFilterParams = \(\): Record<string, unknown> => filtersActive \? \{/);
    // Spread-omitted when nothing narrows, which is deploy-window tolerance and
    // not tidiness: sending these to the OLD three-argument function makes
    // PostgREST answer a no-such-function code and the tier returns nothing. An
    // unfiltered typo query keeps its old call shape either side of the apply.
    expect(FN).toMatch(/\.\.\.rescueFilterParams\(\)/);
  });

  it("the vendor list keeps exactly one producer per call shape", () => {
    // The rescue spells its array parameter differently from the ranked RPCs,
    // and a guard counts the ranked spelling — so a third inline copy of the
    // shared constant would both fail that guard and mint the fifth vendor list
    // to go stale when adapter five lands.
    expect(FILTERS).toMatch(/export function rescueVendorsParam\(/);
    expect(FN).toMatch(/\.\.\.rescueVendorsParam\(applied\)/);
    // The property is about the RPC PARAMETER forms, not about every mention of
    // the shared constant: the browse path's direct source filter uses it
    // straight, which is one consumer of one list and exactly right. What must
    // never appear here is an inline literal for either RPC parameter spelling.
    expect(FN).not.toMatch(/p_vendors:\s*\[/);
    expect(FN).not.toMatch(/p_sources:\s*\[/);
  });

  it("the trigram tier carries a length floor", () => {
    // The one change that turns a measured 4x regression into none: with
    // filters bound and no floor, {"q":"++","country":"US"} went 1.10-1.33s to
    // ~5.1s and returned nothing either way. A two-character typo is not a typo.
    const blk = /fuzzy_title_search[\s\S]{0,900}/.exec(FN)?.[0] ?? "";
    expect(blk, "the trigram call site is missing").not.toBe("");
    expect(/qText\.length >= 3/.test(FN), "the trigram tier needs a three-character floor").toBe(true);
  });

  it("the disclosure survives the change, because these are still close matches", () => {
    // The rescue tiers may now answer under a filter, but they must never be
    // mistaken for exact results. Every rescue exit still names itself.
    expect(FN).toMatch(/fuzzy: qText/);
    expect(FN).toMatch(/semantic: qText/);
    expect(FN).toMatch(/exactWordMatch: qText/);
  });
});

describe("did-you-mean is a disclosure, never an expansion", () => {
  // "manger" exactly matches 101 of other people's typos ("Manger Trainee"),
  // which suppresses every rescue tier — the exact hits are real rows, just
  // not what the searcher meant. "krankenschwester" has 1 literal match
  // against a 68-row German nursing pool spelled pflegefachkraft. The cure
  // for both is a curated one-click suggestion ABOVE unchanged results:
  // re-ranking or query expansion would be the tier-escalation trap (a
  // widened search wearing a rescue's clothing), and these pins keep it out.
  const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
  const code = FN.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

  it("the map exists with the two measured pairs", () => {
    expect(code).toMatch(/"krankenschwester": "pflegefachkraft"/);
    expect(code).toMatch(/"manger": "manager"/);
  });

  it("the map is read exactly once, inside searchDisclosures, as a field", () => {
    const uses = code.match(/DID_YOU_MEAN/g) ?? [];
    // THREE since .45: declaration, the searchDisclosures read, and the earned
    // did-you-mean's PRECEDENCE GATE — which reads the map only to stand down
    // when a curated pair exists. Still never wired into a query; the fourth
    // use is the line to refuse.
    expect(uses.length, "declaration + disclosure read + precedence gate — a fourth use means someone wired it into a query").toBe(3);
    expect(code, "the third use must be the negation gate, nothing else")
      .toMatch(/!DID_YOU_MEAN\[qText\.trim\(\)\.toLowerCase\(\)\]/);
    expect(code).toMatch(/out\.didYouMean = dym/);
  });
});
