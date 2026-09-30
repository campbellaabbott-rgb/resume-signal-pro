// @vitest-environment node
/**
 * THE SUFFIX REPAIR TOUCHES EXACTLY THE ROWS THE NORMALIZER STOPS CALLING
 * REMOTE, AND WRITES NOTHING BUT NULL.
 *
 * WHAT WAS LEFT, AND FOR HOW LONG. The first repair (20260927113742) clears a
 * head-office label only when removing the token leaves nothing, a bare
 * cost-centre number, or an organisation/department word. Its own header names
 * the rows it declines — "the two rows reading as a Montana city beside the
 * token" — and those two went on publishing a false work-from-home claim at a
 * ranch-supply store for three days after it applied. A Front End Operations
 * Specialist is not a remote role.
 *
 * WHY THE FIRST FILE WAS RIGHT TO DECLINE THEM. A place beside the token was
 * REFUTED as evidence of a building: Ashby answers workplaceType Remote on
 * "Home Office (Belfast)" and on "Palo Alto Home Office", and of the Workday
 * rows in the jurisdiction class that carry a structured remote type, 20 of 24
 * say Remote. Nothing here overturns that, no word is added to the site-label
 * list, and MUST_NOT below re-runs the whole refuted set against the new rule.
 *
 * WHAT SETTLED THEM, MEASURED 2026-09-30 by reading the employer's WHOLE board
 * instead of its two wrong rows. Ranch and Home Supply publishes 89 postings
 * and writes LocationName as "City, ST" optionally followed by " - <site>":
 * "Bozeman, MT - Home Office" (4), "Bozeman, MT - Four Corners" (3), "Butte,
 * MT - Distribution Center" (2), "Laramie, WY - Distribution Center" (1). The
 * token sits in that employer's SITE slot, beside the City and State the
 * payload states structurally on the same rows. A field does not change
 * meaning between two rows of one site list.
 *
 * THE VENDOR FLAG, WITH THE POSITIVE CONTROL THE FIRST CENSUS DID NOT PRINT.
 * Re-fetched the same day across the 15 tenants of that census: 54 live rows
 * carry the token, IsRemote false on 54 of 54. A flag no employer ever sets is
 * silence, not a refutation — so, measured: 3 of those 15 tenants DO set it
 * true on other postings (6 of 13, 1 of 5, 1 of 4), which makes the field live
 * on this vendor, while THIS employer sets it on none of its 89. The rule
 * therefore rests on the label grammar, and this file says so rather than
 * quoting 54-of-54 as though it settled the row alone.
 *
 * WHY pglite AND NOT A REGEX OVER THE FILE, and why every predicate is mutated:
 * the same reasons its sibling gives. A text guard can only pin spellings, and
 * this repo has shipped guards that passed while the code they described was
 * dead.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  HOME_OFFICE_PLACE_SUFFIX_SOURCE,
  homeOfficePlaceSuffix,
  normalizePaylocity,
} from "../../supabase/functions/job-board/normalize";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 30_000 });

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const RESIDUE_REPAIR = "20260927113742";
const SUFFIX_REPAIR = "20260930202400";
const migSql = (prefix: string): string => {
  const f = readdirSync(MIGRATIONS).find((x) => x.startsWith(prefix) && x.endsWith(".sql"));
  if (!f) throw new Error(`no migration starts with ${prefix}`);
  return readFileSync(resolve(MIGRATIONS, f), "utf8");
};

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

/** The census as the board holds it: the label still in `location`. */
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
 * ROWS THAT MUST SURVIVE. Each one isolates a single fence, so a fence that
 * stops doing anything is a named failure and not a silently unchanged count.
 */
const CONTROLS: ReadonlyArray<Seed & { why: string }> = [
  { id: "adp:acme:SUFFIX-WRONG-VENDOR", source: "adp", title: "Staff Accountant",
    location: "Bozeman, MT - Home Office", work_mode: "remote", remote: true,
    why: "the identical string on another vendor: the census behind this rule is one vendor's" },
  { id: "paylocity:fe274438-11df-4742-b18e-18a43cb5c6b7:REMOTE-PREFIX", source: "paylocity",
    title: "Client Services Representative", location: "Remote, US - Home Office",
    work_mode: "remote", remote: true,
    why: "the place in front of the suffix states remote in its own right" },
  { id: "paylocity:fe274438-11df-4742-b18e-18a43cb5c6b7:TITLE-STATES", source: "paylocity",
    title: "Prime Remote Claims Adjuster", location: "Bozeman, MT - Home Office",
    work_mode: "remote", remote: true,
    why: "the posting's own title states the mode" },
  { id: "ashby:delinea:SUFFIX-BELFAST", source: "ashby", title: "Technical Support Engineer II",
    location: "Home Office (Belfast)", work_mode: "remote", remote: true,
    why: "ashby workplaceType Remote: the refuted gate's headline row" },
  { id: "paylocity:fe274438-11df-4742-b18e-18a43cb5c6b7:NO-TOKEN", source: "paylocity",
    title: "Warehouse Picker", location: "Butte, MT - Distribution Center",
    work_mode: "remote", remote: true,
    why: "the same grammar with a different site name: no token, nothing to read" },
  { id: "paylocity:5a397474-6ac8-465f-a18b-39088126ada4:SUFFIX-HYBRID", source: "paylocity",
    title: "Estimator", location: "Bozeman, MT - Home Office", work_mode: "hybrid", remote: false,
    why: "already carries a stated mode; the repair only rewrites the remote enum" },
];

/** The rows an earlier draft of the sibling repair would have STATED a mode on. */
const MODE_BEARING: ReadonlyArray<Seed & { why: string }> = [
  { id: "paylocity:fe274438-11df-4742-b18e-18a43cb5c6b7:SUFFIX-ONSITE-TITLE", source: "paylocity",
    title: "In-Office Technical Support Representative", location: "Bozeman, MT - Home Office",
    work_mode: "remote", remote: true, why: "an on-site title must still become NULL" },
  { id: "paylocity:fe274438-11df-4742-b18e-18a43cb5c6b7:SUFFIX-HYBRID-TITLE", source: "paylocity",
    title: "Claims Analyst (Hybrid)", location: "Bozeman, MT - Home Office",
    work_mode: "remote", remote: true, why: "same rule, other arm" },
];

/** A head-office DEPARTMENT beside a suffixed label: both runtimes mask it. */
const DEPT_TOKEN: Seed = {
  id: "paylocity:fe274438-11df-4742-b18e-18a43cb5c6b7:SUFFIX-DEPT-TOKEN",
  source: "paylocity", title: "Mail Clerk", location: "Bozeman, MT - Home Office",
  department: "Home Office Services", work_mode: "remote", remote: true,
};

const SEEDS: Seed[] = [...STORED, ...CONTROLS, ...MODE_BEARING, DEPT_TOKEN];

interface Mutation { find: string; replace: string }

/** Both repairs, in deploy order — the state production is actually in. */
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
  await db.exec(migSql(RESIDUE_REPAIR));
  let sql = migSql(SUFFIX_REPAIR);
  for (const mutate of mutations) {
    expect(
      sql.includes(mutate.find),
      `the suffix repair no longer contains ${JSON.stringify(mutate.find)} — the mutation proves nothing`,
    ).toBe(true);
    sql = sql.split(mutate.find).join(mutate.replace);
  }
  await db.exec(sql);
  return db;
}

const SHIPPED_GRAMMAR =
  "$re$^(.+,[[:space:]]*[A-Za-z]{2})[[:space:]]*[-\u2013\u2014][[:space:]]*home[[:space:]]+office[[:space:]]*$$re$";
const PREFIX_TEST = `         AND regexp_replace(regexp_replace(p.location, v_place, '\\1', 'i'),
                            v_neg, ' ', 'gi') !~* v_pos`;
const OWN_WORDS = `         AND regexp_replace(
               p.title || ' · ' || COALESCE(regexp_replace(p.department, v_ho, ' ', 'gi'), ''),
               v_neg, ' ', 'gi') !~* v_pos`;

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
  it("clears the two rows the residue repair declined, and nothing else new", async () => {
    const bozeman = CENSUS.filter((r) => /Bozeman/.test(r.item.LocationName));
    expect(bozeman).toHaveLength(2);
    for (const r of bozeman) {
      expect(normalizerMode(r), `${r.stored.id}: the module still calls it remote`).toBeNull();
      expect((await modeOf(db, r.stored.id)).work_mode, `${r.stored.id} kept its false remote`).toBeNull();
      expect((await modeOf(db, r.stored.id)).remote).toBe(false);
    }
  });

  it("with both repairs applied, the census agrees row for row with the module", async () => {
    const expected = CENSUS.filter((r) => normalizerMode(r) === null).map((r) => r.stored.id);
    expect(expected, "the module's silent set moved; re-read both repairs").toHaveLength(37);
    const cleared = await clearedIds(db);
    const censusCleared = cleared.filter((id) => CENSUS.some((r) => r.stored.id === id));
    expect(censusCleared.sort()).toEqual([...expected].sort());
  });

  it("leaves the two rows a human, not a building, made remote", async () => {
    const kept = CENSUS.filter((r) => normalizerMode(r) === "remote");
    expect(kept).toHaveLength(2);
    // The sentence offering the applicant their choice of home office, and the
    // posting whose own title says Prime Remote.
    expect(new Set(kept.map((r) => r.item.LocationName))).toEqual(new Set([
      "San Jose, Watsonville, or Salinas (the applicant’s choice of home office)",
      "HOME OFFICE",
    ]));
    for (const r of kept) {
      expect((await modeOf(db, r.stored.id)).work_mode, `${r.stored.id} was demoted`).toBe("remote");
    }
  });

  it("clears the boolean with the enum, so the badge and the filter cannot disagree", async () => {
    const wrong = (await db.query<{ id: string }>(
      "SELECT id FROM public.job_board_postings WHERE remote <> (work_mode = 'remote')",
    )).rows;
    expect(wrong).toEqual([]);
  });

  it.each(CONTROLS.map((c) => [c.why, c.id, c.work_mode] as const))(
    "does not touch %s", async (_why, id, mode) => {
      expect((await modeOf(db, id)).work_mode).toBe(mode);
    },
  );
});

describe("the repair writes nothing but NULL", () => {
  it("writes NULL on a suffixed row whose own title states on-site", async () => {
    const row = await modeOf(db, MODE_BEARING[0].id);
    expect(row.work_mode, "the repair stated a mode from the posting's title").toBeNull();
    expect(row.remote).toBe(false);
  });

  it("writes NULL on a suffixed row whose own title states hybrid", async () => {
    expect((await modeOf(db, MODE_BEARING[1].id)).work_mode).toBeNull();
  });

  it("leaves no row carrying a mode this file could have invented", async () => {
    const invented = (await db.query<{ id: string }>(
      `SELECT id FROM public.job_board_postings
        WHERE work_mode IN ('onsite','hybrid') AND id <> $1`,
      ["paylocity:5a397474-6ac8-465f-a18b-39088126ada4:SUFFIX-HYBRID"],
    )).rows;
    expect(invented, "only the seeded control may carry a non-remote stated mode").toEqual([]);
  });

  it("clears the row whose head-office token sits in the department", async () => {
    expect((await modeOf(db, DEPT_TOKEN.id)).work_mode).toBeNull();
  });

  it("agrees with the normalizer that a stated mode is the normalizer's to write", () => {
    const [job] = normalizePaylocity(
      [{
        JobId: "ONSITE-TITLE",
        JobTitle: MODE_BEARING[0].title,
        LocationName: MODE_BEARING[0].location,
        IsRemote: false,
        JobLocation: { City: "Bozeman", State: "MT", Country: "USA" },
      }] as never,
      "Employer",
      "fe274438-11df-4742-b18e-18a43cb5c6b7",
    );
    expect(job.workMode).toBe("onsite");
    expect(job.location).toBe("Bozeman, MT");
  });
});

describe("the SQL rule and the TypeScript rule are the same rule", () => {
  const sql = migSql(SUFFIX_REPAIR);
  const grab = (name: string): string => {
    const copies = [...sql.matchAll(
      new RegExp(`${name}\\s+constant text := \\$re\\$([\\s\\S]*?)\\$re\\$;`, "g"),
    )].map((m) => m[1]);
    expect(copies.length, `${name} is not declared in the repair`).toBeGreaterThan(0);
    expect(new Set(copies).size, `${name} is declared with two different bodies`).toBe(1);
    return copies[0].replace(/\[\[:space:\]\]/g, "\\s").replace(/\\m/g, "\\b").replace(/\\M/g, "\\b");
  };

  it("declares the same suffix grammar the module exports", () => {
    expect(grab("v_place"), "the suffix grammar drifted between the two runtimes")
      .toBe(HOME_OFFICE_PLACE_SUFFIX_SOURCE);
  });

  /** The repair's rule, rebuilt from ITS OWN constant. */
  const sqlSaysSuffix = (s: string): boolean => new RegExp(grab("v_place"), "i").test(s);

  it("classifies every location in the census the same way in both runtimes", () => {
    for (const r of CENSUS) {
      const s = r.stored.location;
      expect(sqlSaysSuffix(s), `the two runtimes disagree on ${JSON.stringify(s)}`)
        .toBe(homeOfficePlaceSuffix(s) !== null);
    }
    // And the classification is not vacuously "no" on all of them.
    expect(CENSUS.filter((r) => sqlSaysSuffix(r.stored.location))).toHaveLength(2);
  });

  /**
   * THE REFUTED SET, re-run against the SQL half. Every string is a live value
   * the first audit's adversarial verifier fetched, with that vendor's own
   * answer beside it; a rule that read any of them as a site name would delete
   * an employer's statement, which is strictly worse than the defect fixed here.
   */
  it.each([
    ["Home Office (Belfast)", "ashby says Remote"],
    ["Palo Alto Home Office", "ashby says Remote"],
    ["TX Home Office", "workday remoteType Remote"],
    ["Home Office (CT)", "workday remoteType Fully Remote"],
    ["Homeoffice", "recruitee remote:true"],
    ["San Antonio Home Office I", "out of scope: workday ordinal class"],
    ["San Antonio Home Office II/III", "out of scope: workday ordinal class"],
    ["8775 Silver Spring MD Home Office", "out of scope: workday facility number"],
    ["FL - Home Office", "workday jurisdiction class, 20 of 24 Remote"],
    ["Home Office - Canada", "workday jurisdiction class"],
    ["Home Office Saudi Arabia", "workday jurisdiction class"],
    ["Home Office, Germany; Bundesweit, Germany", "icims multi-site"],
    ["Home Office, Columbus, OH, US", "adp, city in the string"],
    ["US-CA California Los Angeles/Orange County Home Office", "workday, city in the string"],
    ["Home Office", "the bare label belongs to the residue repair, not this one"],
    ["1000-Home Office", "and so does the cost-centre code"],
  ])("agrees in both runtimes that %s is not a site suffix (%s)", (s) => {
    expect(sqlSaysSuffix(s)).toBe(false);
    expect(homeOfficePlaceSuffix(s)).toBeNull();
  });

  it("splits the one string where the two halves get there differently", () => {
    // "Remote, US - Home Office" IS written in the grammar, and both runtimes
    // spare it — the module inside homeOfficePlaceSuffix, the migration in a
    // separate predicate over the same capture. Asserting it as "not the
    // grammar" would have hidden that the SQL half has a second fence to keep.
    expect(sqlSaysSuffix("Remote, US - Home Office")).toBe(true);
    expect(homeOfficePlaceSuffix("Remote, US - Home Office")).toBeNull();
  });

  it.each([
    "Bozeman, MT - Home Office",
    "Butte, MT - Home Office",
    "bozeman, mt — home office",
  ])("agrees in both runtimes that %s IS a site suffix", (s) => {
    expect(sqlSaysSuffix(s)).toBe(true);
    expect(homeOfficePlaceSuffix(s)).not.toBeNull();
  });

  it("reads the place only when the two-letter code is the last thing before the separator", () => {
    // The arm a dropped comma or a widened code would silently open.
    expect(sqlSaysSuffix("Bozeman MT - Home Office")).toBe(false);
    expect(sqlSaysSuffix("Bozeman, Montana - Home Office")).toBe(false);
    expect(sqlSaysSuffix("Bozeman, MT - Home Office Inc")).toBe(false);
  });
});

/**
 * TEETH. Each case removes ONE predicate and names the row that then moves.
 */
describe("every predicate in the suffix repair changes an answer", () => {
  it("without the source fence, the same string on another vendor is demoted", async () => {
    const mutated = await boot({ find: "AND p.source = v_src", replace: "AND true" });
    try {
      const id = "adp:acme:SUFFIX-WRONG-VENDOR";
      expect((await modeOf(mutated, id)).work_mode, `${id} survived the mutation`).toBeNull();
      expect((await modeOf(db, id)).work_mode).toBe("remote");
    } finally { await mutated.close(); }
  });

  it("with the grammar widened to the refuted presence test, an employer's own sentence is deleted", async () => {
    // THE GATE THE FIRST AUDIT REFUTED, written out as the constant itself: the
    // token anywhere in the field. The row it reaches and the shipped rule does
    // not is the one where a human wrote the policy — "San Jose, Watsonville,
    // or Salinas (the applicant's choice of home office)" — which is the whole
    // reason this rule reads a written shape and not a presence.
    const mutated = await boot({
      find: SHIPPED_GRAMMAR,
      replace: "$re$^(.*)home[[:space:]]+office.*$$re$",
    });
    try {
      const sentence = CENSUS.find((r) => /choice of home office/i.test(r.item.LocationName))!;
      expect(
        (await modeOf(mutated, sentence.stored.id)).work_mode,
        "the widened gate did not reach the sentence — it proves nothing",
      ).toBeNull();
      expect((await modeOf(db, sentence.stored.id)).work_mode).toBe("remote");
      // And the gate is live either way: the rows it is FOR still clear, so the
      // difference above is the shape and not a broken migration.
      for (const r of CENSUS.filter((x) => /Bozeman/.test(x.item.LocationName))) {
        expect((await modeOf(mutated, r.stored.id)).work_mode).toBeNull();
      }
    } finally { await mutated.close(); }
  });

  it("without the prefix test, a place that states remote is demoted", async () => {
    const mutated = await boot({ find: PREFIX_TEST, replace: "         AND true" });
    try {
      const id = "paylocity:fe274438-11df-4742-b18e-18a43cb5c6b7:REMOTE-PREFIX";
      expect((await modeOf(mutated, id)).work_mode, `${id} survived the mutation`).toBeNull();
      expect((await modeOf(db, id)).work_mode).toBe("remote");
    } finally { await mutated.close(); }
  });

  it("without the posting's-own-words test, a stated remote is deleted", async () => {
    const mutated = await boot({ find: OWN_WORDS, replace: "         AND true" });
    try {
      const id = "paylocity:fe274438-11df-4742-b18e-18a43cb5c6b7:TITLE-STATES";
      expect((await modeOf(mutated, id)).work_mode).toBeNull();
      expect((await modeOf(db, id)).work_mode).toBe("remote");
    } finally { await mutated.close(); }
  });

  it("without masking the head-office token out of the department, that row is spared", async () => {
    const mutated = await boot({
      find: "COALESCE(regexp_replace(p.department, v_ho, ' ', 'gi'), '')",
      replace: "COALESCE(p.department, '')",
    });
    try {
      expect((await modeOf(mutated, DEPT_TOKEN.id)).work_mode, "the mask is doing nothing").toBe("remote");
      expect((await modeOf(db, DEPT_TOKEN.id)).work_mode).toBeNull();
    } finally { await mutated.close(); }
  });

  it("goes red if a title-derived mode write is put in", async () => {
    const mutated = await boot({
      find: "SET work_mode = NULL,",
      replace: "SET work_mode = CASE WHEN t.title ~* $q$\\mhybrid\\M$q$ THEN 'hybrid' "
        + "WHEN t.title ~* $q$\\min-?office\\M$q$ THEN 'onsite' ELSE NULL END,",
    });
    try {
      expect((await modeOf(mutated, MODE_BEARING[0].id)).work_mode).toBe("onsite");
      expect((await modeOf(mutated, MODE_BEARING[1].id)).work_mode).toBe("hybrid");
      expect((await modeOf(db, MODE_BEARING[0].id)).work_mode).toBeNull();
      expect((await modeOf(db, MODE_BEARING[1].id)).work_mode).toBeNull();
    } finally { await mutated.close(); }
  });

  it("is a no-op the second time it runs", async () => {
    const before = await clearedIds(db);
    await db.exec(migSql(SUFFIX_REPAIR));
    expect(await clearedIds(db)).toEqual(before);
  });
});
