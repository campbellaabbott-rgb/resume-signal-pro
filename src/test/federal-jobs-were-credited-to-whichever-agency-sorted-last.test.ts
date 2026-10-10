// @vitest-environment node
/**
 * FEDERAL JOBS WERE CREDITED TO WHICHEVER AGENCY SORTED LAST.
 *
 * Sweep S8-022 (2026-10-08). Every USAJOBS posting carries the token
 * 'usajobs' and its own agency as `company`, and refresh_job_board_facets
 * named each token max(company): live, the whole federal feed (7,924 roles)
 * was faceted as 'Western Area Power Administration', get_company_suggest
 * answered 'western area' with it and answered [] for 'veterans health'
 * though 1,446 VHA postings were open.
 *
 * Migration 20261009100200, run here against a real Postgres (pglite), with
 * the facet name it writes held equal to the renderers' module.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { boardDisplayName, employerDisplayName, MULTI_EMPLOYER_BOARD_NAMES } from "../../supabase/functions/_shared/employer-names";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const FILE = "20261009100200_federal_jobs_were_credited_to_whichever_agency_sorted_last.sql";
const SQL = readFileSync(resolve(__dirname, "../../supabase/migrations", FILE), "utf8");

const SCHEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, company_token text, company text, source text, category text,
    missing_since timestamptz, effective_posted timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb, updated_at timestamptz);
  CREATE TABLE public.job_board_verifications (company_token text PRIMARY KEY, feed_total int, verified_at timestamptz);
`;

const FIXTURE = `
  INSERT INTO public.job_board_postings (id, company_token, company, source, category, missing_since) VALUES
    ('usajobs:usajobs:1', 'usajobs', 'Veterans Health Administration', 'usajobs', 'healthcare', NULL),
    ('usajobs:usajobs:2', 'usajobs', 'Veterans Health Administration', 'usajobs', 'healthcare', NULL),
    ('usajobs:usajobs:3', 'usajobs', 'Veterans Health Administration', 'usajobs', 'healthcare', NULL),
    ('usajobs:usajobs:4', 'usajobs', 'Western Area Power Administration', 'usajobs', 'engineering', NULL),
    ('usajobs:usajobs:5', 'usajobs', 'Forest Service', 'usajobs', 'science', now() - interval '2 days'),
    ('greenhouse:acme:1', 'acme', 'Acme', 'greenhouse', 'engineering', NULL),
    ('greenhouse:acme:2', 'acme', 'Acme', 'greenhouse', 'engineering', NULL);
`;

let db: PGlite;
type Hit = { name: string; tokens: string[]; open_roles: number };
const suggest = async (q: string) =>
  (await db.query<Hit>(`SELECT name, tokens, open_roles FROM public.get_company_suggest($1)`, [q])).rows;
const facets = async () =>
  (await db.query<{ v: { companiesFacet: Array<{ token: string; name: string }>; carriedEmployers?: Record<string, string[]> } }>(
    `SELECT v FROM public.job_board_meta WHERE k = 'facets'`,
  )).rows[0].v;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(FIXTURE);
  await db.exec(SQL);
  await db.query(`SELECT public.refresh_job_board_facets()`);
});
afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("the federal feed is named as itself, not after one agency", () => {
  it("the company facet names token usajobs by the feed's own name, the one the renderers use", async () => {
    const entry = (await facets()).companiesFacet.find((c) => c.token === "usajobs")!;
    expect(entry.name, "max(company) named seven thousand federal roles after one agency").toBe(MULTI_EMPLOYER_BOARD_NAMES.get("usajobs"));
    expect(boardDisplayName("usajobs", "Western Area Power Administration")).toBe(entry.name);
    // A posting card still names its own agency.
    expect(employerDisplayName("usajobs", "Veterans Health Administration")).toBe("Veterans Health Administration");
    expect((await facets()).companiesFacet.find((c) => c.token === "acme")!.name).toBe("Acme");
  });

  it("an employer the feed carries is found, and answers with the feed it is on", async () => {
    expect(await suggest("veterans health"), "the largest federal employer was reported as not carried").toEqual([
      { name: "U.S. federal agencies (USAJOBS)", tokens: ["usajobs"], open_roles: 4 },
    ]);
  });

  it("the agency that sorted last no longer stands for the whole feed", async () => {
    const hits = await suggest("western area");
    expect(hits.map((h) => h.name)).toEqual(["U.S. federal agencies (USAJOBS)"]);
  });

  it("only employers with an open posting are carried, and only multi-employer feeds list them", async () => {
    expect(await suggest("forest service")).toEqual([]);
    expect(Object.keys((await facets()).carriedEmployers ?? {})).toEqual(["usajobs"]);
    expect(await suggest("acme")).toEqual([{ name: "Acme", tokens: ["acme"], open_roles: 2 }]);
  });

  it("is safe to run again, and keeps the lookup callable and the rebuild locked", async () => {
    await db.exec(SQL);
    const { rows } = await db.query<{ s: boolean; r: boolean }>(
      `SELECT has_function_privilege('anon', 'public.get_company_suggest(text)', 'EXECUTE') AS s,
              has_function_privilege('anon', 'public.refresh_job_board_facets()', 'EXECUTE') AS r`,
    );
    expect(rows[0]).toEqual({ s: true, r: false });
  });
});
