// @vitest-environment node
/**
 * THE REPAIR TOUCHES EXACTLY THE ROWS THE NORMALIZER STOPS CALLING REMOTE, AND
 * WRITES NOTHING BUT NULL.
 *
 * WHY THERE IS A MIGRATION AT ALL, STATED CORRECTLY. An earlier version of this
 * header said the bundle could not clear a single one of the 35 false remotes
 * by itself, because the corrections path writes work_mode through a helper
 * that refuses a null. That was half the path: the branch that fires when a
 * posting's remote BOOLEAN moves re-writes the re-normalised work mode WITH its
 * nulls, and every one of the 35 moves that boolean from true to false on its
 * board's next visit. So the bundle DOES clear them, a lap at a time, and this
 * migration is an accelerator plus a reach extension — it takes them off the
 * board now instead of over a rotation, and it reaches the rows no lap does
 * (dormant boards, failing boards, rows past a board's per-pass fetch cap).
 * That is worth having and it is not the same claim, so the file says the
 * smaller true thing rather than the larger false one.
 *
 * WHAT IT MUST NEVER DO is state a mode. SQL cannot see the vendor's own remote
 * flag, so a title-derived on-site written by the repair could contradict a
 * payload whose structured field says remote — "removing a claim" turning into
 * "stating a mode", which is the one direction the trinary-or-nothing rule
 * forbids outright. The write is therefore NULL only, and the third block below
 * proves it on rows whose own titles DO state on-site and hybrid, which is the
 * state the defect would live in.
 *
 * WHY pglite AND NOT A REGEX OVER THE FILE. Its sibling guard,
 * a-head-office-is-a-building-not-a-work-from-home-policy, proves the
 * TypeScript half behaviourally. A text guard over the SQL could only pin
 * SPELLINGS — that a source name appears, that a residue test appears — and
 * this repo has a documented history of guards passing while the code they
 * describe is dead, including a keyset cursor that was null on every response
 * for five days under a guard asserting the identifier it read from. So the
 * migration is applied to a real Postgres over the minimum shape of the table
 * it writes, seeded with the census rows AS THE BOARD STORES THEM.
 *
 * THE SEED IS REAL. 39 postings from fixtures/paylocity-home-office-census.json
 * in their stored form, plus control rows whose location strings are live
 * values from the same audit, with the vendor's own answer recorded beside each
 * one in CONTROLS below, plus two rows constructed to put a mode-stating word
 * in the place the repair would have written one from.
 *
 * TEETH. Every predicate is deleted from the migration text before it is
 * applied, and the mutated database must give a DIFFERENT answer, naming the
 * row that moves. A predicate that can be removed without changing any answer
 * was never doing anything, and no regex over the file can tell you that. The
 * NULL-only write has teeth of the same kind in the other direction: the
 * mutation RESTORES the title-derived CASE the review removed and the file must
 * go red.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  HOME_OFFICE_TOKEN_SOURCE,
  SITE_LABEL_NUMBER_SOURCE,
  SITE_LABEL_WORD_SOURCE,
  isHomeOfficeSiteLabel,
  normalizePaylocity,
} from "../../supabase/functions/job-board/normalize";

// PGLITE BOOTS A POSTGRES AND REPLAYS SQL, SO ITS HOOK IS NOT A UNIT TEST. The
// default 10s hook / 5s test budgets came due on 2026-09-27 for two other
// pglite files in this directory; the boot cost is not constant and only rises.
// Eleven files carry this block for that reason.
vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const REPAIR = "20260927113742";
const migSql = (prefix: string): string => {
  const f = readdirSync(MIGRATIONS).find((x) => x.startsWith(prefix) && x.endsWith(".sql"));
  if (!f) throw new Error(`no migration starts with ${prefix}`);
  return readFileSync(resolve(MIGRATIONS, f), "utf8");
};

/**
 * The minimum shape of the ONE table this repair reads and writes, and nothing
 * else. Booting the whole migration set would make this slow and would stop
 * telling us anything about THIS file; a column the repair starts reading that
 * is not here fails loudly at apply time — which is also how this file would
 * notice the field-change-log arm coming back.
 */
const TABLES = `
  CREATE TABLE public.job_board_postings (
    id         text PRIMARY KEY,
    source     text NOT NULL,
    title      text NOT NULL,
    location   text NOT NULL DEFAULT '',
    department text,
    work_mode  text,
    remote     boolean NOT NULL DEFAULT false
  );
`;

interface CensusRow {
  token: string;
  company: string;
  item: Record<string, unknown> & {
    JobTitle: string;
    LocationName: string;
    JobLocation: { City: string | null; State: string | null } | null;
  };
  stored: {
    id: string; location: string; work_mode: string | null; remote: boolean;
    country: string | null; title: string; department: string | null;
  };
}

const CENSUS: CensusRow[] = (
  JSON.parse(
    readFileSync(resolve(__dirname, "fixtures/paylocity-home-office-census.json"), "utf8"),
  ) as { rows: CensusRow[] }
).rows;

interface Seed {
  id: string; source: string; title: string; location: string;
  department?: string | null; work_mode?: string | null; remote?: boolean;
}

/** The census as the board holds it today: the site label still in `location`. */
const STORED: Seed[] = CENSUS.map((r) => ({
  id: r.stored.id,
  source: "paylocity",
  title: r.stored.title,
  location: r.stored.location,
  department: r.stored.department,
  work_mode: "remote",
  remote: true,
}));

/**
 * THE ROWS THE REPAIR COULD HAVE STATED A MODE ON. Both are the census shape —
 * paylocity, a head-office site label in `location`, a stored remote the
 * vendor's own flag does not support — with one addition: the title carries a
 * mode-stating word. An earlier draft's write took that word and published it,
 * which is a CROSS-RUNTIME disagreement in the worst direction (SQL cannot see
 * the vendor's remote flag, so the on-site it writes can contradict a payload
 * that says remote). Nothing seeded before these two had a mode-bearing title,
 * so both arms of that write were unreachable in this file and its own
 * "writes nothing but NULL" assertion could not fail.
 */
const MODE_BEARING: ReadonlyArray<Seed & { why: string }> = [
  {
    id: "paylocity:11111111-2222-3333-4444-555555555555:ONSITE-TITLE",
    source: "paylocity",
    title: "In-Office Technical Support Representative",
    location: "Home Office",
    department: null,
    work_mode: "remote",
    remote: true,
    why: "a title stating on-site: the repair must still write NULL, not the title's word",
  },
  {
    id: "paylocity:66666666-7777-8888-9999-000000000000:HYBRID-TITLE",
    source: "paylocity",
    title: "Claims Analyst (Hybrid)",
    location: "1000-Home Office",
    department: null,
    work_mode: "remote",
    remote: true,
    why: "a title stating hybrid: same rule, other arm",
  },
];

/**
 * ROWS THAT MUST SURVIVE UNTOUCHED. Every location string is a live value from
 * the audit, with the vendor's own answer in the comment. The two German bare
 * labels are the reason the source fence exists rather than being decoration:
 * the residue rule DOES read them as site names, and on those employers the
 * word is the statement.
 */
const CONTROLS: ReadonlyArray<Seed & { why: string }> = [
  { id: "workday:dsvgruppe~wd103~DSV:JR100885", source: "workday", title: "IT-Consultant Revision(m/w/d)",
    location: "Home Office", work_mode: "remote", remote: true,
    why: "a German employer's bare label — the residue rule reads it as a site name and the source fence is what spares it" },
  { id: "personio:mlgruppe:2802886", source: "personio", title: "Spezialist für Website Relaunch & Marketing",
    location: "Home Office", work_mode: "remote", remote: true,
    why: "same shape, second vendor" },
  { id: "ashby:delinea:f62e9a53-3230-4950-a875-295baacf2d3b", source: "ashby", title: "Technical Support Engineer II",
    location: "Home Office (Belfast)", work_mode: "remote", remote: true,
    why: "ashby workplaceType Remote, isRemote true" },
  { id: "workday:usaa~wd1~USAAJOBSWD:R0118701-1", source: "workday", title: "Capital Markets Analyst (Mid-Level)",
    location: "San Antonio Home Office I", work_mode: "remote", remote: true,
    why: "the Workday ordinal class: a real defect, a different build, and out of scope by source AND by residue" },
  { id: "recruitee:powerprozesse:1", source: "recruitee", title: "Berater Prozessmanagement",
    location: "Homeoffice", work_mode: "remote", remote: true,
    why: "the one-word German spelling: 51 of 51 confirmed remote by the vendor's own boolean" },
  { id: "paylocity:5a397474-6ac8-465f-a18b-39088126ada4:HYBRID-1", source: "paylocity", title: "Estimator",
    location: "Home Office", work_mode: "hybrid", remote: false,
    why: "already carries a stated mode; the repair only rewrites the remote enum" },
  { id: "paylocity:cb387878-51da-4aa4-b82f-cc136e5dbaf5:VENDORFLAG-1", source: "paylocity",
    title: "Client Services Representative II", location: "Overland Park, KS", work_mode: "remote", remote: true,
    why: "the shape of a row stored remote from the vendor's own flag: a real place and no token, so nothing here can reach it" },
];

/**
 * THE HEAD-OFFICE TOKEN IN THE DEPARTMENT, which is where the fix had a hole
 * exactly the shape of the defect. An employer whose site labels read as
 * head-office departments names departments the same way, and the department
 * string reached the detector untouched — so the module answered remote while
 * the location yielded correctly, and the repair's own evidence string spared
 * the row for "stating remote in its own words". Both runtimes now mask that
 * column. Live rows of this shape: 0 of 3,646 sampled across 30 boards, so this
 * closes a latent divergence rather than repairing a live population.
 */
const DEPT_TOKEN: Seed = {
  id: "paylocity:aaaa1111-bbbb-2222-cccc-333333333333:DEPT-TOKEN-1",
  source: "paylocity",
  title: "Mail Clerk",
  location: "Home Office",
  department: "Home Office Services",
  work_mode: "remote",
  remote: true,
};

const SEEDS: Seed[] = [...STORED, ...MODE_BEARING, ...CONTROLS, DEPT_TOKEN];

interface Mutation { find: string; replace: string }

async function boot(...mutations: Mutation[]): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(TABLES);
  for (const s of SEEDS) {
    await db.query(
      `INSERT INTO public.job_board_postings (id, source, title, location, department, work_mode, remote)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [s.id, s.source, s.title, s.location, s.department ?? null, s.work_mode ?? null, s.remote ?? false],
    );
  }
  let sql = migSql(REPAIR);
  for (const mutate of mutations) {
    expect(
      sql.includes(mutate.find),
      `the repair no longer contains ${JSON.stringify(mutate.find)} — the mutation proves nothing`,
    ).toBe(true);
    sql = sql.split(mutate.find).join(mutate.replace);
  }
  await db.exec(sql);
  return db;
}

/** The residue test and the own-words test, as they sit INSIDE the locking
 *  select, and the pair moved back OUT of it — the shape this file had before
 *  review, where a batch could fill with rows the update would not change. */
const RESIDUE_IN_SELECT = `         AND btrim(regexp_replace(regexp_replace(p.location, v_ho, ' ', 'gi'),
                                  '[^[:alnum:]]+', ' ', 'g'))
             ~* ('^$|' || v_num || '|' || v_site)`;
const OWN_WORDS_IN_SELECT = `         AND regexp_replace(
               p.title || ' · ' || COALESCE(regexp_replace(p.department, v_ho, ' ', 'gi'), ''),
               v_neg, ' ', 'gi') !~* v_pos`;
const BOTH_AFTER_THE_LOCK = `     WHERE t.id = l.id
       AND btrim(regexp_replace(regexp_replace(t.location, v_ho, ' ', 'gi'),
                                '[^[:alnum:]]+', ' ', 'g'))
           ~* ('^$|' || v_num || '|' || v_site)
       AND regexp_replace(
             t.title || ' · ' || COALESCE(regexp_replace(t.department, v_ho, ' ', 'gi'), ''),
             v_neg, ' ', 'gi') !~* v_pos;`;

/** Ids the repair cleared, i.e. left with no work mode. */
const clearedIds = async (db: PGlite): Promise<string[]> =>
  (await db.query<{ id: string }>(
    "SELECT id FROM public.job_board_postings WHERE work_mode IS NULL ORDER BY id",
  )).rows.map((r) => r.id);

const modeOf = async (db: PGlite, id: string) =>
  (await db.query<{ work_mode: string | null; remote: boolean }>(
    "SELECT work_mode, remote FROM public.job_board_postings WHERE id = $1", [id],
  )).rows[0];

/** What the FIXED normalizer computes for a census posting — the other runtime. */
const normalizerMode = (r: CensusRow): string | null =>
  normalizePaylocity([r.item] as never, r.company, r.token)[0].workMode ?? null;

let db: PGlite;
beforeAll(async () => { db = await boot(); });
afterAll(async () => { await db?.close(); });

describe("the two runtimes agree on which stored rows were wrong", () => {
  it("clears exactly the census rows the normalizer stops calling remote AND this rule reads", async () => {
    // THE SET SPLIT ON 2026-09-30 AND THIS FILE ONLY OWNS HALF OF IT. The
    // normalizer now stops calling 37 of the 39 remote, not 35: a sibling
    // migration (20260930202400) reads the SUFFIX grammar this file's residue
    // rule declines — "Bozeman, MT - Home Office", the shape whose own header
    // paragraph says it is deliberately untouched — and its own guard proves
    // that half. So the parity asserted here is the one this file can keep:
    // every row the module stops calling remote AND whose label this rule
    // reads, and no other.
    const stops = CENSUS.filter((r) => normalizerMode(r) === null);
    expect(stops, "the module's silent set moved; re-read both repairs").toHaveLength(37);
    const mine = stops.filter((r) => isHomeOfficeSiteLabel(r.stored.location)).map((r) => r.stored.id);
    // The measured figure, stated so a silent drift in either direction fails
    // rather than quietly re-agreeing on a different number.
    expect(mine).toHaveLength(35);
    const cleared = await clearedIds(db);
    const censusCleared = cleared.filter((id) => CENSUS.some((r) => r.stored.id === id));
    expect(censusCleared.sort()).toEqual([...mine].sort());
  });

  it("does not reach the suffix rows, which is why the sibling migration exists", async () => {
    // TEETH FOR THE SPLIT ABOVE. If this file ever started clearing them, the
    // residue rule would have been widened into the gate the audit refuted and
    // the sibling would be dead code nobody noticed.
    const bozeman = CENSUS.filter((r) => /Bozeman/.test(r.item.LocationName));
    expect(bozeman).toHaveLength(2);
    for (const r of bozeman) {
      expect(normalizerMode(r), `${r.stored.id} is still a false remote in the module`).toBeNull();
      expect((await modeOf(db, r.stored.id)).work_mode, `${r.stored.id} was cleared by the wrong file`)
        .toBe("remote");
    }
  });

  it("clears the boolean with the enum, so the badge and the filter cannot disagree", async () => {
    const wrong = (await db.query<{ id: string }>(
      "SELECT id FROM public.job_board_postings WHERE remote <> (work_mode = 'remote')",
    )).rows;
    expect(wrong).toEqual([]);
  });

  it("leaves the posting that states remote in its own title", async () => {
    const stated = CENSUS.find((r) => /prime remote/i.test(r.item.JobTitle))!;
    expect(normalizerMode(stated)).toBe("remote");
    expect(await modeOf(db, stated.stored.id)).toEqual({ work_mode: "remote", remote: true });
  });

  it("leaves the rows a human, not a building, made remote", async () => {
    const kept = CENSUS.filter((r) => normalizerMode(r) === "remote");
    // Two, since 2026-09-30: the sentence offering the applicant their choice
    // of home office, and the posting whose own title says Prime Remote. The
    // two Montana rows left this set when the suffix rule shipped — they are
    // still remote in the database here, and the case above says so.
    expect(kept).toHaveLength(2);
    for (const r of kept) {
      expect((await modeOf(db, r.stored.id)).work_mode, `${r.stored.id} was demoted`).toBe("remote");
    }
  });

  it.each(CONTROLS.map((c) => [c.why, c.id, c.work_mode] as const))(
    "does not touch %s", async (_why, id, mode) => {
      expect((await modeOf(db, id)).work_mode).toBe(mode);
    },
  );
});

describe("the repair writes nothing but NULL", () => {
  /**
   * THE RULE THE WHOLE BUILD RUNS UNDER, asserted on rows that could actually
   * break it. `work_mode IN (…)` over the seeded set was green before these two
   * rows existed because nothing seeded carried a mode-stating title, so the
   * arms that could have written one were never reached.
   */
  it("writes NULL on a row whose own title states on-site, not the title's word", async () => {
    const row = await modeOf(db, MODE_BEARING[0].id);
    expect(row, "the on-site-title row is missing from the seed").toBeTruthy();
    expect(row.work_mode, "the repair stated a mode from the posting's title").toBeNull();
    expect(row.remote).toBe(false);
  });

  it("writes NULL on a row whose own title states hybrid", async () => {
    const row = await modeOf(db, MODE_BEARING[1].id);
    expect(row.work_mode).toBeNull();
    expect(row.remote).toBe(false);
  });

  it("leaves no row in the whole table carrying a mode this file could have invented", async () => {
    const invented = (await db.query<{ id: string; work_mode: string }>(
      `SELECT id, work_mode FROM public.job_board_postings
        WHERE work_mode IN ('onsite','hybrid') AND id <> $1`,
      ["paylocity:5a397474-6ac8-465f-a18b-39088126ada4:HYBRID-1"],
    )).rows;
    expect(invented, "only the seeded control may carry a non-remote stated mode").toEqual([]);
  });

  it("clears the row whose head-office token sits in the department, not the location", async () => {
    // Unmasked, the department's own "Home Office" reads as the POSTING stating
    // remote and the own-words test spares the row — a false remote the module
    // has already stopped producing, kept alive by the repair.
    const row = await modeOf(db, DEPT_TOKEN.id);
    expect(row.work_mode, "the dept-token row kept its false remote").toBeNull();
    expect(row.remote).toBe(false);
  });

  it("agrees with the normalizer that the on-site title is the normalizer's to state, not SQL's", () => {
    // The division of labour, made explicit: the repair subtracts, the module
    // states. Re-normalising the same posting DOES answer on-site from the
    // title, and the next lap writes that freely — which is exactly why SQL
    // does not need to and must not.
    const [job] = normalizePaylocity(
      [{
        JobId: "ONSITE-TITLE",
        JobTitle: MODE_BEARING[0].title,
        LocationName: MODE_BEARING[0].location,
        IsRemote: false,
        JobLocation: { City: "Peoria", State: "IL", Country: "USA" },
      }] as never,
      "Employer",
      "11111111-2222-3333-4444-555555555555",
    );
    expect(job.workMode).toBe("onsite");
    expect(job.location).toBe("Peoria, IL");
  });
});

describe("the SQL rule and the TypeScript rule are the same rule", () => {
  /**
   * CROSS-RUNTIME, because the two live in different languages and drift
   * silently — and here the migration is the half that takes the falsehood off
   * the board while the module is the half that keeps it off. Postgres ARE to
   * JavaScript: [[:space:]] is \s, and \m / \M are start- and end-of-word,
   * where \b is exactly equivalent because every anchor in these patterns sits
   * against a word character.
   *
   * BOTH HALVES ARE ASSERTED, and the behavioural one alone was not enough: a
   * word added to one side and not the other passed this file, because no
   * string in the census or the hand-listed set contained it. So the translated
   * SQL constants are compared to the module's EXPORTED sources directly, and
   * the behavioural walk stays because it is what catches a translation error
   * the equality cannot see.
   */
  const sql = migSql(REPAIR);
  const grab = (name: string): string => {
    const copies = [...sql.matchAll(
      new RegExp(`${name}\\s+constant text := \\$re\\$([\\s\\S]*?)\\$re\\$;`, "g"),
    )].map((m) => m[1]);
    expect(copies.length, `${name} is not declared in the repair`).toBeGreaterThan(0);
    expect(new Set(copies).size, `${name} is declared with two different bodies`).toBe(1);
    // [[:space:]] is \s — the WHOLE bracket expression, or the translation
    // leaves a redundant [\s] that behaves identically and compares unequal.
    return copies[0]
      .replace(/\[\[:space:\]\]/g, "\\s")
      .replace(/\\m/g, "\\b")
      .replace(/\\M/g, "\\b");
  };

  it("declares the same three sources the module exports", () => {
    // The only difference the two runtimes are allowed is the non-capturing
    // group marker, which Postgres ARE does not have.
    expect(grab("v_ho"), "the head-office token drifted between the two runtimes").toBe(HOME_OFFICE_TOKEN_SOURCE);
    expect(grab("v_site"), "the site-label word list drifted between the two runtimes")
      .toBe(SITE_LABEL_WORD_SOURCE.replace("(?:", "("));
    expect(grab("v_num"), "the cost-centre number rule drifted between the two runtimes").toBe(SITE_LABEL_NUMBER_SOURCE);
  });

  /** The repair's residue rule, rebuilt from ITS OWN constants. */
  const sqlIsSiteLabel = (s: string): boolean => {
    const ho = new RegExp(grab("v_ho"), "gi");
    if (!new RegExp(grab("v_ho"), "i").test(s)) return false;
    const residue = s.replace(ho, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return new RegExp(`^$|${grab("v_num")}|${grab("v_site")}`, "i").test(residue);
  };

  it("classifies every location in the census the same way in both runtimes", () => {
    for (const r of CENSUS) {
      const s = r.stored.location;
      expect(sqlIsSiteLabel(s), `the two runtimes disagree on ${JSON.stringify(s)}`)
        .toBe(isHomeOfficeSiteLabel(s));
    }
    // And the classification is not vacuously "no" on all of them.
    expect(CENSUS.filter((r) => sqlIsSiteLabel(r.stored.location))).toHaveLength(36);
  });

  it.each([
    "Home Office (Belfast)", "Palo Alto Home Office", "TX Home Office", "Home Office (CT)",
    "Homeoffice", "San Antonio Home Office I", "8775 Silver Spring MD Home Office",
    "FL - Home Office", "Home Office, Columbus, OH, US", "Bozeman, MT - Home Office",
  ])("agrees in both runtimes that %s is not a site label", (s) => {
    expect(sqlIsSiteLabel(s)).toBe(false);
    expect(isHomeOfficeSiteLabel(s)).toBe(false);
  });

  it.each([
    "Home Office", "1000-Home Office", "HOME OFFICE DEPARTMENTS",
    "Property Management, Inc. Home Office", "Home Office-Harold Grinspoon Foundation",
    // The unanchored entity arm, in both runtimes: a place is left AND an
    // entity word is left, and the rule answers yes. Decided, not accidental —
    // two of the five above put the entity word inside a company name.
    "Bozeman, MT - Home Office Inc",
  ])("agrees in both runtimes that %s IS a site label", (s) => {
    expect(sqlIsSiteLabel(s)).toBe(true);
    expect(isHomeOfficeSiteLabel(s)).toBe(true);
  });

  it("reads a cost-centre number only when nothing else is left", () => {
    // The number arm is the one a dropped anchor would silently widen, and a
    // widened arm would take the facility-numbered Workday rows with it.
    expect(sqlIsSiteLabel("1000-Home Office")).toBe(true);
    expect(sqlIsSiteLabel("8775 Silver Spring MD Home Office")).toBe(false);
    expect(sqlIsSiteLabel("12-Home Office")).toBe(false);
  });
});

/**
 * TEETH. Each case removes ONE predicate and names the row that then moves.
 * The state each mutation is broken in is the state the defect lives in: the
 * rows are seeded exactly as the board holds them.
 */
describe("every predicate in the repair changes an answer", () => {
  it("without the source fence, two German postings lose their employer's word", async () => {
    const mutated = await boot({ find: "AND p.source = v_src", replace: "AND true" });
    try {
      for (const id of ["workday:dsvgruppe~wd103~DSV:JR100885", "personio:mlgruppe:2802886"]) {
        expect((await modeOf(mutated, id)).work_mode, `${id} survived the mutation`).toBeNull();
      }
      // And the fence is the ONLY thing sparing them: their residue is empty,
      // exactly like the Paylocity rows.
      expect((await modeOf(db, "workday:dsvgruppe~wd103~DSV:JR100885")).work_mode).toBe("remote");
    } finally { await mutated.close(); }
  });

  it("without the residue test, a Montana city beside the token is demoted", async () => {
    const mutated = await boot({ find: RESIDUE_IN_SELECT, replace: "         AND true" });
    try {
      const bozeman = CENSUS.filter((r) => /Bozeman/.test(r.item.LocationName));
      expect(bozeman).toHaveLength(2);
      for (const r of bozeman) {
        expect((await modeOf(mutated, r.stored.id)).work_mode, `${r.stored.id} survived`).toBeNull();
        expect((await modeOf(db, r.stored.id)).work_mode).toBe("remote");
      }
    } finally { await mutated.close(); }
  });

  it("without the posting's-own-words test, a stated remote is deleted", async () => {
    const mutated = await boot({ find: OWN_WORDS_IN_SELECT, replace: "         AND true" });
    try {
      const stated = CENSUS.find((r) => /prime remote/i.test(r.item.JobTitle))!;
      expect((await modeOf(mutated, stated.stored.id)).work_mode).toBeNull();
      expect((await modeOf(db, stated.stored.id)).work_mode).toBe("remote");
    } finally { await mutated.close(); }
  });

  it("without masking the head-office token out of the department, the dept-token row is spared", async () => {
    // The two runtimes have to read that column the same way. Unmasked, the
    // department's own "Home Office" reads as the posting stating remote, and
    // the row keeps a false remote the module has already stopped producing.
    const mutated = await boot({
      find: "COALESCE(regexp_replace(p.department, v_ho, ' ', 'gi'), '')",
      replace: "COALESCE(p.department, '')",
    });
    try {
      const id = "paylocity:aaaa1111-bbbb-2222-cccc-333333333333:DEPT-TOKEN-1";
      expect((await modeOf(mutated, id)).work_mode, "the mask is doing nothing").toBe("remote");
      expect((await modeOf(db, id)).work_mode, "the masked read did not reach the row").toBeNull();
    } finally { await mutated.close(); }
  });

  it("goes red if the title-derived mode write is put back", async () => {
    // The mutation the review removed, restored: the repair states a mode from
    // the posting's own title. Both arms are reachable now, so both fail.
    const mutated = await boot({
      find: "SET work_mode = NULL,",
      replace: "SET work_mode = CASE WHEN t.title ~* $q$\\mhybrid\\M$q$ THEN 'hybrid' "
        + "WHEN t.title ~* $q$\\min-?office\\M$q$ THEN 'onsite' ELSE NULL END,",
    });
    try {
      expect((await modeOf(mutated, MODE_BEARING[0].id)).work_mode).toBe("onsite");
      expect((await modeOf(mutated, MODE_BEARING[1].id)).work_mode).toBe("hybrid");
      // And the shipped file states neither.
      expect((await modeOf(db, MODE_BEARING[0].id)).work_mode).toBeNull();
      expect((await modeOf(db, MODE_BEARING[1].id)).work_mode).toBeNull();
    } finally { await mutated.close(); }
  });

  it("cannot end a batch early on rows it does not change", async () => {
    // THE SHAPE THIS FILE HAD BEFORE REVIEW, restored: the driving select took a
    // batch of every row carrying the token and only the qualifying subset was
    // updated afterwards. The loop exits on a zero ROW_COUNT, so the first batch
    // that happened to hold only non-qualifying rows ended the repair and the
    // notice reported the partial total as if it were the whole job. With the
    // batch shrunk so that can actually happen, the old shape leaves a residue
    // and the shipped shape does not.
    const mutated = await boot(
      { find: RESIDUE_IN_SELECT, replace: "         AND true" },
      { find: OWN_WORDS_IN_SELECT, replace: "         AND true" },
      { find: "     WHERE t.id = l.id;", replace: BOTH_AFTER_THE_LOCK },
      { find: "v_batch       constant integer := 2000;", replace: "v_batch       constant integer := 2;" },
    );
    try {
      const left = await clearedIds(mutated);
      const shipped = await clearedIds(db);
      expect(
        left.length,
        "the post-filter shape cleared as much as the fenced one — the batch is no longer small enough for a non-qualifying pair to end the loop, so this case proves nothing",
      ).toBeLessThan(shipped.length);
      // And the same tiny batch under the SHIPPED shape clears everything, so the
      // residue above is the early exit and not the batch size.
      const small = await boot({ find: "v_batch       constant integer := 2000;", replace: "v_batch       constant integer := 2;" });
      try {
        expect((await clearedIds(small)).sort()).toEqual(shipped.sort());
      } finally { await small.close(); }
    } finally { await mutated.close(); }
  });

  it("is a no-op the second time it runs", async () => {
    // Idempotence is how a row skipped for being locked is ever picked up, so
    // it is a property and not a nicety.
    const before = await clearedIds(db);
    await db.exec(migSql(REPAIR));
    expect(await clearedIds(db)).toEqual(before);
  });
});
