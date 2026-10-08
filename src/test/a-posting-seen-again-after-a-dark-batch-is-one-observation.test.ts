// @vitest-environment node
/**
 * A POSTING SEEN AGAIN AFTER A DARK BATCH IS ONE OBSERVATION, NOT TWO.
 *
 * A feed that answers short once stamps every stored posting with a suspect
 * closure; the rows are deleted and stored again on the next good read. Both
 * fill-curve estimators censored every doubted row at its instant, so a board
 * that lost its feed for one pass entered the risk set with each of those
 * requisitions twice -- once as the doubted closure, once as whatever really
 * happened to it -- and fill_rate_14, still_open_30 and their intervals moved
 * for a reason that is entirely ours (register 1.28 / L13-12).
 *
 * THE RULE THE OWNER APPROVED: a suspect or dark closure, and the age-out the
 * same bad batch logged, leaves the risk set when the same posting_id was
 * observed after that instant; only an id never seen again stays censored.
 *
 * THE INVARIANCE, EXECUTED. One database, one board process on four tokens
 * (src/test/helpers/seen-again-fixture.ts): A with no failure, B with a
 * stamped suspect batch every posting survived, B2 the same batch caught only
 * by the retroactive dark proxy, C with five postings that exist only in the
 * batch. The definition the database ran until this change must publish B
 * differently from A (the defect); the re-issue must publish B and B2 exactly
 * as A, column for column, and keep C's five never-seen-again ids censored.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SEEN_AGAIN_FIXTURE, SEEN_AGAIN_SCHEMA, VARIANTS } from "./helpers/seen-again-fixture";

vi.setConfig({ hookTimeout: 180_000, testTimeout: 60_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const mig = (f: string) => readFileSync(resolve(DIR, f), "utf8");
const WAS_COMPANY = "20261002121417_a_board_is_judged_at_day_thirty_only_on_roles_posted_while_we_were_reading_it_in_full.sql";
const NEW_COMPANY = "20261008110000_a_role_is_counted_once_and_a_posting_seen_again_never_came_down.sql";
const WAS_CATEGORY = "20261002121843_a_field_pools_only_the_roles_whose_whole_thirty_days_we_could_see.sql";
const NEW_CATEGORY = "20261008110500_a_field_pools_a_posting_seen_again_after_a_dark_batch_once.sql";

type Row = Record<string, unknown>;
const TOKENS = Object.values(VARIANTS).map((v) => v.tok);
const company = async (db: PGlite) =>
  new Map((await db.query<Row>(`SELECT * FROM public.get_company_fill_curve($1::text[])`, [TOKENS])).rows.map((r) => [String(r.company_token), r]));

const category = async (db: PGlite) =>
  new Map((await db.query<Row>(`SELECT * FROM public.get_category_fill_curve(90, 25)`)).rows.map((r) => [String(r.category), r]));

/** Every published column except the token itself and the ones a variant is allowed to differ on. */
const comparable = (r: Row, drop: string[] = []) => {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === "company_token" || k === "category" || drop.includes(k)) continue;
    out[k] = v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v);
  }
  return out;
};

let before: Map<string, Row>;
let after: Map<string, Row>;
let catBefore: Map<string, Row>;
let catAfter: Map<string, Row>;
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SEEN_AGAIN_SCHEMA);
  await db.exec(SEEN_AGAIN_FIXTURE);
  await db.exec(mig(WAS_COMPANY));
  await db.exec(mig(WAS_CATEGORY));
  before = await company(db);
  catBefore = await category(db);
  await db.exec(mig(NEW_COMPANY));
  await db.exec(mig(NEW_CATEGORY));
  after = await company(db);
  catAfter = await category(db);
});

afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

const A = () => VARIANTS.A.tok;
const B = () => VARIANTS.B.tok;
const B2 = () => VARIANTS.B2.tok;
const C = () => VARIANTS.C.tok;

describe("the definition the database ran until this change", () => {
  it("published a board that survived a dark batch differently from the same board without one", () => {
    const a = before.get(A())!;
    const b = before.get(B())!;
    // Each surviving requisition was in the risk set twice.
    expect(Number(b.dated_n)).toBe(Number(a.dated_n) + 55);
    expect(comparable(b)).not.toEqual(comparable(a));
    expect(Number(b.fill_rate_14)).toBeLessThan(Number(a.fill_rate_14));
  });

  it("did the same when only the retroactive dark proxy could see the batch", () => {
    expect(comparable(before.get(B2())!)).not.toEqual(comparable(before.get(A())!));
  });
});

describe("the re-issue", () => {
  it("publishes a board whose postings were all seen again after a suspect batch exactly as the board without it", () => {
    expect(comparable(after.get(B())!)).toEqual(comparable(after.get(A())!));
  });

  it("does the same when the batch was caught by the dark proxy alone", () => {
    expect(comparable(after.get(B2())!)).toEqual(comparable(after.get(A())!));
  });

  it("drops the batch's age-out twins with it: the day-30 risk set and the age-outs at the cap match the clean board", () => {
    const a = after.get(A())!;
    for (const tok of [B(), B2()]) {
      const b = after.get(tok)!;
      expect(b.n_at_risk_30).toEqual(a.n_at_risk_30);
      expect(b.ageouts_at_30).toEqual(a.ageouts_at_30);
      expect(b.n_at_risk_14).toEqual(a.n_at_risk_14);
    }
  });

  it("keeps a posting never seen again censored: five more dated observations, no more events", () => {
    const a = after.get(A())!;
    const c = after.get(C())!;
    expect(Number(c.dated_n)).toBe(Number(a.dated_n) + 5);
    expect(c.fills_90d).toEqual(a.fills_90d);
    expect(c.relists_90d).toEqual(a.relists_90d);
    expect(c.ageouts_90d).toEqual(a.ageouts_90d);
    expect(comparable(c)).not.toEqual(comparable(a));
  });

  it("publishes the never-seen-again board exactly as the old definition did, on every column the old one had", () => {
    const old = comparable(before.get(C())!);
    const now = comparable(after.get(C())!, ["filled_roles_90d", "relisted_roles_90d"]);
    expect(now).toEqual(old);
  });

  it("leaves the clean board's figures where they were", () => {
    expect(comparable(after.get(A())!, ["filled_roles_90d", "relisted_roles_90d"])).toEqual(comparable(before.get(A())!));
  });
});

describe("the field grain", () => {
  const field = (m: Map<string, Row>, v: keyof typeof VARIANTS) => {
    const r = m.get(VARIANTS[v].cat);
    expect(r, `no row for ${VARIANTS[v].cat}`).toBeTruthy();
    return r!;
  };

  it("pooled a field whose postings survived a dark batch differently from the same field without one, until this change", () => {
    expect(comparable(field(catBefore, "B"))).not.toEqual(comparable(field(catBefore, "A")));
    expect(comparable(field(catBefore, "B2"))).not.toEqual(comparable(field(catBefore, "A")));
  });

  it("now pools it exactly as the field without the batch, whichever verdict caught the batch", () => {
    expect(comparable(field(catAfter, "B"))).toEqual(comparable(field(catAfter, "A")));
    expect(comparable(field(catAfter, "B2"))).toEqual(comparable(field(catAfter, "A")));
  });

  it("keeps the never-seen-again postings censored, exactly as before", () => {
    expect(comparable(field(catAfter, "C"))).toEqual(comparable(field(catBefore, "C")));
    expect(comparable(field(catAfter, "C"))).not.toEqual(comparable(field(catAfter, "A")));
  });

  it("agrees with the company grain on the clean board's day-30 share", () => {
    expect(field(catAfter, "A").still_open_30).toEqual(after.get(VARIANTS.A.tok)!.still_open_30);
  });
});
