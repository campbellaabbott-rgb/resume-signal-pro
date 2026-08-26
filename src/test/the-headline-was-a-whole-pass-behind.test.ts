import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE PUBLISHED TOTAL MOVED ONLY WHEN A PASS ENDED, SO IT WAS AS STALE AS THE
 * PASS WAS LONG.
 *
 * Measured 2026-08-26: a rotation pass that had just completed had STARTED 6.7
 * hours earlier, and the headline was still quoting that start. Over the same
 * window the at-cap lane took CVS Health from ~630 stored postings to 12,698,
 * and the number on the page could not say so for most of a day.
 *
 * The COUNT was never the problem and is not changed here: coverage.open is an
 * exact count of rows a visitor can actually page to, picked over two rivals
 * precisely because it can be checked from outside. Only its cadence moved.
 *
 * The trap this had to avoid: making the refresher a second writer of the
 * `refresh` meta row. An upsert replaces the whole `v` JSON, and when two sites
 * wrote that row the second silently dropped the first's fields — it zeroed the
 * `rot` counter every hop and an entire lane never ran once (2026-07-25). So
 * the refresher patches the two keys it owns and nothing else.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");
const MIG = (() => {
  const dir = resolve(ROOT, "supabase/migrations");
  const f = readdirSync(dir).filter((x) => x.endsWith(".sql"))
    .filter((x) => readFileSync(resolve(dir, x), "utf8").includes("FUNCTION public.refresh_headline_open")).sort().pop();
  return f ? readFileSync(resolve(dir, f), "utf8") : "";
})();
const MIG_CODE = MIG.split("\n").map((l) => (/^\s*--/.test(l) ? "" : l)).join("\n");

describe("the headline was a whole pass behind", () => {
  it("a migration defines the refresher", () => {
    expect(MIG, "no migration defines refresh_headline_open").not.toBe("");
  });

  it("counts exactly what the headline claims: servable rows", () => {
    // Same two predicates the board serves under. A count of anything else
    // would publish a number no page can reach.
    expect(MIG_CODE).toMatch(/p\.missing_since IS NULL/);
    expect(MIG_CODE).toMatch(/p\.effective_posted >= now\(\) - interval '30 days'/);
  });

  it("PATCHES the meta row — it never becomes a second whole-row writer", () => {
    // The 2026-07-25 defect: an upsert of `v` drops every field the other
    // writer owns. This must touch only coverage.open and coverage.openAt.
    expect(MIG_CODE, "the refresher upserts the meta row wholesale")
      .not.toMatch(/INSERT INTO public\.job_board_meta|ON CONFLICT \(k\)/);
    expect(MIG_CODE).toMatch(/UPDATE public\.job_board_meta/);
    expect(MIG_CODE).toMatch(/WHERE k = 'refresh'/);
    // Shape, not an exact key list: a later change legitimately added
    // 'tracked' to the same object, and a guard that pins the literal fails on
    // an addition it has no opinion about.
    expect(MIG_CODE).toMatch(/jsonb_build_object\('open', v_open,[^)]*'openAt', now\(\)\)/);
  });

  it("creates the coverage object when it is absent", () => {
    // A nested jsonb_set is a NO-OP when the parent key is missing, which would
    // have made this silently do nothing on a row with no coverage yet.
    expect(MIG_CODE, "nested jsonb_set would no-op on a missing parent")
      .not.toMatch(/jsonb_set\([^)]*'\{coverage,/);
    expect(MIG_CODE).toMatch(/coalesce\(v -> 'coverage', '\{\}'::jsonb\)/);
  });

  it("openAt is its own stamp, not a reuse of refreshedAt", () => {
    // refreshedAt describes when the FACETS were computed and is still honest
    // at pass cadence. Reusing it would let the facets claim a freshness only
    // the count has.
    expect(MIG_CODE).toMatch(/'openAt'/);
    expect(MIG_CODE, "the refresher rewrites refreshedAt").not.toMatch(/refreshedAt/);
  });

  it("is service-role only", () => {
    expect(MIG_CODE).toMatch(/REVOKE ALL ON FUNCTION public\.refresh_headline_open\(\) FROM PUBLIC, anon, authenticated;/);
    expect(MIG_CODE).toMatch(/GRANT EXECUTE ON FUNCTION public\.refresh_headline_open\(\) TO service_role;/);
  });

  it("the caller is gated on age and never blocks the response", () => {
    expect(CODE).toMatch(/const HEADLINE_MAX_AGE_MS = \d+ \* 60_000;/);
    expect(CODE).toMatch(/if \(openAge > HEADLINE_MAX_AGE_MS\)/);
    // waitUntil keeps it off the response path.
    expect(CODE).toMatch(/waitUntil\(\(async \(\) => \{\s*\n\s*try \{\s*\n\s*const \{ error \} = await client\.rpc\("refresh_headline_open"\)/);
  });

  it("kicks and falls through, so it cannot starve the exclusive ladder", () => {
    // The maintenance-kick starvation class: any watcher that kicks and RETURNS
    // every cycle starves the ladder below it. This one issues no chain and
    // takes no kick stamp at all.
    const block = CODE.slice(CODE.indexOf("const openAge"), CODE.indexOf("Country backfill runs as an INDEPENDENT track") + 60);
    expect(block, "the headline track returns instead of falling through").not.toMatch(/\breturn\b/);
    expect(block, "the headline track consumes the maintenance kick stamp").not.toMatch(/maintenance_kick/);
  });
});
