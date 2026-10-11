// @vitest-environment node
/**
 * THE EMPLOYER CHECK RE-READ EVERY CARRIED EMPLOYER ONCE PER EMPLOYER ON THE BOARD.
 *
 * Review of migration 20261009100200 (2026-10-10). get_company_suggest, the
 * anon lookup the Explore page fires as the reader types, matched the
 * employers a multi-employer feed carries with a correlated EXISTS under an
 * OR. That cannot become a semi-join, so it ran once per companiesFacet entry
 * (25k-32k live) and re-expanded carriedEmployers out of the multi-MB cached
 * facets row each time. Measured in pglite at 32,000 entries: 75,917 ms for
 * 'veterans health' against 56 ms before the carried match existed, and a
 * query matching nothing paid the same. The function's own statement_timeout
 * is 5s, so live every keystroke would have errored after costing 5s.
 *
 * pglite does not enforce statement_timeout, so the bound is asserted on the
 * clock: half the function's own timeout, at the live board's size.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 120_000 });

const FILE = "20261009100200_federal_jobs_were_credited_to_whichever_agency_sorted_last.sql";
const SQL = readFileSync(resolve(__dirname, "../../supabase/migrations", FILE), "utf8");
const FUNCTION_TIMEOUT_MS = 5_000;
const ENTRIES = 30_000;

const SCHEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, company_token text, company text, source text, category text,
    missing_since timestamptz, effective_posted timestamptz NOT NULL DEFAULT now());
  CREATE INDEX ON public.job_board_postings (company_token);
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb, updated_at timestamptz);
  CREATE TABLE public.job_board_verifications (company_token text PRIMARY KEY, feed_total int, verified_at timestamptz);
`;

let db: PGlite;
type Hit = { name: string; tokens: string[] };
const timed = async (q: string) => {
  const t0 = performance.now();
  const { rows } = await db.query<Hit>(`SELECT name, tokens FROM public.get_company_suggest($1)`, [q]);
  return { rows, ms: performance.now() - t0 };
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(SQL);
  // A facets row the live board's size: one entry per employer board, and the
  // federal feed carrying several hundred agencies.
  const companiesFacet = Array.from({ length: ENTRIES }, (_, i) => ({
    token: `tenant${i}~wd5~Careers_${i}`, name: `Employer Number ${i} Holdings`, count: 10 + (i % 50),
  }));
  companiesFacet.push({ token: "usajobs", name: "USAJOBS", count: 9_474 });
  const carriedEmployers = {
    usajobs: [...Array.from({ length: 500 }, (_, i) => `Agency ${i} Administration`), "Veterans Health Administration"],
  };
  await db.query(`INSERT INTO public.job_board_meta (k, v, updated_at) VALUES ('facets', $1, now())`, [
    JSON.stringify({ total: 900_000, companiesFacet, carriedEmployers }),
  ]);
});
afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("the employer check answers inside its own timeout at the live board's size", () => {
  it("a carried agency is found without re-reading the cache per employer", async () => {
    const { rows, ms } = await timed("veterans health");
    expect(rows.map((r) => r.name)).toEqual(["USAJOBS"]);
    expect(ms, `${ENTRIES} facet entries took ${Math.round(ms)} ms`).toBeLessThan(FUNCTION_TIMEOUT_MS / 2);
  });

  it("a query matching nothing does not pay for the carried match per row either", async () => {
    const { rows, ms } = await timed("zzz nothing");
    expect(rows).toEqual([]);
    expect(ms, `${ENTRIES} facet entries took ${Math.round(ms)} ms`).toBeLessThan(FUNCTION_TIMEOUT_MS / 2);
  });

  it("a plain employer name still answers, ordered as before", async () => {
    const { rows, ms } = await timed("employer number 31");
    expect(rows[0]).toEqual({ name: "Employer Number 31 Holdings", tokens: ["tenant31~wd5~Careers_31"] });
    expect(rows).toHaveLength(8);
    expect(ms).toBeLessThan(FUNCTION_TIMEOUT_MS / 2);
  });
});
