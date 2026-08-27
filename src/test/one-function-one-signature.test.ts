import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * PostgREST resolves an RPC by PARAMETER NAME, and refuses to guess.
 *
 * record_affiliate_conversion was created three times by three migrations, each
 * with a different parameter list — and a different list is a NEW function, not
 * a replacement. Two of them ended up carrying the same five names in a
 * different order, so every call naming all five matched both:
 *
 *   HTTP 300  PGRST203  "Could not choose the best candidate function between:
 *   ...(p_product_name => text, p_sale_amount => integer)...,
 *   ...(p_sale_amount => integer, p_product_name => text)..."
 *
 * Reproduced live 2026-08-27. Both callers log the error and continue, so no
 * affiliate was credited for eight months without anything appearing to break.
 *
 * This guard is a RATCHET: the two pre-existing pairs are named below and no
 * new one may appear. They are listed rather than deleted because both resolve
 * correctly today — every caller passes the full argument set, which matches
 * only the wider signature — so dropping them is a change with risk and no
 * benefit. If one of them ever gains a caller that omits an argument, it
 * becomes the affiliate bug again.
 */
const DIR = resolve(__dirname, "../../supabase/migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/** Comments stripped: the migration that FIXED this quotes the broken shapes. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

/** Argument list -> normalised type tuple, the thing Postgres identifies a function by. */
function typesOf(args: string): string {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of args) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((a) => {
    let t = a.replace(/\s+/g, " ").trim()
      .replace(/\s+DEFAULT\s+.*$/i, "")
      .replace(/^(IN|OUT|INOUT|VARIADIC)\s+/i, "");
    const sp = t.split(" ");
    t = (sp.length > 1 ? sp.slice(1).join(" ") : sp[0]).toLowerCase();
    return ({ int: "integer", int4: "integer", int8: "bigint", bool: "boolean",
              timestamptz: "timestamp with time zone" } as Record<string, string>)[t] ?? t;
  }).join(", ");
}

/** Known, deliberately tolerated pairs. Additions here need a reason in the diff. */
const ALLOWED = new Set(["log_industry_correction", "store_temp_resume"]);

describe("one function, one signature", () => {
  const surviving = new Map<string, Set<string>>();
  const create = /CREATE (?:OR REPLACE )?FUNCTION\s+(?:public\.)?(\w+)\s*\(([^)]*)\)/gi;
  const drop = /DROP FUNCTION(?:\s+IF EXISTS)?\s+(?:public\.)?(\w+)\s*\(([^)]*)\)/gi;
  // `keep CONSTANT text := '<identity args>'; ... p.proname = '<name>' ...
  //  EXECUTE 'DROP FUNCTION ' || r.sig` — captured as (name, kept args).
  const catalogDrop =
    /keep CONSTANT text :=\s*'([^']*)';[\s\S]*?p\.proname = '(\w+)'[\s\S]*?EXECUTE 'DROP FUNCTION '/gi;
  for (const f of FILES) {
    const sql = strip(readFileSync(resolve(DIR, f), "utf8"));
    // IN SOURCE ORDER, because a single migration routinely does
    // `DROP FUNCTION x(); CREATE FUNCTION x(...)` to change a return type.
    // Applying every CREATE and then every DROP made that pair cancel out and
    // the function vanish from the map entirely — which silently exempted it
    // from the check below. Caught by negative-testing this guard: a planted
    // second signature on get_freshness_stats was NOT reported, because the
    // drop-then-create in 20260806170446 had already erased it.
    type Ev = { at: number; kind: "create" | "drop" | "catalog"; name: string; sig: string };
    const evs: Ev[] = [];
    for (const m of sql.matchAll(create)) evs.push({ at: m.index!, kind: "create", name: m[1], sig: typesOf(m[2]) });
    for (const m of sql.matchAll(drop)) evs.push({ at: m.index!, kind: "drop", name: m[1], sig: typesOf(m[2]) });
    for (const m of sql.matchAll(catalogDrop)) evs.push({ at: m.index!, kind: "catalog", name: m[2], sig: typesOf(m[1]) });
    evs.sort((a, b) => a.at - b.at);
    for (const e of evs) {
      if (e.kind === "create") {
        if (!surviving.has(e.name)) surviving.set(e.name, new Set());
        surviving.get(e.name)!.add(e.sig);
      } else if (e.kind === "drop") {
        surviving.get(e.name)?.delete(e.sig);
      } else {
        // A CATALOG DROP collapses a name to its one intended signature. The
        // affiliate fix cannot list signatures to drop — this database holds
        // functions the migrations never described — so it enumerates pg_proc
        // and drops everything that is not `keep`.
        surviving.set(e.name, new Set([e.sig]));
      }
    }
  }

  it("parsed the migrations — otherwise the assertion below is vacuous", () => {
    expect(surviving.size).toBeGreaterThan(100);
  });

  it("no function gains a second live signature", () => {
    const overloaded = [...surviving.entries()]
      .filter(([n, sigs]) => sigs.size > 1 && !ALLOWED.has(n))
      .map(([n, sigs]) => `${n}\n       ${[...sigs].map((s) => `(${s})`).join("\n       ")}`);
    expect(
      overloaded,
      "every call naming all the parameters of two candidates gets PGRST203 and 400s. " +
        "Drop the old signature in the same migration that adds the new one:\n  " +
        overloaded.join("\n  "),
    ).toEqual([]);
  });

  it("the affiliate overloads are cleared from the catalog, not by name", () => {
    // The database holds functions these migrations never described — probing
    // log_industry_correction with a parameter set that appears in NO migration
    // answered 204, not 404. Dropping three named signatures would have left a
    // fourth behind, so the fix enumerates pg_proc instead.
    const sql = strip(readFileSync(
      resolve(DIR, "20260827131500_three_overloads_meant_no_affiliate_was_ever_paid.sql"), "utf8"));
    expect(sql).toMatch(/FROM pg_proc p/);
    expect(sql).toMatch(/pg_get_function_identity_arguments\(p\.oid\) IS DISTINCT FROM keep/);
    expect(sql).toMatch(/EXECUTE 'DROP FUNCTION ' \|\| r\.sig::text;/);
    expect(sql, "and it must assert the result rather than assume it").toMatch(/RAISE EXCEPTION/);
  });
});
