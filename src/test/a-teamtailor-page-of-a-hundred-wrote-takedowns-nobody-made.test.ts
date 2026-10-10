// @vitest-environment node
/**
 * A TEAMTAILOR PAGE OF A HUNDRED WROTE TAKEDOWNS NOBODY MADE: THE REPAIR.
 *
 * Sweep S8-002. Until .92 a Teamtailor board of more than 100 postings was
 * read as a whole board of 100, and every posting pushed past item 100 was
 * logged to job_board_closures as an unsuspect employer takedown. Migration
 * 20261009100300 marks those closures suspect, lists each in
 * job_board_closure_repairs so the marking can be undone exactly, and leaves
 * every other closure alone. Run here against a real Postgres (pglite).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const FILE = "20261009100300_a_teamtailor_page_of_a_hundred_wrote_takedowns_nobody_made.sql";
const SQL = readFileSync(resolve(__dirname, "../../supabase/migrations", FILE), "utf8");

const SCHEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_closures (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    posting_id text, source text, company_token text, closed_at timestamptz NOT NULL DEFAULT now(),
    suspect boolean NOT NULL DEFAULT false, absence_basis text);
  CREATE TABLE public.job_board_board_state (
    company_token text NOT NULL, observed_on date NOT NULL DEFAULT current_date, source text NOT NULL DEFAULT '',
    observed_at timestamptz NOT NULL DEFAULT now(), live_count integer, stored_count integer, feed_total integer,
    state text NOT NULL DEFAULT 'ok', PRIMARY KEY (company_token, observed_on));
`;

// eutalents: in the measured list. bigboard: not in it, but the history shows 104 stored on one day.
// smallboard: a teamtailor board that never served a second page. libra: also a greenhouse token.
const FIXTURE = `
  INSERT INTO public.job_board_board_state (company_token, observed_on, source, live_count, stored_count) VALUES
    ('bigboard', '2026-09-20', 'teamtailor', 97, 104),
    ('smallboard', '2026-09-20', 'teamtailor', 41, 43);
  INSERT INTO public.job_board_closures (posting_id, source, company_token, absence_basis, suspect) VALUES
    ('teamtailor:eutalents:1', 'teamtailor', 'eutalents', 'full_read', false),
    ('teamtailor:eutalents:2', 'teamtailor', 'eutalents', NULL, false),
    ('teamtailor:eutalents:3', 'teamtailor', 'eutalents', 'full_read', true),
    ('teamtailor:eutalents:4', 'teamtailor', 'eutalents', 'lap', false),
    ('teamtailor:bigboard:1', 'teamtailor', 'bigboard', 'full_read', false),
    ('teamtailor:smallboard:1', 'teamtailor', 'smallboard', 'full_read', false),
    ('greenhouse:libra:1', 'greenhouse', 'libra', 'full_read', false),
    ('teamtailor:libra:1', 'teamtailor', 'libra', 'full_read', false);
`;

let db: PGlite;
const suspectOf = async () =>
  Object.fromEntries((await db.query<{ posting_id: string; suspect: boolean }>(`SELECT posting_id, suspect FROM public.job_board_closures`)).rows.map((r) => [r.posting_id, r.suspect]));
const listed = async () =>
  (await db.query<{ posting_id: string }>(
    `SELECT c.posting_id FROM public.job_board_closure_repairs r JOIN public.job_board_closures c USING (event_id) WHERE r.repair = 'teamtailor_rss_page_s8_002' ORDER BY 1`,
  )).rows.map((r) => r.posting_id);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(FIXTURE);
  await db.exec(SQL);
});
afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("the closures a 100-item page wrote are marked suspect, and only those", () => {
  it("marks every full_read and pre-basis closure on a board known to serve more than one page", async () => {
    const s = await suspectOf();
    expect(s["teamtailor:eutalents:1"]).toBe(true);
    expect(s["teamtailor:eutalents:2"]).toBe(true);
    expect(s["teamtailor:bigboard:1"], "a board the history saw holding more than 100 rows").toBe(true);
    expect(s["teamtailor:libra:1"]).toBe(true);
  });

  it("leaves a lap closure, a board that never had a second page, and another vendor's twin alone", async () => {
    const s = await suspectOf();
    expect(s["teamtailor:eutalents:4"]).toBe(false);
    expect(s["teamtailor:smallboard:1"]).toBe(false);
    expect(s["greenhouse:libra:1"]).toBe(false);
  });

  it("lists exactly what it marked, so the marking can be undone", async () => {
    expect(await listed()).toEqual(["teamtailor:bigboard:1", "teamtailor:eutalents:1", "teamtailor:eutalents:2", "teamtailor:libra:1"]);
  });

  it("is safe to run again: nothing new is listed, and a closure written after the first run is marked by the second", async () => {
    await db.exec(`INSERT INTO public.job_board_closures (posting_id, source, company_token, absence_basis) VALUES ('teamtailor:tutoringjobs:9', 'teamtailor', 'tutoringjobs', 'full_read')`);
    await db.exec(SQL);
    expect(await listed()).toEqual(["teamtailor:bigboard:1", "teamtailor:eutalents:1", "teamtailor:eutalents:2", "teamtailor:libra:1", "teamtailor:tutoringjobs:9"]);
  });

  it("sorts after the .92 migrations that may go in first, so a runner applying by filename order applies it last", () => {
    const note = readFileSync(resolve(__dirname, "../../docs/job-board-deploy-notes.md"), "utf8");
    const section = note.slice(note.indexOf("## 2026-09-09.92"), note.indexOf("## 2026-09-09.91"));
    const apply = section.slice(section.indexOf("2. APPLY"), section.indexOf("3. TELL THE OWNER"));
    const order = [...apply.matchAll(/^ {3}- (\d{14})_/gm)].map((m) => m[1]);
    expect(order.length).toBeGreaterThanOrEqual(3);
    expect(order, "the note's apply order is not the order the filenames sort in").toEqual([...order].sort());
    expect(order.at(-1), "the repair that waits for .92 is not the last in the note's order").toBe(FILE.slice(0, 14));
  });

  it("keeps the repair list out of reach of anon and authenticated", async () => {
    const { rows } = await db.query<{ a: boolean; u: boolean; s: boolean }>(
      `SELECT has_table_privilege('anon', 'public.job_board_closure_repairs', 'SELECT') AS a,
              has_table_privilege('authenticated', 'public.job_board_closure_repairs', 'SELECT') AS u,
              has_table_privilege('service_role', 'public.job_board_closure_repairs', 'INSERT') AS s`,
    );
    expect(rows[0]).toEqual({ a: false, u: false, s: true });
  });
});
