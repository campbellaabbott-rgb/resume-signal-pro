import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { mergeCompanyFacet } from "../../supabase/functions/job-board/clusters";

/**
 * TWO COMPANY NUMBERS, ONE OF WHICH MUST NEVER REACH A READER.
 *
 * companiesFacet.count is `count(*) GROUP BY company_token` with NEITHER
 * serving predicate. It stays that way ON PURPOSE: the refresh pass diffs that
 * array against sources.ts and DELETES every token missing from it, so a
 * filtered facet would let a freshness window delete a quiet board's whole
 * history (migration 20260825190000 states this and refuses to filter it).
 *
 * Which means the number exists, is wrong for readers, and sits one property
 * access away from every surface that wants a per-employer count. Five took it:
 * the edge function's typeahead, the /jobs dropdown, the /jobs detail panel,
 * ~500 prerendered SERP titles, and /v1/companies' `open_postings` — while the
 * SQL typeahead beside them refused it in a COMMENT ON that has been there
 * since 20260811223000.
 *
 * MEASURED 2026-09-09, facet count against the board's own filtered count (the
 * query the destination page runs): Dollar Tree 5299/5296, JCPenney 3434/3425,
 * Hilton 3312/3159, AECOM 2874/2229, PwC 3254/2119. A ~1% median and a severe
 * tail — so the copy may not call this "wildly wrong" and may not call it
 * "close", and no surface may publish a number it cannot reproduce.
 *
 * THE DANGEROUS DIRECTION OF THIS WHOLE CHANGE is not that someone re-adds the
 * bad number. It is that someone reads these tests, sees "the facet should be
 * filtered", and filters the PRUNE INPUT. That is the first test below.
 */
const ROOT = resolve(__dirname, "../../");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/**
 * COMMENT-STRIPPED. Four guards in this repo have passed because the literal
 * they required sat in a prose comment — and this file's own fix necessarily
 * writes `companiesFacet.count` into comments explaining why it is banned. A
 * scanner that reads them flags the fix as the defect.
 */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
   .replace(/<!--[\s\S]*?-->/g, " ")
   .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
const sqlCode = (s: string) => s.replace(/--[^\n]*/g, " ");

const MIGRATIONS = resolve(ROOT, "supabase/migrations");
/** The NEWEST migration that redefines the facet builder — never a fixed
 *  filename. A guard pinned to one file goes quietly vacuous the moment a
 *  later migration replaces the function it was written about, which is how
 *  the pre-existing companiesFacet guard would have aged out. */
const newestFacetMigration = () => {
  const hits = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => readFileSync(resolve(MIGRATIONS, f), "utf8")
      .includes("CREATE OR REPLACE FUNCTION public.refresh_job_board_facets()"))
    .sort();
  expect(hits.length, "no migration defines refresh_job_board_facets").toBeGreaterThan(0);
  return readFileSync(resolve(MIGRATIONS, hits[hits.length - 1]), "utf8");
};

const JOB_BOARD = read("supabase/functions/job-board/index.ts");
const PUBLIC_API = read("supabase/functions/public-api/index.ts");
const PRERENDER = read("scripts/prerender-seo.mjs");
const JOBS = read("src/pages/Jobs.tsx");
const EXPLORE = read("src/pages/Explore.tsx");

describe("the prune's input stays unfiltered", () => {
  const MIG = newestFacetMigration();

  it("companiesFacet in the NEWEST definition carries neither serving predicate", () => {
    // THE DANGEROUS DIRECTION. Everything else in this file pushes toward "the
    // company count must obey the serving rule"; this one pushes back, because
    // the array the prune deletes by is the one place where obeying it is data
    // loss. Bounded by the NEXT key so the servable sibling's predicates (which
    // are correct, and sit right after it) cannot satisfy this by accident.
    const from = MIG.indexOf("'companiesFacet'");
    const to = MIG.indexOf("'companiesOpen'");
    expect(from, "companiesFacet missing from the newest definition").toBeGreaterThan(-1);
    expect(to, "companiesOpen must be the key that follows it").toBeGreaterThan(from);
    const block = sqlCode(MIG.slice(from, to));
    expect(block).not.toMatch(/missing_since/);
    expect(block).not.toMatch(/effective_posted/);
  });

  it("the edge function's orphan prune reads the UNFILTERED array, not the servable one", () => {
    // The prune walks `companies`, which is assigned from f.companiesFacet.
    // If a later change points it at companiesOpen (a map of what is OPEN), a
    // board whose postings have all gone missing vanishes from its input and
    // gets deleted — the exact data loss the migration refuses.
    const c = code(JOB_BOARD);
    const assign = c.match(/let companies = Array\.isArray\(f\.companiesFacet\) \? f\.companiesFacet : \[\];/);
    expect(assign, "the prune's input must still be f.companiesFacet").not.toBeNull();
    const from = c.indexOf("const orphanTokens = companies");
    expect(from, "orphan prune not found").toBeGreaterThan(-1);
    const block = c.slice(from, from + 900);
    expect(block).toMatch(/companies\s*\n?\s*\.map\(\(c\) => \(c as \{ token\?: string \}\)\.token\)/);
    expect(block, "the prune must not derive its delete list from the servable count")
      .not.toMatch(/companiesOpen/);
  });

  it("the servable sibling is computed in the SAME statement as the facet", () => {
    // Two statements would let a token appear in one and not the other, and the
    // pair would then describe two instants under one `as_of`.
    const sql = sqlCode(MIG);
    const stmt = sql.slice(sql.indexOf("WITH open_by_token"), sql.indexOf("INTO v;"));
    expect(stmt).toContain("'companiesFacet'");
    expect(stmt).toContain("'companiesOpen'");
    expect(stmt).toContain("'companiesOpenCount'");
    // ...and the sibling carries BOTH predicates, which the facet must not.
    const cte = stmt.slice(stmt.indexOf("WITH open_by_token"), stmt.indexOf("SELECT jsonb_build_object"));
    expect(cte).toMatch(/missing_since IS NULL/);
    expect(cte).toMatch(/effective_posted >= now\(\) - interval '30 days'/);
  });

  it("a cold cache reports the servable numbers as NULL, never as 0 or {}", () => {
    // 0 would read as "no board is hiring" and {} as "every employer has zero
    // open roles". Both are claims; an instrument that has measured nothing
    // must say nothing. Consumers key on absence to fall silent.
    const sql = sqlCode(MIG);
    const cold = sql.slice(sql.indexOf("'cached', false"), sql.indexOf("'cached', false") + 400);
    const coldBlock = sql.slice(sql.lastIndexOf("RETURN jsonb_build_object", sql.indexOf("'cached', false")), sql.indexOf("'cached', false"));
    expect(cold.length).toBeGreaterThan(0);
    expect(coldBlock).toMatch(/'companiesOpen',\s*NULL/);
    expect(coldBlock).toMatch(/'companiesOpenCount',\s*NULL/);
  });

  it("the long timeout and the anon lockout survive the rewrite", () => {
    expect(MIG).toMatch(/SET statement_timeout = '10min'/);
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION public\.refresh_job_board_facets\(\) FROM PUBLIC, anon, authenticated;/);
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION public\.refresh_job_board_facets\(\) TO service_role;/);
    expect(/ALTER TABLE|DROP TABLE|DELETE FROM/i.test(MIG)).toBe(false);
  });
});

describe("no reader-facing surface publishes companiesFacet.count", () => {
  it("the edge function strips `count` from the served employer facet", () => {
    // ENUMERATED FROM THE WIRE SHAPE, not from a list of call sites: whatever
    // facetHead returns is what every list exit publishes as `companies`, so
    // pinning its emitted object is what makes a NEW consumer impossible
    // rather than merely unreviewed.
    const c = code(JOB_BOARD);
    const from = c.indexOf("function facetHead(");
    expect(from, "facetHead not found").toBeGreaterThan(-1);
    const fn = c.slice(from, c.indexOf("\n  }", from) + 4);
    expect(fn, "facetHead must emit a mapped wire shape").toMatch(/return head\.map\(/);
    const emitted = fn.slice(fn.indexOf("return head.map("));
    expect(emitted).toMatch(/token: c\.token/);
    expect(emitted).toMatch(/name: c\.name/);
    expect(emitted).toMatch(/typeof c\.open === "number"/);
    expect(emitted, "count must not reach the wire").not.toMatch(/\bcount\b/);
  });

  it("action:company-suggest publishes `open` and no `count`", () => {
    const c = code(JOB_BOARD);
    const from = c.indexOf('if (action === "company-suggest")');
    expect(from).toBeGreaterThan(-1);
    const block = c.slice(from, c.indexOf('if (action === "exists")', from));
    expect(block).toMatch(/companiesOpen/);
    const emitted = block.slice(block.indexOf("companies: hit.slice(0, 12)"));
    expect(emitted).toMatch(/typeof c\.open === "number"/);
    expect(emitted, "the forbidden number must not be returned").not.toMatch(/count: c\.count/);
  });

  it("/v1/companies serves open_postings from the servable map, or null", () => {
    const c = code(PUBLIC_API);
    expect(c, "open_postings must no longer be the raw facet count")
      .not.toMatch(/open_postings: c\.count/);
    expect(c).toMatch(/open_postings: openOf\(c\.token\)/);
    // Null, not a fallback, when the pass did not compute it — and the basis
    // string has to say which of the two states shipped.
    const from = c.indexOf("const openOf =");
    expect(from).toBeGreaterThan(-1);
    expect(c.slice(from, from + 200)).toMatch(/openMap \? .* : null/s);
    expect(c).toMatch(/basis: openMap/);
  });

  it("/v1/stats pairs livePostings with a serving-filtered board count", () => {
    const c = code(PUBLIC_API);
    expect(c, "the stats denominator must not be the unfiltered facet length")
      .not.toMatch(/companies: Array\.isArray\(v\.companiesFacet\) \? v\.companiesFacet\.length : null/);
    expect(c).toMatch(/companies: typeof v\.companiesOpenCount === "number" \? v\.companiesOpenCount : null/);
    // A statistic names its population. This one is a count of BOARDS.
    expect(c).toMatch(/companiesBasis:/);
    expect(c.slice(c.indexOf("companiesBasis:"), c.indexOf("companiesBasis:") + 500))
      .toMatch(/BOARDS, not of employers/);
  });

  it("the /jobs dropdown, the detail panel and the search facet read `open`", () => {
    const c = code(JOBS);
    // The response type no longer carries the field at all, which is what makes
    // a new render site a type error rather than a review miss.
    const rowType = (c.match(/companies: Array<\{([^}]*)\}>/) ?? [])[1] ?? "";
    expect(rowType, "BoardResponse must declare the employer row").toMatch(/token/);
    expect(rowType, "and it must carry the servable count").toMatch(/open\?: number/);
    expect(rowType.includes("count:"), "the response type may not declare `count`").toBe(false);
    expect(c, "no company-facet render site may read .count")
      .not.toMatch(/companies\.find\([^\n]*\)\??\.count/);
    // The detail panel finds the employer's facet row and takes `open` off it.
    // Matched on the whole token GROUP rather than the primary token alone —
    // see the merged-employer block below — so the assertion is on the read,
    // not on the predicate's spelling.
    const panel = c.slice(c.indexOf("const entry = detailJob.token"), c.indexOf("const entry = detailJob.token") + 500);
    expect(panel, "the detail panel must find the employer's facet row").toMatch(/companies\.find\(/);
    expect(panel, "and read the servable count off it").toMatch(/const cnt = entry\?\.open;/);
    expect(c).toMatch(/typeof c\.open === "number" \? <span className="text-muted-foreground"> \(\{c\.open\}\)<\/span> : null/);
  });

  it("the prerendered landers bake `open`, never the facet count", () => {
    const c = code(PRERENDER);
    const from = c.indexOf("const openN = openRolesOf(c);");
    expect(from, "the lander must derive its number from openRolesOf").toBeGreaterThan(-1);
    const lander = c.slice(from, c.indexOf('console.log(`[prerender-seo] company pages', from));
    // Title, description and H1 — the three crawlable claims — plus the A-Z
    // row below, all from openN and all omitted when it is absent.
    expect(lander).toMatch(/fmt\(openN\) \} Verified Openings|fmt\(openN\)\} Verified Openings/);
    expect(lander).toMatch(/Browse \$\{fmt\(openN\)\} open roles at/);
    expect(lander).toMatch(/\$\{fmt\(openN\)\} verified \$\{esc\(nm\)\} openings right now/);
    expect(lander, "no crawlable claim may use the unfiltered count").not.toMatch(/fmt\(c\.count\)/);
    // And the page states the rule the number was counted under.
    expect(lander).toMatch(/THE COUNT'S BASIS/);
    expect(lander).toMatch(/has not taken down and whose date falls inside the last 30 days/);
  });

  it("the A-Z index row omits its number rather than printing the old one", () => {
    const c = code(PRERENDER);
    const from = c.indexOf("const byLetter = new Map();");
    const block = c.slice(from, c.indexOf('path: "/companies"', from));
    expect(block).toMatch(/const o = openRolesOf\(c\);/);
    expect(block).toMatch(/typeof o === "number" \? ` <span/);
    expect(block).not.toMatch(/fmt\(c\.count\)/);
  });
});

describe("one definition of 'open roles', on every surface that says it", () => {
  it("/explore's employer check and /jobs count the same two predicates", () => {
    // /explore renders get_company_suggest.open_roles, whose SQL counts under
    // missing_since IS NULL AND effective_posted within 30 days. /jobs renders
    // companiesOpen, built in the facet pass under the SAME two predicates.
    // Two pages, one employer, one definition — the contradiction this change
    // exists to remove was that /explore was right and /jobs was not.
    const suggest = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => readFileSync(resolve(MIGRATIONS, f), "utf8")
        .includes("CREATE OR REPLACE FUNCTION public.get_company_suggest(p_q text)"))
      .sort()
      .pop();
    expect(suggest, "get_company_suggest must exist").toBeTruthy();
    const suggestSql = sqlCode(readFileSync(resolve(MIGRATIONS, suggest!), "utf8"));
    const openRoles = suggestSql.slice(suggestSql.indexOf("AS open_roles") - 400, suggestSql.indexOf("AS open_roles"));
    expect(openRoles).toMatch(/p\.missing_since IS NULL/);
    expect(openRoles).toMatch(/p\.effective_posted >= now\(\) - interval '30 days'/);

    const facetCte = sqlCode(newestFacetMigration());
    const cte = facetCte.slice(facetCte.indexOf("WITH open_by_token"), facetCte.indexOf("GROUP BY company_token"));
    expect(cte).toMatch(/missing_since IS NULL/);
    expect(cte).toMatch(/effective_posted >= now\(\) - interval '30 days'/);

    // And /explore still renders open_roles, not anything else.
    expect(code(EXPLORE)).toMatch(/const open = numOr\(h\.open_roles\);/);
  });

  it("the servable count can never exceed the facet count, by construction", () => {
    // The one arithmetic invariant of this whole change: the servable set is a
    // strict subset of the rows the facet counts (same table, same grouping,
    // two extra predicates). Proven here on the FOLD, which is the only place
    // the two numbers are combined in code — mergeCompanyFacet sums both across
    // an employer's sub-boards, and a fold that summed one and not the other
    // (or that invented a 0) would break the invariant for merged employers.
    const merged = mergeCompanyFacet([
      { token: "pwc~wd3~A", name: "PwC", count: 2000, open: 1400 },
      { token: "pwc~wd3~B", name: "PwC", count: 1254, open: 719 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].count).toBe(3254);
    expect(merged[0].open).toBe(2119);
    expect(merged[0].open!).toBeLessThanOrEqual(merged[0].count!);
  });

  it("a fold with no measured open count publishes none, rather than 0", () => {
    // 0 is a claim that the employer has nothing open. Absence is the deploy
    // window's honest state and every render site keys on it.
    const merged = mergeCompanyFacet([
      { token: "acme~a", name: "Acme", count: 40 },
      { token: "acme~b", name: "Acme", count: 12 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].count).toBe(52);
    expect("open" in merged[0]).toBe(false);
  });
});

describe("the denominator obeys the same rule as the numerator", () => {
  it("use-board-totals reads the servable board count and never companiesCount", () => {
    const c = code(read("src/hooks/use-board-totals.ts"));
    expect(c).toMatch(/companiesOpenCount/);
    expect(c, "the unfiltered grouping must not be a fallback").not.toMatch(/companiesCount/);
    expect(c).toMatch(/feeds: number \| null/);
  });

  it("both heroes drop the clause instead of falling back", () => {
    for (const p of ["src/components/JobBoardHero.tsx", "src/components/HomeHero.tsx"]) {
      const c = code(read(p));
      expect(c, `${p} must not read companiesCount`).not.toMatch(/companiesCount/);
      expect(c, `${p} must gate on a measured value`).toMatch(/totals\.feeds !== null|feeds !== null/);
    }
  });

  it("the changed noun got NEW i18n keys in all nine locales", () => {
    // A locale VALUE overrides an inline English default, so reusing
    // homeHero.statCompanies / boardHero.companies would leave eight locales
    // rendering "companies" over a count of BOARDS.
    const dir = resolve(ROOT, "src/i18n/locales");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    for (const f of files) {
      const j = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
      expect(j.homeHero?.statCompanyBoards, `${f} homeHero.statCompanyBoards`).toBeTruthy();
      expect(j.boardHero?.companyBoards, `${f} boardHero.companyBoards`).toBeTruthy();
      expect(j.jobsPage?.countLineNoFeeds, `${f} jobsPage.countLineNoFeeds`).toBeTruthy();
      expect(String(j.jobsPage.countLineNoFeeds), `${f} must not carry a feeds clause`)
        .not.toMatch(/companyFeeds/);
    }
  });

  it("the /jobs count line pairs its openings with the servable board count", () => {
    const c = code(JOBS);
    expect(c).toMatch(/companyFeeds: data\.companiesOpenCount\.toLocaleString\(\)/);
    expect(c).toMatch(/companyFeeds: data\.companiesOpenCount\.toLocaleString\(\)/);
    expect(c, "companiesCount must never feed a companyFeeds slot")
      .not.toMatch(/companyFeeds: \(data\??\.companiesCount/);
  });

  it("the prerenderer's board denominator is the servable one", () => {
    const c = code(PRERENDER);
    expect(c).toMatch(/const BOARD_OPEN_BOARDS = typeof boardFacets\?\.companiesOpenCount === "number"/);
    expect(c).toMatch(/const BOARD_COMPANIES = BOARD_OPEN_BOARDS;/);
    expect(c, "no fallback to the unfiltered grouping for a published claim")
      .not.toMatch(/BOARD_COMPANIES = typeof boardFacets\?\.companiesCount/);
  });
});

/**
 * THE HAND-WRITTEN ENUMERATION MISSED A PAGE, WHICH IS WHAT HAND-WRITTEN
 * ENUMERATIONS DO.
 *
 * The block above names five files and checks each one. /companies
 * (src/pages/Companies.tsx) is a SIXTH consumer of the same facet: it calls
 * action:"list" with includeFacets and rendered `c.count.toLocaleString()`.
 * Nothing caught it — tsc could not, because that page declares its own local
 * row interface instead of BoardResponse's, so stripping `count` from the wire
 * left it reading `undefined.toLocaleString()` inside a render, under the
 * app-wide ErrorBoundary. "It becomes a compile error" is only true for files
 * that share the type.
 *
 * So the file set below is DISCOVERED, not listed: every non-test file under
 * src/ and scripts/ that asks the board for facets. A seventh consumer fails
 * these tests on the day it is written.
 */
describe("every consumer of the employer facet, found rather than listed", () => {
  // src/ ONLY, and that is deliberate. The ban below is on PUBLISHING the
  // unfiltered number, and outside the rendering layer `count` has legitimate
  // non-published uses: prerender-seo's lander SELECTION gate and
  // census-drivable-yield's ranking both read it off the RAW rpc facet and
  // print neither. The prerenderer's published figures have their own tests
  // above and below; these sweep the surfaces a person reads.
  const SCAN_ROOTS = ["src"];
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "test" || e.name === "__tests__") continue;
        walk(p, out);
      } else if (/\.(tsx?|mjs|js)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
    }
    return out;
  };
  /** Files that read the board's employer facet: they ask for it by name. */
  const consumers = SCAN_ROOTS.flatMap((r) => walk(r))
    .map((p) => ({ path: p, src: code(read(p)) }))
    .filter(({ src }) => /includeFacets|company-suggest/.test(src));

  it("the sweep actually finds the pages it is meant to police", () => {
    const paths = consumers.map((c) => c.path);
    // If this ever shrinks to nothing the tests below become vacuous, which is
    // the failure mode the whole file was written about.
    expect(paths.length, "no facet consumers found — the sweep is broken").toBeGreaterThanOrEqual(4);
    expect(paths, "the page the hand-written list missed").toContain("src/pages/Companies.tsx");
    expect(paths).toContain("src/pages/Jobs.tsx");
    expect(paths).toContain("src/components/JobBoardHero.tsx");
  });

  it("no facet consumer reads `count` off an employer row", () => {
    for (const { path, src } of consumers) {
      // `c` is this repo's element identifier in every companies map/find.
      expect(src, `${path} reads .count off an employer row`).not.toMatch(/\bc\.count\b/);
      expect(src, `${path} reads .count off the companies facet`)
        .not.toMatch(/companies\s*(?:\.[A-Za-z]+\([^)]*\))?\s*\)?\??\.count\b/);
      expect(src, `${path} reads companiesFacet.count`).not.toMatch(/companiesFacet[^\n]{0,40}\.count\b/);
    }
  });

  it("no facet consumer DECLARES a `count` on an employer row", () => {
    // Companies.tsx's local `interface CompanyChip { token; name; count }` is
    // why the type change never reached it. A row type that names token and
    // name is an employer row, whoever wrote it, and it may not carry `count`.
    const bodies = (s: string) => [
      ...s.matchAll(/interface\s+\w+\s*\{([^}]*)\}/g),
      ...s.matchAll(/Array<\{([^}]*)\}>/g),
      ...s.matchAll(/\{([^{}]*\btoken\b[^{}]*)\}\s*\[\]/g),
    ].map((m) => m[1]);
    for (const { path, src } of consumers) {
      for (const b of bodies(src)) {
        if (!/\btoken\b/.test(b) || !/\bname\b/.test(b)) continue;
        expect(b.includes("count"), `${path} declares an employer row carrying \`count\`: {${b.trim()}}`).toBe(false);
      }
    }
  });

  it("no facet consumer publishes companiesCount", () => {
    for (const { path, src } of consumers) {
      // The one legitimate mention is the response TYPE declaring the field the
      // server still sends; reading it is what is banned.
      const reads = src.replace(/^\s*companiesCount\?: number;\s*$/m, " ");
      expect(reads, `${path} reads the unfiltered token grouping`).not.toMatch(/companiesCount/);
    }
  });

  it("the MCP board_stats tool pairs its numerator with a servable denominator", () => {
    // Not a facet consumer by the scan above (it calls the board through a
    // helper), and it shipped `employers: r.companiesCount` one line under a
    // serving-filtered `servablePostings` — the same sentence-level mismatch,
    // in a machine-readable payload that disagreed with /v1/stats.
    const c = code(read("supabase/functions/agent-mcp/index.ts"));
    expect(c, "board_stats must not read the unfiltered grouping").not.toMatch(/companiesCount/);
    expect(c).toMatch(/openCompanyBoards: r\.companiesOpenCount \?\? null/);
    expect(c, "and it must say what it counts").toMatch(/openCompanyBoardsBasis/);
    expect(c, "a token is a board, not an employer").not.toMatch(/\bemployers: r\./);
  });
});

/**
 * THE SUM AND THE SCOPE IT DESCRIBES.
 *
 * mergeCompanyFacet folds an employer's feed tokens into one row and SUMS
 * `open` across them (PwC ships five Workday sub-sites; 76 such employers in
 * the top 1,500). If the row travels with only its primary token, the number
 * shown is once again one the destination cannot reproduce — the same defect
 * this file exists for, one level up and harder to see because both halves
 * come from the same row. `tokens` is what makes the filter cover the boards
 * the sum was taken over.
 */
describe("a merged employer's number and its link cover the same boards", () => {
  it("the served facet and the typeahead both carry the group's tokens", () => {
    const c = code(JOB_BOARD);
    const wire = c.slice(c.indexOf("return head.map((c) => ({"), c.indexOf("return head.map((c) => ({") + 320);
    expect(wire, "facetHead must ship the tokens its summed `open` was taken over")
      .toMatch(/tokens: c\.tokens/);
    const suggest = c.slice(c.indexOf('action === "company-suggest"'));
    expect(suggest.slice(0, suggest.indexOf('action === "exists"')))
      .toMatch(/tokens: c\.tokens/);
  });

  it("both /jobs commit paths scope to the whole group, not the primary token", () => {
    const c = code(JOBS);
    expect(c).toMatch(/const toggleCompanyGroup = useCallback\(/);
    expect(c, "the click path").toMatch(/toggleCompanyGroup\(scopeTokensOf\(c\)\)/);
    expect(c, "the keyboard path").toMatch(/toggleCompanyGroup\(scopeTokensOf\(opts\[companyIdx\]\)\)/);
    expect(c, "the detail panel's drill-down").toMatch(/setCompany\(scope\.join\(","\)\)/);
    expect(c, "a partial group would restore the mismatch")
      .toMatch(/if \(tokens\.length \+ add\.length > 12\) return prev;/);
  });

  it("a group is matched on any of its boards, not only the primary one", () => {
    // Before: a posting from a non-primary sub-board found no facet row at all,
    // so the drill-down silently vanished for four PwC boards in five.
    expect(code(JOBS)).toMatch(/c\.tokens\)\s*&&\s*c\.tokens\.includes\(detailJob\.token!\)/);
  });

  it("mergeCompanyFacet still carries every token it summed over", () => {
    const merged = mergeCompanyFacet([
      { token: "pwc~wd3~A", name: "PwC", count: 1200, open: 900 },
      { token: "pwc~wd3~B", name: "PwC", count: 800, open: 600 },
      { token: "dollartree", name: "Dollar Tree", count: 5299, open: 5296 },
    ]);
    const pwc = merged.find((c) => c.name === "PwC")!;
    expect(pwc.open).toBe(1500);
    expect(pwc.tokens).toEqual(["pwc~wd3~A", "pwc~wd3~B"]);
    // A single-board employer needs no list, and must not grow one.
    expect(merged.find((c) => c.name === "Dollar Tree")!.tokens).toBeUndefined();
  });
});

/**
 * THE PRERENDER LADDER IS A DESTRUCTIVE PATH TOO.
 *
 * The 2026-07-25 incident shipped ZERO company pages when the facets RPC
 * failed, which is why there are three rungs and a committed snapshot. Making
 * `count` stop reaching the wire re-opened that hole from a new direction: the
 * board-function rung carries rows with NEITHER number during the deploy
 * window, the lander gate then selects nobody, and the snapshot refresh
 * overwrites 600 good entries with an empty list — so the NEXT build fails its
 * own `length > 100` check and the sitemap ratchet aborts the publish.
 */
describe("the fallback ladder cannot be emptied by a silent facet", () => {
  const c = code(PRERENDER);

  it("the board-function rung is refused when it carries no servable number", () => {
    expect(c).toMatch(/const rung2Numbered = Array\.isArray\(j\?\.companies\)\s*&&\s*j\.companies\.some\(\(c\) => typeof c\?\.open === "number"\);/);
    expect(c, "and the rung is gated on it").toMatch(/j\.companies\.length > 100 && rung2Numbered\)/);
  });

  it("the snapshot is never overwritten with a list too short to reload", () => {
    // The reader's own bar is `companiesFacet.length > 100`; the writer must
    // not fall below the bar the reader will apply to it.
    expect(c).toMatch(/if \(trimmed\.length <= 100\) \{/);
    const writeAt = c.indexOf("writeFileSync(FACETS_SNAPSHOT");
    const guardAt = c.indexOf("if (trimmed.length <= 100)");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt, "the guard must precede the write").toBeLessThan(writeAt);
    expect(c).toMatch(/companiesFacet\) && snap\.companiesFacet\.length > 100/);
  });

  it("the snapshot keeps the selection number the lander gate falls back to", () => {
    // `count` is never printed — the body, title and A-Z row all key on `open`
    // — but it is what decides WHO gets a page when no servable number exists.
    // Dropping it turned count-free landers into no landers.
    expect(c).toMatch(/typeof c\.count === "number" \? \{ count: c\.count \} : \{\}/);
    expect(c, "the gate that consumes it").toMatch(/typeof c\.count === "number" && c\.count >= 8/);
  });

  it("the field lander's denominator names boards and drops out when unmeasured", () => {
    const desc = c.slice(c.indexOf("description: `Browse ${countPhrase}"), c.indexOf("description: `Browse ${countPhrase}") + 320);
    expect(desc, "a count of boards may not be printed as companies").not.toMatch(/companies' official job boards/);
    expect(desc).toMatch(/company job boards with roles open now/);
    expect(desc, "an unsourced constant may not stand in for a measurement").not.toMatch(/3,000\+/);
  });
});

/**
 * A PROBE THAT READS ONLY THE TOP ROW CANNOT SEE THIS DEFECT AT ALL. Measured
 * live 2026-09-09, /v1/companies sorted by open postings: rank 1 Dollar Tree
 * 5,299 vs 5,296 and rank 3 O'Reilly 4,727 vs 4,726 — both inside a 10%
 * tolerance against the BROKEN code — while rank 7 PwC ran 3,254 vs 2,119.
 */
describe("the contract probe samples the rows that carry the defect", () => {
  const c = code(read("scripts/api-contract-probe.mjs"));

  it("it reads a page of employers, not the first one", () => {
    expect(c).toMatch(/\/v1\/companies\?limit=15/);
    expect(c, "several ranks down the page").toMatch(/for \(const i of \[0, Math\.min\(7, rows\.length - 1\), Math\.min\(11, rows\.length - 1\), rows\.length - 1\]\)/);
    expect(c, "and every sampled employer must agree").toMatch(/worst\.drift <= worst\.allowed/);
  });

  it("it does not assert a population match against a planner estimate", () => {
    expect(c).toMatch(/basis === "planned" \|\| basis === "unavailable"\) continue;/);
  });
});
