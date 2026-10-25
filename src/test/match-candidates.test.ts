// @vitest-environment node
/**
 * THE MATCH MIGRATIONS, RUN (20261016100000-103000).
 *
 * metro_ring and match_candidates are read in a real Postgres with Supabase's
 * default grants: the ring knows Columbus, OH from Columbus, GA; the one
 * retrieval statement serves exactly the rows search_jobs would serve for the
 * same title and place (held by behaviour, not by spelling); its remote lane
 * does not lean on work_mode alone; the sources the server surfaces withhold
 * are withheld; the timing gate's explain reads the plan of exactly the
 * statement match_candidates runs; and no client role can call any of it.
 * Every file applies twice.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addPostings, bootMatchDb, MATCH_MIGRATIONS, migrationText } from "./fixtures/match-bench/db";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });

let db: PGlite;
const CUT = "now() - interval '30 days'";

beforeAll(async () => {
  db = await bootMatchDb();
  await db.exec(migrationText("20261009101000"));
  await addPostings(db, [
    { id: "w-cashier", title: "Cashier", location: "Westerville, OH", country: "US" },
    { id: "w-stale", title: "Cashier", location: "Westerville, OH", country: "US", ageDays: 45 },
    { id: "w-gone", title: "Cashier", location: "Westerville, OH", country: "US", missing: true },
    { id: "w-other", title: "Line Cook", location: "Westerville, OH", country: "US" },
    { id: "c-oh-null", title: "Cashier", location: "Columbus, OH", country: null },
    { id: "c-ga", title: "Front End Cashier", location: "Columbus, GA", country: "US" },
    { id: "r-flag", title: "Customer Service Cashier", location: "Anywhere", country: "US", remote: true, work_mode: null },
    { id: "r-mode", title: "Cashier Support", location: "United States", country: "US", work_mode: "remote" },
    { id: "r-word", title: "Cashier Trainer", location: "Remote - US", country: "US", work_mode: null },
    { id: "r-ca", title: "Cashier Lead", location: "Remote - Canada", country: "CA", work_mode: "remote" },
    { id: "tx-lead", title: "Cashier", location: "TX - Houston", country: "US" },
    { id: "tx-name", title: "Cashier", location: "Dallas, Texas", country: "US" },
    { id: "fed", title: "Cashier", location: "Westerville, OH", country: "US", source: "usajobs" },
    { id: "sr", title: "Cashier", location: "Westerville, OH", country: "US", source: "smartrecruiters" },
    { id: "far", title: "Cashier", location: "Portland, ME", country: "US" },
  ]);
});
afterAll(async () => { await db.close(); });

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();
const SIG12 = "text, text, timestamptz, text[], text[], boolean, text[], boolean, text[], integer, text, text[]";
const SIG11 = "text, text, text[], text[], boolean, text[], boolean, text[], integer, text, text[]";
async function candidates(args: Record<string, unknown>): Promise<Array<{ id: string; lane: string; siblings: number }>> {
  const a = {
    p_q_en: "cashier", p_q_simple: null, p_countries: ["US"], p_ring: [], p_remote: false, p_regions: [],
    p_country_lane: false, p_exclude_sources: null, p_lane_limit: 120, p_order: "rank", p_ring_countries: null, ...args,
  };
  const r = await db.query<{ id: string; lane: string; siblings: number }>(
    `SELECT * FROM public.match_candidates(p_q_en => $1, p_q_simple => $2, p_fresh_cutoff => ${CUT}, p_countries => $3::text[], p_ring => $4::text[],
       p_remote => $5, p_regions => $6::text[], p_country_lane => $7, p_exclude_sources => $8::text[], p_lane_limit => $9, p_order => $10,
       p_ring_countries => $11::text[])`,
    [a.p_q_en, a.p_q_simple, a.p_countries, a.p_ring, a.p_remote, a.p_regions, a.p_country_lane, a.p_exclude_sources, a.p_lane_limit, a.p_order, a.p_ring_countries],
  );
  return r.rows;
}

describe("metro_ring: the places within reach, each in its own region", () => {
  it("Columbus, OH reaches Westerville, Dublin and Grove City, never Columbus, GA; the city itself comes first", async () => {
    const r = (await db.query<{ name: string; region: string; center: boolean; km: number }>(`SELECT * FROM public.metro_ring('Columbus', 'OH', 'US', 40, 20)`)).rows;
    expect(r[0]).toMatchObject({ name: "Columbus", region: "OH", center: true });
    const names = r.map((x) => `${x.name},${x.region}`);
    expect(names).toEqual(expect.arrayContaining(["Westerville,OH", "Dublin,OH", "Grove City,OH", "Gahanna,OH"]));
    expect(names).not.toContain("Columbus,GA");
    expect(names, "Newark, OH is about 50 km out").not.toContain("Newark,OH");
    expect(r.every((x) => x.km <= 40)).toBe(true);
  });

  it("80 km takes in Newark; a region given by name works; no region picks the most populous Columbus", async () => {
    const wide = (await db.query<{ name: string }>(`SELECT name FROM public.metro_ring('Columbus', 'Ohio', 'US', 80, 20)`)).rows.map((x) => x.name);
    expect(wide).toContain("Newark");
    const bare = (await db.query<{ name: string; region: string }>(`SELECT name, region FROM public.metro_ring('Columbus', NULL, 'US')`)).rows;
    expect(bare[0]).toMatchObject({ name: "Columbus", region: "OH" });
    const ga = (await db.query<{ name: string }>(`SELECT name FROM public.metro_ring('Columbus', 'GA', 'US')`)).rows.map((x) => x.name);
    expect(ga).toEqual(expect.arrayContaining(["Columbus", "Phenix City"]));
    expect(ga).not.toContain("Westerville");
  });

  it("a ring crossing a border names each place with its own country (Detroit reaches Windsor, ON)", async () => {
    const r = (await db.query<{ name: string; country: string }>(`SELECT name, country FROM public.metro_ring('Detroit', 'MI', 'US', 40)`)).rows;
    expect(r).toEqual(expect.arrayContaining([{ name: "Windsor", country: "CA" }]));
  });

  it("an unknown city answers nothing (resume-match then searches the city alone and says so); km and max are bounded", async () => {
    expect((await db.query(`SELECT * FROM public.metro_ring('Zqxjvkw', NULL, 'US')`)).rows).toEqual([]);
    expect((await db.query(`SELECT * FROM public.metro_ring('Columbus', 'OH', 'US', 40, 2)`)).rows).toHaveLength(2);
    expect((await db.query(`SELECT * FROM public.metro_ring('Columbus', 'OH', 'US', 100000, 1000)`)).rows.length).toBeLessThanOrEqual(50);
  });
});

describe("match_candidates serves what search_jobs serves (the base predicate, by behaviour)", () => {
  it("for one title and one place the two return the same rows: the stale and the withdrawn row are out of both", async () => {
    const ranked = (await db.query<{ id: string }>(`SELECT id FROM public.search_jobs('cashier', ${CUT}, p_location => 'Westerville', p_title_only => true, p_limit => 200)`)).rows;
    const mine = await candidates({ p_ring: ["Westerville"] });
    expect(ids(mine)).toEqual(ids(ranked));
    expect(ids(mine)).not.toContain("w-stale");
    expect(ids(mine)).not.toContain("w-gone");
    expect(ids(mine)).toEqual(["fed", "sr", "w-cashier"]);
  });

  it("a ring of several places is one arm each, and a null-country row comes back for the post-check", async () => {
    const r = await candidates({ p_ring: ["Westerville", "Columbus"] });
    expect(ids(r)).toEqual(["c-ga", "c-oh-null", "fed", "sr", "w-cashier"]);
    expect(r.every((x) => x.lane === "ring")).toBe(true);
  });

  it("the server surfaces' exclusions withhold usajobs and smartrecruiters", async () => {
    const r = await candidates({ p_ring: ["Westerville"], p_exclude_sources: ["usajobs", "smartrecruiters"] });
    expect(ids(r)).toEqual(["w-cashier"]);
  });
});

describe("the lanes", () => {
  it("remote does not lean on work_mode alone: the flag, the mode, or the location saying remote; only the countries given", async () => {
    const r = await candidates({ p_remote: true });
    expect(ids(r)).toEqual(["r-flag", "r-mode", "r-word"]);
    expect(r.every((x) => x.lane === "remote")).toBe(true);
    expect(ids(await candidates({ p_remote: true, p_countries: ["CA"] }))).toEqual(["r-ca"]);
  });

  it("region reads a state's name and its leading code ('TX - Houston') as search_jobs does", async () => {
    const r = await candidates({ p_regions: ["Texas", ", TX"] });
    expect(ids(r)).toEqual(["tx-lead", "tx-name"]);
  });

  it("the country lane runs only when asked, and each lane keeps its own limit", async () => {
    expect((await candidates({})).length).toBe(0);
    const all = await candidates({ p_country_lane: true });
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(all.every((x) => x.lane === "country")).toBe(true);
    const capped = await candidates({ p_country_lane: true, p_ring: ["Westerville"], p_lane_limit: 2 });
    expect(capped.filter((x) => x.lane === "country")).toHaveLength(2);
    expect(capped.filter((x) => x.lane === "ring")).toHaveLength(2);
  });

  it("recent order runs, and an unknown order is refused", async () => {
    expect((await candidates({ p_ring: ["Westerville"], p_order: "recent" })).length).toBe(3);
    await expect(candidates({ p_order: "fastest" })).rejects.toThrow(/p_order must be rank or recent/);
  });

  it("the simple-index query finds a token the English index drops", async () => {
    await addPostings(db, [{ id: "it-1", title: "IT Support Specialist", location: "Westerville, OH", country: "US" }]);
    const r = await candidates({ p_q_en: null, p_q_simple: '"it support"', p_ring: ["Westerville"] });
    expect(ids(r)).toEqual(["it-1"]);
  });

  it("siblings count the same employer, title and place in a lane", async () => {
    await addPostings(db, [
      { id: "sib-1", title: "Grocery Cashier", location: "Gahanna, OH", country: "US", company: "Kroger" },
      { id: "sib-2", title: "Grocery Cashier", location: "Gahanna, OH", country: "US", company: "Kroger" },
    ]);
    const r = await candidates({ p_ring: ["Gahanna"] });
    expect(r.find((x) => x.id === "sib-1")?.siblings).toBe(2);
  });
});

describe("the timing gate reads the plan of exactly the statement match_candidates runs (spec 6.5)", () => {
  const explain = async (args: Record<string, unknown>): Promise<string[]> => {
    const a = { p_q_en: "cashier", p_countries: ["US"], p_ring: [], p_remote: false, p_regions: [], p_country_lane: false, p_order: "rank", ...args };
    const r = await db.query<{ e: string }>(
      `SELECT e FROM public.match_candidates_explain(p_q_en => $1, p_q_simple => NULL, p_fresh_cutoff => ${CUT}, p_countries => $2::text[], p_ring => $3::text[],
         p_remote => $4, p_regions => $5::text[], p_country_lane => $6, p_order => $7) e`,
      [a.p_q_en, a.p_countries, a.p_ring, a.p_remote, a.p_regions, a.p_country_lane, a.p_order],
    );
    return r.rows.map((x) => x.e);
  };

  it("one lane is one limited scan; the union of two lanes appends two; both are analysed", async () => {
    const one = await explain({ p_ring: ["Westerville"] });
    expect(one.join("\n")).toMatch(/Execution Time/);
    expect(one.join("\n")).not.toMatch(/\bAppend\b/);
    const two = (await explain({ p_ring: ["Westerville"], p_remote: true })).join("\n");
    expect(two).toMatch(/\bAppend\b/);
    expect(two.match(/-> {2}Limit\b/g)?.length).toBe(2);
  });

  it("its top node counts the rows match_candidates returns for the same arguments", async () => {
    const plan = await explain({ p_ring: ["Westerville"] });
    const rows = (await candidates({ p_ring: ["Westerville"] })).length;
    expect(rows).toBe(3);
    expect(plan[0]).toMatch(new RegExp(`actual [^)]*rows=${rows}(\\.00)? loops=1`));
    const recent = await explain({ p_ring: ["Westerville"], p_order: "recent" });
    expect(recent[0]).toMatch(new RegExp(`actual [^)]*rows=${rows}(\\.00)? loops=1`));
  });

  it("no lane, or no usable title query, is said in words and runs nothing", async () => {
    expect(await explain({})).toEqual(["no lane to run: no title query, or no ring, remote, region or country lane"]);
    expect(await explain({ p_q_en: "the", p_ring: ["Westerville"] })).toEqual(["no lane to run: no title query, or no ring, remote, region or country lane"]);
    const built = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.match_candidates_query('cashier', NULL, ARRAY['US'], ARRAY[]::text[], false, ARRAY[]::text[], false)`);
    expect(built.rows[0].n).toBe(0);
    const union = await db.query<{ stmt: string }>(`SELECT stmt FROM public.match_candidates_query('cashier', NULL, ARRAY['US'], ARRAY['Westerville'], true, ARRAY[]::text[], false)`);
    expect(union.rows[0].stmt.match(/ UNION ALL /g)?.length).toBe(1);
  });
});

describe("who may call it, and running it twice", () => {
  it("no client role holds anything on the new objects; the service role holds what resume-match needs", async () => {
    const q = async (sql: string) => Object.values((await db.query<Record<string, boolean>>(sql)).rows[0])[0];
    for (const role of ["anon", "authenticated"]) {
      expect(await q(`SELECT has_function_privilege('${role}', 'public.match_candidates(text, text, timestamptz, text[], text[], boolean, text[], boolean, text[], integer, text, text[])', 'EXECUTE')`)).toBe(false);
      expect(await q(`SELECT has_function_privilege('${role}', 'public.metro_ring(text, text, text, integer, integer)', 'EXECUTE')`)).toBe(false);
      expect(await q(`SELECT has_function_privilege('${role}', 'public.match_candidates_query(${SIG11})', 'EXECUTE')`)).toBe(false);
      expect(await q(`SELECT has_function_privilege('${role}', 'public.match_candidates_explain(${SIG12})', 'EXECUTE')`)).toBe(false);
      for (const t of ["geo_places", "job_posting_requirements"]) {
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect(await q(`SELECT has_table_privilege('${role}', 'public.${t}', '${p}')`), `${role} ${p} ${t}`).toBe(false);
      }
    }
    expect(await q(`SELECT has_function_privilege('service_role', 'public.match_candidates(text, text, timestamptz, text[], text[], boolean, text[], boolean, text[], integer, text, text[])', 'EXECUTE')`)).toBe(true);
    expect(await q(`SELECT has_function_privilege('service_role', 'public.match_candidates_query(${SIG11})', 'EXECUTE')`)).toBe(true);
    expect(await q(`SELECT has_function_privilege('service_role', 'public.match_candidates_explain(${SIG12})', 'EXECUTE')`)).toBe(true);
    expect(await q(`SELECT has_table_privilege('service_role', 'public.job_posting_requirements', 'INSERT')`)).toBe(true);
    expect(await q(`SELECT has_table_privilege('service_role', 'public.geo_places', 'SELECT')`)).toBe(true);
  });

  it("every file applies a second time and still verifies itself", async () => {
    for (const m of MATCH_MIGRATIONS) await db.exec(migrationText(m));
    expect((await candidates({ p_ring: ["Westerville"] })).length).toBe(3);
  });

  it("the self-checks raise when a client role could call or read (positive control)", async () => {
    await db.exec(`GRANT EXECUTE ON FUNCTION public.metro_ring(text, text, text, integer, integer) TO anon`);
    await expect(db.exec(migrationText("20261016101000").replace(/REVOKE ALL ON FUNCTION[^;]+;/, ""))).rejects.toThrow(/executable by a client role/);
    await db.exec(`REVOKE ALL ON FUNCTION public.metro_ring(text, text, text, integer, integer) FROM anon`);
    await db.exec(`GRANT SELECT ON public.job_posting_requirements TO authenticated`);
    await expect(db.exec(migrationText("20261016103000").replace(/REVOKE ALL ON public\.job_posting_requirements[^;]+;/, ""))).rejects.toThrow(/authenticated still holds SELECT/);
    await db.exec(`REVOKE ALL ON public.job_posting_requirements FROM authenticated`);
    await db.exec(`GRANT EXECUTE ON FUNCTION public.match_candidates_explain(${SIG12}) TO anon`);
    await expect(db.exec(migrationText("20261016102000").replace(/REVOKE ALL ON FUNCTION public\.match_candidates_explain[^;]+;/, "")))
      .rejects.toThrow(/match_candidates_explain\([^)]*\) is executable by a client role/);
    await db.exec(migrationText("20261016102000"));
  });
});
