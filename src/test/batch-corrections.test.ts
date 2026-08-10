/**
 * A PARTIAL PATCH MUST NOT ERASE THE COLUMNS IT DID NOT MENTION.
 *
 * The corrections pass keeps stored postings honest as employers edit them — a
 * fixed title, a corrected location, a moved apply_url. It chunked its work
 * into 200s and then issued ONE sequentially-awaited UPDATE PER ROW: the only
 * unbatched write in an ingest that batches everything else, costing hundreds
 * of serial round trips per pass on a churny giant, out of the same budget
 * that decides how fast the whole catalog re-verifies.
 *
 * Batching it is not a plain bulk UPDATE, and the reason is the dangerous part:
 * every patch is DIFFERENT. One row changed only its title, the next only its
 * salary. `SET title = x.title, salary = x.salary` would write NULL into every
 * column a given patch omitted — erasing an employer's real salary because
 * some other row's title moved. Silent, per-pass, unlogged data loss.
 *
 * So the RPC tests key PRESENCE column by column. These tests exist to keep
 * that property, and to keep the function's REACH narrow: posted_at belongs to
 * the dating sweep, category to the categoriser, description and
 * experience_band to their fills. An ingest-time writer that COULD touch them
 * would eventually be asked to.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
const mig = readdirSync(DIR).filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(resolve(DIR, f), "utf8"))
  .filter((t) => t.includes("FUNCTION public.apply_posting_corrections")).pop() ?? "";
const idx = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

/** The seven columns the vendor is authoritative for on every fetch. */
const CORRECTABLE = ["title", "location", "apply_url", "country", "work_mode", "salary", "remote"];
/** Owned by other sweeps — unreachable from an ingest-time correction. */
const OFF_LIMITS = ["posted_at", "category", "description", "experience_band", "first_seen", "missing_since"];

describe("the batch preserves what the patch does not mention", () => {
  it("exists", () => {
    expect(mig, "no migration defines apply_posting_corrections").not.toBe("");
  });

  it("every correctable column is guarded by a key-presence test", () => {
    // `patch.p ? 'col'` — presence, not truthiness. This is the whole
    // difference between a correction and silent data loss.
    for (const col of CORRECTABLE) {
      expect(mig, `${col} is not presence-guarded`).toMatch(
        new RegExp(`${col}\\s*=\\s*CASE WHEN patch\\.p \\? '${col}'`),
      );
    }
  });

  it("every guarded column falls back to the STORED value, never to null", () => {
    for (const col of CORRECTABLE) {
      expect(mig, `${col} does not preserve t.${col}`).toMatch(
        new RegExp(`ELSE t\\.${col}\\s+END`),
      );
    }
  });

  it("cannot reach columns owned by other sweeps", () => {
    const body = mig.slice(mig.indexOf("UPDATE public.job_board_postings"), mig.indexOf("RETURNING 1"));
    for (const col of OFF_LIMITS) {
      expect(body, `${col} is writable from the corrections path`).not.toMatch(
        new RegExp(`\\b${col}\\s*=`),
      );
    }
  });

  it("skips malformed elements rather than updating something arbitrary", () => {
    // A patch with no id, or a blank one, must match no row at all — never
    // every row.
    expect(mig).toMatch(/jsonb_typeof\(e\.value\) = 'object'/);
    expect(mig).toMatch(/e\.value \? 'id'/);
    expect(mig).toMatch(/COALESCE\(e\.value->>'id', ''\) <> ''/);
  });

  it("is service_role only — an ingest writer is not a public API", () => {
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.apply_posting_corrections\(jsonb\) FROM PUBLIC, anon, authenticated/);
    expect(mig).toMatch(/GRANT EXECUTE ON FUNCTION public\.apply_posting_corrections\(jsonb\) TO service_role/);
  });
});

describe("the caller batches, and degrades safely", () => {
  const call = idx.slice(idx.indexOf("for (let i = 0; i < corrections.length; i += 200)"));
  const block = call.slice(0, call.indexOf("if (corrections.length) console.log"));

  it("sends one RPC per chunk instead of one update per row", () => {
    expect(block).toMatch(/client\.rpc\("apply_posting_corrections", \{ p_patches: chunk \}\)/);
  });

  it("falls back to per-row updates when the RPC is not deployed yet", () => {
    // Deploy-before-migration is routine here. Dropping corrections silently
    // would leave stale titles and moved apply_urls on the board with nothing
    // to show for it.
    expect(block).toMatch(/PGRST202/);
    expect(block).toMatch(/client\.from\("job_board_postings"\)\.update\(patch\)\.eq\("id", id\)/);
  });

  it("a real batch error stops the board rather than looping through it", () => {
    expect(block).toMatch(/lastUpsertError = `\$\{s\.token\} correct batch/);
  });
});
