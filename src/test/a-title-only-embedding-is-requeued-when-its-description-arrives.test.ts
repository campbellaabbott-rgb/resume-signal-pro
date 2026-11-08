// @vitest-environment node
/**
 * A TITLE-ONLY EMBEDDING IS REQUEUED WHEN ITS DESCRIPTION ARRIVES
 * (cost audit 2026-11-08, "Embed re-queue"; migration 20261109150000).
 *
 * get_embed_batch's phase 2 found title-only embeddings whose description had
 * arrived by probing the 1,000 oldest and bumping every miss's updated_at -- a
 * non-HOT write of a vector row per miss, forever for rows that never get a
 * description. Now a trigger queues the posting when its description goes
 * from NULL to text, and phase 2 reads that queue.
 *
 * pglite under Supabase's default grants (no pgvector here: the embedding is a
 * real[] stand-in, which is all these functions test -- NULL or not). The
 * caller is played by the embed sweep's own write: {id, embedding,
 * embedded_desc: has_desc, updated_at}.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const OLD = readFileSync(resolve(MIG, "20260812200000_embed_batch_rotates_instead_of_rescanning.sql"), "utf8");
const NEW = readFileSync(resolve(MIG, "20261109150000_a_title_only_embedding_is_requeued_when_its_description_arrives.sql"), "utf8");

const SCHEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, title text NOT NULL, company text NOT NULL DEFAULT 'Acme', location text,
    description text, missing_since timestamptz);
  CREATE TABLE public.job_board_embeddings (
    id text PRIMARY KEY REFERENCES public.job_board_postings(id) ON DELETE CASCADE,
    embedding real[], embedded_desc boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE FUNCTION public.seed_embedding_row() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    INSERT INTO public.job_board_embeddings (id, embedding, embedded_desc, updated_at) VALUES (NEW.id, NULL, false, now())
    ON CONFLICT DO NOTHING;
    RETURN NULL;
  END $$;
  CREATE TRIGGER seed_embedding_row AFTER INSERT ON public.job_board_postings FOR EACH ROW EXECUTE FUNCTION public.seed_embedding_row();
`;
const LONG = "We build logistics software. ".repeat(20);

// Before the migration: one title-only row whose text has arrived (the probe
// would find it), one that never gets a description, one embedded with text.
const BEFORE = `
  INSERT INTO public.job_board_postings (id, title, description) VALUES
    ('gh:acme:arrived', 'Engineer', '${LONG}'),
    ('gh:acme:never', 'Driver', NULL),
    ('gh:acme:done', 'Designer', '${LONG}');
  UPDATE public.job_board_embeddings SET embedding = ARRAY[0.1]::real[], embedded_desc = false, updated_at = now() - interval '3 days'
   WHERE id IN ('gh:acme:arrived', 'gh:acme:never');
  UPDATE public.job_board_embeddings SET embedding = ARRAY[0.2]::real[], embedded_desc = true, updated_at = now() - interval '3 days'
   WHERE id = 'gh:acme:done';
`;

type Batch = { id: string; has_desc: boolean; descr: string };
const batch = async (db: PGlite, n = 10) =>
  (await db.query<Batch>("SELECT id, has_desc, descr FROM public.get_embed_batch($1)", [n])).rows;
const queue = async (db: PGlite) =>
  (await db.query<{ id: string }>("SELECT id FROM public.job_board_embed_requeue ORDER BY id")).rows.map((r) => r.id);
const stamps = async (db: PGlite) =>
  Object.fromEntries((await db.query<{ id: string; at: string; xmin: string }>(
    "SELECT id, updated_at::text AS at, xmin::text AS xmin FROM public.job_board_embeddings ORDER BY id")).rows.map((r) => [r.id, `${r.at}/${r.xmin}`]));
/** The embed sweep's write for the rows it was handed. */
const embedded = (db: PGlite, rows: Batch[]) =>
  Promise.all(rows.map((r) => db.query(
    "UPDATE public.job_board_embeddings SET embedding = ARRAY[0.3]::real[], embedded_desc = $2, updated_at = now() WHERE id = $1",
    [r.id, r.has_desc])));

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });
async function boot(apply: string[]): Promise<PGlite> {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec(SCHEMA);
  await db.exec(BEFORE);
  for (const sql of apply) await db.exec(sql);
  return db;
}

describe("the queue is seeded with what the probe would have found", () => {
  let db: PGlite;
  beforeAll(async () => { db = await boot([OLD, NEW]); });

  it("a title-only row whose description already arrived is queued; one with no description, or embedded with text, is not", async () => {
    expect(await queue(db)).toEqual(["gh:acme:arrived"]);
  });

  it("re-applying the migration changes nothing", async () => {
    await db.exec(NEW);
    expect(await queue(db)).toEqual(["gh:acme:arrived"]);
  });
});

describe("the trigger queues a description that arrives, and nothing else", () => {
  let db: PGlite;
  beforeAll(async () => { db = await boot([OLD, NEW]); });

  it("NULL to text queues the posting", async () => {
    await db.query("UPDATE public.job_board_postings SET description = $1 WHERE id = 'gh:acme:never'", [LONG]);
    expect(await queue(db)).toEqual(["gh:acme:arrived", "gh:acme:never"]);
  });

  it("a write that leaves the description alone, or replaces text with text, queues nothing; nor does a new posting", async () => {
    await db.exec("UPDATE public.job_board_postings SET title = 'Senior Designer' WHERE id = 'gh:acme:done'");
    await db.exec("UPDATE public.job_board_postings SET description = description || ' More.' WHERE id = 'gh:acme:done'");
    await db.query("INSERT INTO public.job_board_postings (id, title, description) VALUES ('gh:acme:new', 'Analyst', $1)", [LONG]);
    expect(await queue(db)).toEqual(["gh:acme:arrived", "gh:acme:never"]);
  });
});

describe("the batch reads the queue and never writes an embedding row", () => {
  let db: PGlite;
  beforeAll(async () => { db = await boot([OLD, NEW]); });

  it("phase 1 still goes first: a never-embedded posting is handed out before any re-embed", async () => {
    await db.query("INSERT INTO public.job_board_postings (id, title, description) VALUES ('gh:acme:fresh', 'Analyst', $1)", [LONG]);
    const first = await batch(db);
    expect(first.map((r) => r.id)).toEqual(["gh:acme:fresh"]);
    await embedded(db, first);
  });

  it("phase 2 hands out the queued row with its text, and leaves every embedding row untouched", async () => {
    const before = await stamps(db);
    const got = await batch(db);
    expect(got).toEqual([{ id: "gh:acme:arrived", has_desc: true, descr: LONG.slice(0, 1200) }]);
    expect(await stamps(db), "no embedding row was bumped -- not the miss, not the hit").toEqual(before);
  });

  it("the row that never gets a description is never visited again", async () => {
    const before = await stamps(db);
    for (let i = 0; i < 3; i++) await batch(db);
    expect((await stamps(db))["gh:acme:never"]).toBe(before["gh:acme:never"]);
  });

  it("once the sweep stores the embedding with its text, the entry is pruned on the next call", async () => {
    const got = await batch(db);
    await embedded(db, got);
    expect(await batch(db)).toEqual([]);
    expect(await queue(db)).toEqual([]);
  });

  it("an entry whose posting was deleted is pruned, not handed out", async () => {
    await db.query("UPDATE public.job_board_postings SET description = $1 WHERE id = 'gh:acme:never'", [LONG]);
    expect(await queue(db)).toEqual(["gh:acme:never"]);
    await db.exec("DELETE FROM public.job_board_postings WHERE id = 'gh:acme:never'");
    expect(await batch(db)).toEqual([]);
    expect(await queue(db)).toEqual([]);
  });
});

describe("a call looks at the head of the queue only", () => {
  it("a done entry behind a thousand older ones waits for the head, and is pruned once the head has turned over", async () => {
    const db = await boot([OLD, NEW]);
    // A thousand older entries still to embed, then one already embedded with text.
    await db.query(`
      INSERT INTO public.job_board_postings (id, title, description)
      SELECT 'gh:bulk:' || i, 'Role ' || i, $1 FROM generate_series(1, 1000) i`, [LONG]);
    await db.exec(`
      UPDATE public.job_board_embeddings SET embedding = ARRAY[0.1]::real[], embedded_desc = false WHERE id LIKE 'gh:bulk:%';
      INSERT INTO public.job_board_embed_requeue (id, queued_at)
      SELECT 'gh:bulk:' || i, now() - interval '2 days' + make_interval(secs => i) FROM generate_series(1, 1000) i;
      UPDATE public.job_board_embeddings SET embedding = ARRAY[0.2]::real[], embedded_desc = true WHERE id = 'gh:acme:arrived';
      UPDATE public.job_board_embed_requeue SET queued_at = now() - interval '1 day' WHERE id = 'gh:acme:arrived';`);
    await batch(db, 50);
    expect(await queue(db), "the done entry sits behind a thousand older ones").toContain("gh:acme:arrived");
    // Every older entry is embedded with its text; the next calls prune the
    // head, and the done entry with it once it reaches the first thousand.
    await db.exec("UPDATE public.job_board_embeddings SET embedded_desc = true WHERE id LIKE 'gh:bulk:%'");
    await batch(db, 50);
    await batch(db, 50);
    expect(await queue(db)).toEqual([]);
  });
});

describe("teeth: the probe it replaces", () => {
  it("bumped the never-described row's updated_at on every call", async () => {
    const db = await boot([OLD]);
    const before = await stamps(db);
    await batch(db);
    expect((await stamps(db))["gh:acme:never"]).not.toBe(before["gh:acme:never"]);
  });
});

describe("under Supabase's default grants", () => {
  it("neither client role can read or write the queue, or call the batch", async () => {
    const db = await boot([OLD, NEW]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await expect(db.query("SELECT * FROM public.job_board_embed_requeue")).rejects.toThrow(/permission denied/);
      await expect(db.query("INSERT INTO public.job_board_embed_requeue (id) VALUES ('x')")).rejects.toThrow(/permission denied/);
      await expect(db.query("SELECT * FROM public.get_embed_batch(1)")).rejects.toThrow(/permission denied/);
      await db.exec("RESET ROLE");
    }
  });

  it("a description filled by the edge functions' own role is queued too", async () => {
    const db = await boot([OLD, NEW]);
    await db.exec("SET ROLE service_role");
    await db.query("UPDATE public.job_board_postings SET description = $1 WHERE id = 'gh:acme:never'", [LONG]);
    await db.exec("RESET ROLE");
    expect(await queue(db)).toEqual(["gh:acme:arrived", "gh:acme:never"]);
  });
});
