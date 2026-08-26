import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE VECTOR TIER NOW HAS TWO ENTRY POINTS, AND ONE IMPLEMENTATION.
 *
 * It used to fire only when BOTH lexical tiers returned nothing. A query
 * landing three weak matches therefore got no help at all — which is the case
 * a searcher most obviously wanted more, since an empty page at least tells
 * them to rephrase. It now also augments a THIN page, the same widening the
 * trigram tier got when its threshold went 5 -> 20.
 *
 * The reason this is a shared helper rather than a second block: four
 * properties make the tier safe, and each is subtle enough that a copy would
 * drift from the original within a change or two.
 *
 *   bounded      an embed loads a gte-small session on a cold isolate, so it
 *                is deadlined or it sets the floor on the whole request.
 *   filter-SAFE  the ANN scan takes no predicates, so its ids are hydrated
 *                back through buildQuery — the one filter binder — and
 *                re-sorted into embedding order. Pushing predicates into an
 *                HNSW scan is filtered-ANN, a different and riskier problem.
 *   ANCHORED     the tier always returns something; it has no notion of
 *                "nothing is close". 'zzzqqxwv' came back with one confident,
 *                unrelated job, 2/2. At least one shipping row must share a
 *                real token with the query.
 *   anchored on  the check runs on rows that SURVIVE the filters, not on the
 *   survivors    candidates — otherwise the tier answers on evidence it is
 *                not showing.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");
const PAGE = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const PAGE_CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");

describe("a tier that cannot say no is worse than no tier", () => {
  it("there is exactly ONE semantic retrieval, not two", () => {
    // The whole point of the refactor: one place in the SERVING path that
    // embeds and scans. The read-only `semantic-search` diagnostic action also
    // calls the RPC and legitimately stands apart — it exists to inspect the
    // tier's raw output, not to answer a visitor — so the count is scoped to
    // the serving path rather than the file.
    expect((CODE.match(/const semanticRows = async \(/g) ?? []).length).toBe(1);
    const servingPath = CODE.slice(CODE.indexOf("const semanticRows = async ("));
    expect((servingPath.match(/rpc\("search_jobs_semantic"/g) ?? []).length,
      "the serving path scans the vector index from more than one place — the copies will drift").toBe(1);
    // And the probe is where we think it is, so the scoping above is not
    // quietly hiding a second serving-path caller.
    const probe = CODE.slice(0, CODE.indexOf("const semanticRows = async ("));
    expect(probe).toMatch(/action === "semantic-search"/);
  });

  it("both entry points go through the helper", () => {
    const calls = (CODE.match(/await semanticRows\(/g) ?? []).length;
    expect(calls, "expected the empty-page rescue AND the thin-page augment").toBeGreaterThanOrEqual(2);
  });

  it("the helper keeps the lexical anchor", () => {
    // Without it the tier answers confidently to nonsense.
    expect(CODE).toMatch(/const anchored = semSource\.some\(/);
    expect(CODE).toMatch(/return anchored \? semSource : \[\];/);
    // And the anchor is checked AFTER the filter hydration, on surviving rows.
    const hydrate = CODE.indexOf("semFiltered");
    const anchor = CODE.indexOf("const anchored = semSource.some(");
    expect(hydrate).toBeGreaterThan(-1);
    expect(anchor, "the anchor is checked before the filters are applied").toBeGreaterThan(hydrate);
  });

  it("the helper stays filter-safe by hydrating through buildQuery", () => {
    // Hydration is now UNCONDITIONAL (see the dedicated test below); what this
    // one pins is that when it happens it goes through buildQuery — the single
    // filter binder — rather than the tier trying to filter for itself.
    expect(CODE).toMatch(/buildQuery\("effective_posted", false, undefined, \{ skipTerms: true \}\)\s*\n\s*\.in\("id", semIds\)/);
    // Embedding order is restored after hydration; PostgREST returns its own.
    expect(CODE).toMatch(/semRank\.get\(String\(a\.id\)\)/);
  });

  it("the embed is deadlined and the tier declines when the budget is short", () => {
    expect(CODE).toMatch(/withDeadline\(embedText\(qText\), Math\.min\(embedBudgetMs, budgetLeft\(\)\)\)/);
    expect(CODE, "a thin page would become slow as well as thin")
      .toMatch(/budgetLeft\(\) > 3_000/);
  });

  it("the augmentation APPENDS and displaces nothing", () => {
    // Exact rows keep their positions; a version that let meaning-matches push
    // exact rows off the page would have to say where they go on page two.
    expect(CODE).toMatch(/jobs: \[\.\.\.rankedGrouped\.jobs, \.\.\.semExtra\]/);
    expect(CODE).toMatch(/semanticMatch: true/);
  });

  it("the exclusion set goes INTO the helper, so the anchor judges what ships", () => {
    // THE BUG AN ADVERSARIAL REVIEW CAUGHT BEFORE THIS SHIPPED.
    //
    // Anchoring outside the helper and excluding outside it produced:
    // q="sommelier", 4 exact rows on the page; ANN returns those 4 plus 56
    // hospitality neighbours; `anchored` satisfied by the 4; the 4 then dropped
    // as duplicates; 56 rows containing no "sommelier" ship under a claim they
    // are about the same thing. The 'zzzqqxwv' failure with a page in front of
    // it. The exclusion set is a PARAMETER so this is the helper's invariant
    // rather than a rule each caller must remember.
    expect(CODE).toMatch(/exclude\?: \{ ids: Set<string>; keys: Set<string> \}/);
    expect(CODE).toMatch(/await semanticRows\(Math\.min\(room \* 3, 60\), 1_500, \{ ids: haveIds, keys: haveKeys2 \}\)/);
    // Exclusion must run BEFORE the anchor is computed.
    const excl = CODE.indexOf("if (exclude) {");
    const anchor = CODE.indexOf("const anchored = semSource.some(");
    expect(excl, "the helper no longer takes an exclusion set").toBeGreaterThan(-1);
    expect(excl, "the anchor is decided before the exclusion is applied").toBeLessThan(anchor);
    // And the caller must NOT re-filter afterwards, which would recreate the gap.
    const augment = CODE.slice(CODE.indexOf("const room = Math.max(0, limit - rankedGrouped.jobs.length)"));
    expect(augment.slice(0, 1200), "the caller filters the helper's result again")
      .not.toMatch(/novelSem = semRows\.filter/);
  });

  it("rows are hydrated through buildQuery even when no filter is narrowing", () => {
    // search_jobs_semantic does not return `country` at all. Gated hydration
    // was defensible while the tier only answered an EMPTY page — raw rows were
    // the whole response. Appending them to buildQuery rows would mix rows that
    // have a country with rows whose country is silently null, in one list.
    expect(CODE).toMatch(/if \(semSource\.length > 0\) \{\s*\n\s*const semIds/);
    expect(CODE, "hydration is still gated on a filter being active")
      .not.toMatch(/if \(filtersActive && semSource\.length > 0\)/);
  });

  it("a query with no anchorable token declines BEFORE paying for an embed", () => {
    // q="ai ml": both tokens are under 3 characters, so the anchor can never be
    // satisfied. Deciding that after the embed costs a cold-isolate model load,
    // an HNSW scan and a hydration round trip for a guaranteed empty result.
    const helper = CODE.slice(CODE.indexOf("const semanticRows = async ("));
    const tokens = helper.indexOf("const qTokens");
    const embed = helper.indexOf("embedText(qText)");
    expect(tokens).toBeGreaterThan(-1);
    expect(tokens, "the token check happens after the embed is paid for").toBeLessThan(embed);
    expect(helper).toMatch(/if \(qTokens\.length === 0\) return \[\];/);
  });

  it("the page stops claiming a single exact total once augmented", () => {
    // total counts EXACT matches; the page now holds exact + close + meaning.
    expect(CODE).toMatch(/const augmented = fuzzyExtraOut !== null \|\| semanticExtraOut !== null;/);
  });

  it("semanticExtra is its own field, not folded into fuzzyExtra", () => {
    // Different claims: "you may have misspelled this" vs "nothing else
    // matched, these are about the same thing".
    expect(CODE).toMatch(/semanticExtra: semanticExtraOut/);
    expect(CODE, "the two augmentations share one disclosure field")
      .not.toMatch(/fuzzyExtra: semanticExtraOut|semanticExtra: fuzzyExtraOut/);
  });

  it("the rows are labelled in the UI, never passed off as keyword hits", () => {
    expect(PAGE_CODE).toMatch(/semanticMatch \&\& !job\.closeMatch/);
    expect(PAGE_CODE).toMatch(/jobsPage\.semanticMatchChip/);
    for (const f of readdirSync(resolve(ROOT, "src/i18n/locales")).filter((x) => x.endsWith(".json"))) {
      const j = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales", f), "utf8")) as { jobsPage?: Record<string, string> };
      expect(j.jobsPage?.semanticMatchChip, `${f} missing semanticMatchChip`).toBeTruthy();
    }
  });
});
