// @vitest-environment node
/**
 * BOARD .103 REVIEW (search-pay lens): "MOBILE" IS NOT A SOFTWARE WORD.
 *
 * With "mobile" in the software family, "mobile developer" also searched
 * "mobile engineer", which in facilities management is a travelling building
 * or HVAC technician (JLL, Cushman & Wakefield, Lincoln Property): a probe of
 * production added 413 rows, 80 of them facilities, machinery and Mobility
 * titles ranked 2-7, and precision fell from 0.686 to 0.561. ios, android,
 * swift and kotlin carry the app sense. Judged by pglite with the shipped
 * title vector, over 29 real facilities titles
 * (fixtures/role-swap-false-merges-2026-11-17.json, mobileFacilities).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expandQuery, joinCompoundRoleWords, roleAliasesFor, roleSwapApplies } from "../../supabase/functions/job-board/search-alias";
import { pickRoute, simpleRouteFilters } from "../../supabase/functions/job-board/search-routing";
import { loadPool, matchedRows, titleReads, type PoolRow, type SearchModules } from "./helpers/search-reach";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const SHIPPED: SearchModules = { join: joinCompoundRoleWords, expandQuery, aliasesFor: roleAliasesFor, pickRoute: (q, a) => pickRoute(q, a), simpleRouteFilters: (s, a) => simpleRouteFilters(s, a) };
const FX = JSON.parse(readFileSync(resolve(__dirname, "fixtures/role-swap-false-merges-2026-11-17.json"), "utf8")) as Record<string, PoolRow[]>;
let pg: PGlite;
beforeAll(async () => { pg = new PGlite(); });
afterAll(async () => { await pg?.close(); });

describe("mobile developer", () => {
  it("does not trade developer for engineer", () => {
    expect(roleSwapApplies("mobile developer")).toBe(false);
    expect(roleSwapApplies("ios developer"), "the app platforms still do").toBe(true);
    expect(roleSwapApplies("android engineer")).toBe(true);
  });
  it("finds none of 29 facilities and machinery 'Mobile Engineer' titles", async () => {
    expect(FX.mobileFacilities.length).toBe(29);
    await loadPool(pg, FX.mobileFacilities);
    const hit = (await matchedRows(pg, titleReads("mobile developer", SHIPPED).filters)).map((i) => FX.mobileFacilities[i].t);
    expect(hit).toEqual([]);
  });
});
