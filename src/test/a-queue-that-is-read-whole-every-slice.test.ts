import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A QUEUE THAT WAS READ WHOLE, AND WRITTEN WHOLE, EVERY SLICE.
 *
 * The bootstrap lane kept its queue as a JSON array in one meta row, and every
 * refresh slice loaded the ENTIRE array into the edge function, took ten to
 * twenty-five tokens off the front, and wrote the entire remainder back. After
 * a deploy's version-change re-append that array held 8,453 tokens — roughly
 * half a megabyte parsed and re-serialised per slice, inside the invocation
 * that is also fetching up to eighty employer feeds.
 *
 * Measured 2026-09-03: once .27 had capped per-board fetch size, twelve slices
 * completed in the window between deploy and that re-append, and then none —
 * `works` froze while the cursor kept advancing, the signature of an
 * invocation dying inside its fetch loop. The queue was the strongest
 * remaining correlate.
 *
 * So the array STAYS in the row (status still reads its length as pending),
 * but taking, appending and stamping happen in three RPCs inside one row
 * lock, and the edge receives only what it asked for. The legacy in-process
 * path is kept as the fallback for the window between function deploy and
 * migration apply. This pins both halves and the lockdown.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const MIG = readFileSync(resolve(ROOT, "supabase/migrations/20260903150000_a_queue_that_is_read_whole_every_slice.sql"), "utf8");
// CODE ONLY. The migration's header explains the 42702 OUT-parameter trap and
// names SECURITY DEFINER in prose, so a literal count over the whole file
// counted the explanation as an occurrence — the fifth time in this repo a
// guard's literal written in a COMMENT has failed the guard. Strip `--` lines
// before asserting, so the reasoning can stay where it is.
const MIG_CODE = MIG.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

describe("a queue that is read whole every slice", () => {
  it("the edge takes, appends and stamps through the RPCs", () => {
    for (const fn of ["bootstrap_queue_take", "bootstrap_queue_append", "bootstrap_queue_stamp"]) {
      expect(FN, `edge never calls ${fn}`).toMatch(new RegExp(`client\\.rpc\\("${fn}"`));
    }
  });

  it("reads the stored version as one text field, never the array", () => {
    expect(FN).toMatch(/\.select\("v->>version"\)\.eq\("k", "bootstrap"\)/);
  });

  it("falls back to the legacy path ONLY when the RPCs are absent", () => {
    // PGRST202 is PostgREST's "function not found"; 42883 is Postgres's. Any
    // other error must reach the lane's outer catch, not silently switch paths.
    expect(FN).toMatch(/e\.code === "PGRST202" \|\| e\.code === "42883"/);
    const rpcBlock = FN.indexOf("let bootstrapViaRpc = false;");
    const wrapper = FN.indexOf("if (!bootstrapViaRpc) {");
    const legacyRead = FN.indexOf('const { data: bsMeta } = await client.from("job_board_meta").select("v").eq("k", "bootstrap").maybeSingle();');
    expect(rpcBlock, "RPC path missing").toBeGreaterThan(0);
    expect(wrapper, "legacy wrapper missing").toBeGreaterThan(rpcBlock);
    expect(legacyRead, "the legacy whole-array read must still exist, INSIDE the fallback wrapper").toBeGreaterThan(wrapper);
    expect(FN).toMatch(/\} \/\/ !bootstrapViaRpc/);
  });

  it("stamps selected AFTER resolving tokens to boards — the fork the lane needs to see", () => {
    const stamp = FN.indexOf('client.rpc("bootstrap_queue_stamp", { p_selected: bootstrapBoards.length })');
    const resolve_ = FN.indexOf(".map((t) => JOB_SOURCES.find((s) => s.token === t))", FN.indexOf("let bootstrapViaRpc"));
    expect(stamp).toBeGreaterThan(0);
    expect(resolve_, "resolution must precede the stamp").toBeGreaterThan(0);
    expect(stamp).toBeGreaterThan(resolve_);
  });

  it("status still reads pending as the array's length — the storage contract did not move", () => {
    expect(FN).toMatch(/pending: Array\.isArray\(b\.queue\) \? b\.queue\.length : 0,/);
  });

  it("the migration defines all three, returns jsonb, and locks the row", () => {
    for (const fn of ["bootstrap_queue_take", "bootstrap_queue_append", "bootstrap_queue_stamp"]) {
      expect(MIG).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`));
    }
    // jsonb, not OUT parameters: this schema has lost two afternoons to an OUT
    // parameter shadowing a real column (42702).
    expect(MIG_CODE).toMatch(/bootstrap_queue_take\([\s\S]*?\)\s*RETURNS jsonb/);
    // A real OUT parameter is `OUT name type`; the prose about them is stripped above.
    expect(MIG_CODE).not.toMatch(/\bOUT\s+\w+\s+(integer|text|jsonb|boolean)/i);
    expect(MIG_CODE.match(/FOR UPDATE/g)?.length ?? 0, "take and append must each lock the row").toBeGreaterThanOrEqual(2);
  });

  it("is callable by service_role only — the definer-exposure rule", () => {
    for (const sig of ["bootstrap_queue_take(integer, text[], text, boolean)", "bootstrap_queue_append(text[])", "bootstrap_queue_stamp(integer)"]) {
      const esc = sig.replace(/[()[\]]/g, (c) => `\\${c}`);
      expect(MIG, `${sig} not revoked from anon`).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${esc} FROM PUBLIC, anon, authenticated;`));
      expect(MIG, `${sig} not granted to service_role`).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc} TO service_role;`));
    }
    expect(MIG_CODE.match(/SECURITY DEFINER/g)?.length, "exactly the three functions, counted in code not prose").toBe(3);
  });
});
