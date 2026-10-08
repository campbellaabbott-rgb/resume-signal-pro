// @vitest-environment node
/**
 * A ROLE THAT CLOSED TWICE IS ONE RE-LISTED ROLE, NOT TWO FILLS.
 *
 * The employer pages printed get_company_fill_curve.fills_90d as roles "taken
 * down for good, not re-listed" and "come off the board and stay off". It is a
 * sum over closure EVENTS: a posting that closed twice counted twice, and one
 * that closed and is serving again today counted as a fill. Live on
 * 2026-10-04 Johnson & Johnson read 2,499 against at most 1,799 roles that
 * stayed down (register L11-02). 20261008110000 appends filled_roles_90d and
 * relisted_roles_90d, counted per posting_id the way
 * get_actively_hiring_companies counts them.
 *
 * One board, every shape a role can take, executed against the real function:
 *   f1..f5  closed once, not superseded, not back           5 filled
 *   t1..t3  closed, stored again, closed again              3 re-listed (6 fill events)
 *   l1..l2  closed once and serving again today             2 re-listed (2 fill events)
 *   s1..s2  closed once as a same-title re-list (superseded) 2 re-listed (2 re-list events)
 *   d1      a suspect closure, never seen again             neither (doubted)
 *   r1      a suspect closure, stored again, then closed    1 filled (the doubted one is dropped)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SEEN_AGAIN_SCHEMA } from "./helpers/seen-again-fixture";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const NEW_COMPANY = "20261008110000_a_role_is_counted_once_and_a_posting_seen_again_never_came_down.sql";

const closure = (id: string, closedDaysAgo: number, opts: { superseded?: boolean; suspect?: boolean } = {}) => `
  INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, first_seen, closed_at, superseded, suspect, batch_live_before, absence_basis)
  VALUES ('R:${id}', 'greenhouse', 'R', 'engineering', now() - interval '25 days', now() - interval '25 days',
          now() - interval '${closedDaysAgo} days', ${opts.superseded ? "true" : "false"}, ${opts.suspect ? "true" : "NULL"}, 5000, 'full_read');`;
const stored = (id: string, firstSeenDaysAgo: number) => `
  INSERT INTO public.job_board_postings (id, source, company_token, category, posted_at, effective_posted, first_seen, last_seen)
  VALUES ('R:${id}', 'greenhouse', 'R', 'engineering', now() - interval '25 days', now() - interval '25 days',
          now() - interval '${firstSeenDaysAgo} days', now() - interval '${firstSeenDaysAgo} days');`;

const FIXTURE = [
  ...["f1", "f2", "f3", "f4", "f5"].map((id) => closure(id, 12)),
  ...["t1", "t2", "t3"].flatMap((id) => [closure(id, 20), closure(id, 8)]),
  ...["l1", "l2"].flatMap((id) => [closure(id, 15), stored(id, 10)]),
  ...["s1", "s2"].map((id) => closure(id, 14, { superseded: true })),
  closure("d1", 18, { suspect: true }),
  closure("r1", 18, { suspect: true }), closure("r1", 6),
  ...Array.from({ length: 40 }, (_, i) => stored(`live${i}`, 20)),
  `INSERT INTO public.job_board_company_snapshots VALUES ('R', current_date - 30, 100);`,
  // G: ten roles down once, and four postings each re-listed under the same
  // title three times. As events that is 12 re-lists against 10 fills; as
  // roles it is 4 against 10.
  ...Array.from({ length: 10 }, (_, i) => closure(`f${i}`, 12).replace(/'R:/g, "'G:").replace(/'R',/g, "'G',")),
  ...Array.from({ length: 4 }, (_, i) => [20, 14, 8].map((d) => closure(`s${i}`, d, { superseded: true }).replace(/'R:/g, "'G:").replace(/'R',/g, "'G',"))).flat(),
  `INSERT INTO public.job_board_board_observability (company_token, bucket) VALUES ('R', 'full_read');`,
  `INSERT INTO public.job_board_board_watch (company_token, first_observed_on, first_observed_basis) VALUES ('R', current_date - 80, 'company_snapshot');`,
].join("\n");

let db: PGlite;
let row: Record<string, unknown>;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SEEN_AGAIN_SCHEMA);
  await db.exec(FIXTURE);
  await db.exec(readFileSync(resolve(DIR, NEW_COMPANY), "utf8"));
  row = (await db.query<Record<string, unknown>>(`SELECT * FROM public.get_company_fill_curve(ARRAY['R', 'NOBODY'])`)).rows
    .find((r) => r.company_token === "R")!;
});

afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("get_company_fill_curve counts roles beside its events", () => {
  it("still names its event counts for what they are: every non-doubted closure, re-closures included", () => {
    expect(row.fills_90d).toBe(5 + 6 + 2 + 1);
    expect(row.relists_90d).toBe(2);
  });

  it("counts a role taken down for good once, and never one that closed twice or is serving again", () => {
    expect(row.filled_roles_90d).toBe(6);
  });

  it("counts every role that came back as one re-listed role", () => {
    expect(row.relisted_roles_90d).toBe(7);
  });

  it("can move an employer either way: twelve re-list events against ten fills are four re-listed roles against ten", async () => {
    // The deploy note said no employer gains the verdict from this change.
    // One that re-lists the same postings repeatedly does: the event counts
    // read 12 re-lists over 10 fills, the role counts 4 re-listed roles under
    // 10 filled ones.
    const g = (await db.query<Record<string, unknown>>(`SELECT * FROM public.get_company_fill_curve(ARRAY['G'])`)).rows[0];
    expect([g.fills_90d, g.relists_90d]).toEqual([10, 12]);
    expect([g.filled_roles_90d, g.relisted_roles_90d]).toEqual([10, 4]);
  });

  it("answers zero, not null, for a token it holds nothing for", async () => {
    const nobody = (await db.query<Record<string, unknown>>(`SELECT * FROM public.get_company_fill_curve(ARRAY['NOBODY'])`)).rows[0];
    expect(nobody.filled_roles_90d).toBe(0);
    expect(nobody.relisted_roles_90d).toBe(0);
  });

  it("is still executable by the publishable key's roles and by nobody else through PUBLIC", async () => {
    const acl = (await db.query<{ anon: boolean; authed: boolean; pub: boolean }>(`
      SELECT has_function_privilege('anon', 'public.get_company_fill_curve(text[])', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.get_company_fill_curve(text[])', 'EXECUTE') AS authed,
             EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                      WHERE p.oid = 'public.get_company_fill_curve(text[])'::regprocedure AND a.grantee = 0) AS pub`)).rows[0];
    expect(acl).toEqual({ anon: true, authed: true, pub: false });
  });
});
