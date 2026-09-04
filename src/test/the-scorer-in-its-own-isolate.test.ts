import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * SIX UPGRADES, ONE DAY, EACH PINNED TO THE MEASUREMENT THAT MOTIVATED IT.
 *
 * 2026-09-03. (4) The scorer moves to its own function: fit-batch answered 546
 * WORKER_RESOURCE_LIMIT to a reader because it shared job-board's worker pool
 * with the ingest. (5) An agent holding a CV can now do what the drop does —
 * fit_resume on MCP, POST /v1/fit on the API — through that scorer, never
 * through job-board. (6) 504 boards failed "(db-write)" with the reason
 * visible nowhere outside the function; lastUpsertError now rides slice_stats.
 * (1) Fit quality's ceiling is description coverage (accountant 80%, nursing
 * 35%, default browse 0-30%) and it had no per-vendor observability; a
 * desc_coverage rollup now sits beside date_coverage, and the sweep fills the
 * newest postings first across vendors — the rows a reader actually sees.
 * (3) /v1's default engine refused location= because the alias expansion lived
 * inside job-board; it lives in _shared now and both engines mean the same
 * place. (2) is pinned behaviourally in a-founders-resume-searched-for-go-to-market.
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const BOARD = strip(read("supabase/functions/job-board/index.ts"));
const API = strip(read("supabase/functions/public-api/index.ts"));
const MCP = strip(read("supabase/functions/agent-mcp/index.ts"));
const JOBS = strip(read("src/pages/Jobs.tsx"));

describe("the scorer in its own isolate", () => {
  it("(4) job-fit exists, is registered, and carries both actions with the same bounds", () => {
    expect(existsSync(resolve(ROOT, "supabase/functions/job-fit/index.ts"))).toBe(true);
    const FIT = strip(read("supabase/functions/job-fit/index.ts"));
    expect(FIT).toMatch(/action === "fit-terms"/);
    expect(FIT).toMatch(/action === "fit-batch"/);
    expect(FIT).toMatch(/const FIT_BATCH_MAX = 20;/);
    expect(FIT).toMatch(/const FIT_DESC_CHARS = 20_000;/);
    expect(FIT, "same rate-limit bucket as the job-board copy, so a reader has ONE daily allowance").toMatch(/p_function: "job-board-fit"/);
    expect(read("supabase/config.toml")).toMatch(/\[functions\.job-fit\]\n\s+verify_jwt = false/);
  });

  it("(4) the site calls job-fit, and job-board keeps its copies for bundles that have not reloaded", () => {
    expect((JOBS.match(/functions\.invoke\("job-fit"/g) ?? []).length).toBe(2);
    expect(JOBS, "no fit call may still target the ingest function").not.toMatch(/invoke\("job-board",\s*\{\s*body:\s*\{\s*action:\s*"fit-(batch|terms)"/);
    expect(BOARD).toMatch(/action === "fit-batch"/);
    expect(BOARD).toMatch(/action === "fit-terms"/);
  });

  it("(5) MCP fit_resume scores through job-fit, never through job-board", () => {
    expect(MCP).toMatch(/name: "fit_resume"/);
    // 2026-09-04: gated on tier first (a-bucket-shared-by-every-customer-is-
    // nobodys-allowance), then scored under the key's own bucket.
    expect(MCP).toMatch(/return toolOk\(await runFitResume\(args, apiKeyId\)\);/);
    const fn = MCP.slice(MCP.indexOf("async function runFitResume"), MCP.indexOf("async function runBoardStats"));
    expect(fn).toMatch(/\/functions\/v1\/job-fit`/);
    expect(fn, "the runner must never send a résumé to the ingest function's copy").not.toMatch(/action: "fit-batch"[\s\S]{0,200}job-board/);
    expect(fn).toMatch(/Deno\.env\.get\("SUPABASE_ANON_KEY"\)/);
  });

  it("(5) POST /v1/fit is the one non-GET route, paid, and scored by job-fit", () => {
    expect(API).toMatch(/const isFitPost = req\.method === "POST" && path\.replace\(\/\\\/\+\$\/, ""\) === "\/v1\/fit";/);
    expect(API).toMatch(/if \(req\.method !== "GET" && !isFitPost\) return fail\(405/);
    expect(API).toMatch(/if \(path === "\/v1\/fit" \|\| path === "\/v1\/fit\/"\) \{\s*if \(req\.method !== "POST"\) return fail\(405/);
    expect(API).toMatch(/return await fitResume\(req, rateHeaders, d\.key_tier, d\.api_key_id\);/);
    // The first deploy judged the POST exception on the RAW pathname, which in
    // production carries /public-api — so POST /v1/fit was 405 and GET /v1/fit
    // reached the paid gate (measured 23:07Z). The gate must read the same
    // stripped path the router reads, i.e. be declared after it.
    expect(API.indexOf("const isFitPost ="), "gate before the stripped path").toBeGreaterThan(API.indexOf('const path = url.pathname.replace('));
    expect(API, "no other raw-pathname comparison may sneak in").not.toMatch(/new URL\(req\.url\)\.pathname\.replace\([^)]*\) === "\/v1\/fit"/);
    const fn = API.slice(API.indexOf("async function fitResume"), API.indexOf("async function stats("));
    expect(fn).toMatch(/fail\(402, "upgrade_required"/);
    expect(fn).toMatch(/\/functions\/v1\/job-fit`/);
    expect(API).toMatch(/"POST \/v1\/fit"/);
    expect(API, "a new endpoint is a new API version").toMatch(/"2026-09-03\.1"/);
    expect(API).not.toMatch(/"2026-08-26\.1"/);
  });

  it("(6) lastUpsertError rides the slice note onto slice_stats; chainKick exposes at", () => {
    expect(BOARD).toMatch(/lastUpsertError: string \| null \} \| null = null;/);
    expect(BOARD).toMatch(/hit: budgetSkipped\.length > 0, lastUpsertError \};/);
    expect(BOARD).toMatch(/lastUpsertError: sliceBudgetNote\.lastUpsertError \? sliceBudgetNote\.lastUpsertError\.slice\(0, 200\) : null/);
    expect(BOARD).toMatch(/at: \(v\.at as string \| undefined\) \?\? at \?\? null,/);
  });

  it("(1) desc_coverage is rolled up beside date_coverage, exposed per vendor, and the sweep fills newest-first", () => {
    // 2026-09-04: the predicate was re-issued once. The 09-03 form counted
    // characters against the scorer's bar, which (a) detoasted every live
    // description each 15-minute tick, third in a shared 4-minute budget, and
    // (b) measured a threshold no writer selects on — every sweep lane fills
    // `description IS NULL` only, so the stat could not be moved by the lever
    // it was built for. `described` now means "has a stored description", the
    // sweep's own selection complemented; total - described is its backlog.
    const sql = (p: string) => read(p).split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    const MIG = sql("supabase/migrations/20260904090000_a_count_that_opened_every_description_to_say_one_number.sql");
    const PREV = sql("supabase/migrations/20260903210000_desc_coverage_next_to_date_coverage.sql");
    expect(MIG).toMatch(/'desc_coverage'/);
    expect(MIG, "described = the sweep lanes' selection, complemented — a null test never opens the value").toMatch(/count\(\*\) FILTER \(WHERE description IS NOT NULL\) AS described/);
    expect(MIG, "no character count anywhere in the writer: that was the detoast").not.toMatch(/length\(/);
    expect(MIG, "re-issued from the LATEST definition: freshness and date_coverage must still be there").toMatch(/'freshness'[\s\S]*'date_coverage'[\s\S]*'desc_coverage'/);
    // The two blocks that were not the defect: byte-identical to the file
    // this one re-issues, from the first key through date_coverage's END.
    const untouched = (s: string) => s.slice(s.indexOf("'freshness'"), s.lastIndexOf("END;", s.indexOf("'desc_coverage'")) + 4);
    expect(untouched(MIG).length).toBeGreaterThan(1000);
    expect(untouched(MIG), "freshness and date_coverage re-issued byte-identical to 20260903210000").toBe(untouched(PREV));
    expect(BOARD).toMatch(/\.eq\("k", "desc_coverage"\)\.maybeSingle\(\)/);
    expect(BOARD).toMatch(/describedPct: Number\(r\.total\) \? Math\.round\(\(100 \* Number\(r\.described\)\) \/ Number\(r\.total\)\) : 0,/);
    expect(BOARD).toMatch(/\.in\("source", \[\.\.\.DETAIL_DESC_SOURCES\]\)/);
    expect(BOARD).toMatch(/\.order\("first_seen", \{ ascending: false, nullsFirst: false \}\)/);
    expect(BOARD, "each row must reach ITS OWN vendor's adapter now that a hop mixes vendors").toMatch(/s\.source === row\.source && s\.token === row\.company_token/);
    expect(BOARD, "a vendor-scoped hop would undo the point").not.toMatch(/\.eq\("source", vendor\)\s*\.is\("description", null\)/);
  });
});
