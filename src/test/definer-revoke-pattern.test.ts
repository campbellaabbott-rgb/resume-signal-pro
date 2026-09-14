/**
 * REVOKING FROM PUBLIC DOES NOT LOCK A FUNCTION IN THIS DATABASE.
 *
 * Measured as anon against production, 2026-08-08:
 *
 *     POST /rpc/record_tenant_wall     204   wrote a row
 *     POST /rpc/reconcile_stripe_tick  204   posted to reconcile-stripe and
 *                                            stamped lastCronAt
 *
 * Both carried `REVOKE ALL ON FUNCTION … FROM PUBLIC` plus a service_role
 * grant, and both statements applied successfully. They were callable anyway,
 * because this database grants EXECUTE to `anon` on newly created functions in
 * public, and a grant held directly by anon is not removed by revoking from
 * PUBLIC. The revoke ran and removed a privilege that was not the one in use.
 *
 * refresh_stats_cache is NOT affected, and the reason is the rule: it was
 * created by an older migration and only ever CREATE OR REPLACE'd, and REPLACE
 * preserves grants. Only FRESH creations inherit the default.
 *
 * This file makes the correct pattern structural instead of remembered. The
 * runbook already carried "107 of 121 definer functions were anon-callable"
 * and it happened again the same week, which is what a note without a test
 * buys you.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
const read = (f: string) => readFileSync(resolve(DIR, f), "utf8");

/**
 * The migration that closed the hole, selected by the DDL that closes it.
 *
 * It used to be selected by `t.includes("FROM PUBLIC, anon, authenticated")`,
 * which is the pattern the second describe block below exists to PROPAGATE. So
 * the first migration to adopt it — a facets change with nothing to do with
 * this fix — sorted later, won `.pop()`, and failed all three assertions. The
 * test broke on compliance with itself: the more the rule spread, the more
 * reliably it pointed at the wrong file.
 *
 * Fourth time in one day that "latest file matching a common string" has picked
 * up a neighbour. The rule, now written down rather than re-learned: select a
 * migration by DDL unique to it, never by a phrase other migrations will
 * legitimately share.
 */
const fix = files.map(read)
  .filter((t) => t.includes("REVOKE ALL ON FUNCTION public.record_tenant_wall")
    && t.includes("DELETE FROM public.apply_tenant_walls")).pop() ?? "";

describe("the two exposed functions are revoked by NAME", () => {
  it("record_tenant_wall — a caller here steers where the agent applies", () => {
    expect(fix).toMatch(/REVOKE ALL ON FUNCTION public\.record_tenant_wall\(text, text, boolean, text\[\]\)\s*\n?\s*FROM PUBLIC, anon, authenticated/);
  });

  it("reconcile_stripe_tick — a caller here forges the payment safety net's only proof of life", () => {
    expect(fix).toMatch(/REVOKE ALL ON FUNCTION public\.reconcile_stripe_tick\(\)\s*\n?\s*FROM PUBLIC, anon, authenticated/);
  });

  it("clears the rows an anonymous caller could have written", () => {
    // The observation pipeline is not wired yet, so nothing legitimate has
    // written here — the whole table is safe to clear, and that is cheaper
    // than reasoning about which rows to trust.
    expect(fix).toMatch(/DELETE FROM public\.apply_tenant_walls/);
  });
});

describe("the pattern, so the next one is not written the same way", () => {
  // A service-role-only function must revoke from anon and authenticated BY
  // NAME. Revoking from PUBLIC alone is necessary and not sufficient here.
  // category_knn and load_category_anchors (20260909224500 / 225000): a
  // definer reader and writer over the RLS-on anchor table of the Other-
  // bucket classifier; promote_category and revert_category (225500 /
  // 226000): the definer writers of job_board_postings.category -- all four
  // service-role only by design.
  const SERVICE_ONLY = ["record_tenant_wall", "reconcile_stripe_tick", "category_knn", "load_category_anchors", "promote_category", "revert_category"];

  // PER STATEMENT: the phrase must sit on the function's own REVOKE, not
  // anywhere in a file that happens to hold it (a table REVOKE in the same
  // migration carried the phrase and satisfied a whole-file match while the
  // function's own REVOKE said FROM PUBLIC alone).
  const revokedByName = (fn: string) =>
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*FROM PUBLIC, anon, authenticated;`);

  it("every service-role-only function names anon and authenticated in ITS OWN revoke statement", () => {
    const all = files.map(read).join("\n");
    for (const fn of SERVICE_ONLY) {
      expect(all, `${fn} is never revoked from anon by name in its own REVOKE statement`).toMatch(revokedByName(fn));
    }
  });

  it("teeth: a function REVOKE that says FROM PUBLIC alone is not rescued by a table REVOKE in the same file", () => {
    const mutated = "REVOKE ALL ON public.some_table FROM PUBLIC, anon, authenticated;\nREVOKE ALL ON FUNCTION public.load_category_anchors(text, jsonb, jsonb, text, boolean) FROM PUBLIC;\n";
    expect(mutated).toMatch(/FROM PUBLIC, anon, authenticated/); // the old whole-file match would have passed
    expect(mutated).not.toMatch(revokedByName("load_category_anchors"));
    expect("REVOKE ALL ON FUNCTION public.load_category_anchors(text, jsonb, jsonb, text, boolean)\n  FROM PUBLIC, anon, authenticated;").toMatch(revokedByName("load_category_anchors"));
  });

  it("does NOT touch the functions that are anon-readable on purpose", () => {
    // email_delivery_health and product_delivery_health are deliberately
    // granted to anon: they return counts only, and the heartbeat reads them
    // without a session. Locking them would be a different bug.
    const all = files.map(read).join("\n");
    expect(all).toMatch(/GRANT EXECUTE ON FUNCTION public\.email_delivery_health\(integer\) TO anon/);
    expect(all).toMatch(/GRANT EXECUTE ON FUNCTION public\.product_delivery_health\(integer\) TO anon/);
  });
});
