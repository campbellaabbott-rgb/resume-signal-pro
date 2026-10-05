// @vitest-environment node
/**
 * THE EXPLORE GRID'S ONE-CLICK COUNT IS THE SENDABLE LIST, IN SQL.
 *
 * WHAT WAS WRONG (agents-api review, 2026-10-05). Oracle left SENDABLE_VENDORS
 * and the worker's ADAPTERS — its adapter never reaches a submit — and
 * get_explore_field_grid's `one_click` flag, a hand copy of that list whose own
 * note says it changes in the same commit, kept 'oracle'. The explore cache's
 * one_click_n went on counting every Oracle posting as one the agent can send.
 *
 * WHAT THIS HOLDS, by running the shipped migration in pglite: the list lives
 * in one SQL function, one_click_vendors(), equal to SENDABLE_VENDORS; and the
 * grid, run over Oracle, Breezy and Greenhouse postings, counts only the
 * vendor the agent can send on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { SENDABLE_VENDORS } from "../../supabase/functions/_shared/apply-automation.ts";
import { migration, M_ONE_CLICK } from "./helpers/agent-db";
import { liveDefinitionOf } from "./helpers/live-sql";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.job_board_postings (
      id text PRIMARY KEY, source text NOT NULL, category text NOT NULL DEFAULT 'engineering',
      remote boolean NOT NULL DEFAULT false, work_mode text, salary text, salary_min_annual numeric,
      salary_rank_usd numeric, experience_band text, employment_type text, posted_at timestamptz,
      missing_since timestamptz, effective_posted timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO public.job_board_postings (id, source) VALUES
      ('oracle:t:1', 'oracle'), ('oracle:t:2', 'oracle'), ('oracle:t:3', 'oracle'),
      ('breezy:t:1', 'breezy'), ('teamtailor:t:1', 'teamtailor'),
      ('greenhouse:t:1', 'greenhouse');
    -- Gone from the board: never counted, whatever its vendor.
    INSERT INTO public.job_board_postings (id, source, missing_since) VALUES ('breezy:t:gone', 'breezy', now());
  `);
  await db.exec(migration(M_ONE_CLICK));
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("one_click_vendors() is SENDABLE_VENDORS", () => {
  it("holds exactly the vendors the agent can send on, Oracle not among them", async () => {
    const r = await db.query<{ v: string[] }>(`SELECT public.one_click_vendors() AS v`);
    expect([...r.rows[0].v].sort()).toEqual([...SENDABLE_VENDORS].sort());
    expect(r.rows[0].v).not.toContain("oracle");
  });
});

describe("get_explore_field_grid counts one-click from that list", () => {
  it("over Oracle, Breezy, Teamtailor and Greenhouse postings, one_click_n counts Breezy and Teamtailor only", async () => {
    const r = await db.query<{ g: { board: { n: number; one_click_n: number } } }>(`SELECT public.get_explore_field_grid() AS g`);
    expect(r.rows[0].g.board.n).toBe(6);
    expect(r.rows[0].g.board.one_click_n).toBe(2);
  });

  it("is the live definition, and it keeps no vendor list of its own", () => {
    const { file, body } = liveDefinitionOf("get_explore_field_grid");
    expect(file).toBe(M_ONE_CLICK);
    expect(body).toMatch(/p\.source = ANY \(public\.one_click_vendors\(\)\)/);
    expect(body).not.toMatch(/ARRAY\['breezy'/);
  });

  it("neither function is callable with the publishable key", async () => {
    const r = await db.query<{ a: boolean; b: boolean; c: boolean; d: boolean }>(`
      SELECT has_function_privilege('anon', 'public.one_click_vendors()', 'EXECUTE') AS a,
             has_function_privilege('authenticated', 'public.one_click_vendors()', 'EXECUTE') AS b,
             has_function_privilege('anon', 'public.get_explore_field_grid()', 'EXECUTE') AS c,
             has_function_privilege('authenticated', 'public.get_explore_field_grid()', 'EXECUTE') AS d`);
    expect(r.rows[0]).toEqual({ a: false, b: false, c: false, d: false });
  });
});
