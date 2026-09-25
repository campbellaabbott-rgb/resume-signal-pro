// @vitest-environment node
/**
 * ONE ROW PER ASKED TOKEN, AND NO ROW IS NEVER A REFUSAL TO SPONSOR.
 *
 * WHAT THIS GUARDS. public.get_employer_lca_wages answers EVERY board token it
 * is handed -- with a row of nulls when nothing qualifies -- so that no client
 * is ever in the position of interpreting a missing row. The interpretation
 * matters more here than it does for a layoff filing: we hold ONE quarter of
 * ONE country's certifications, joined only where an employer name resolves to
 * exactly one board employer. An employer absent from that set may sponsor
 * under another legal name, may have filed in another quarter, may have filed
 * nothing this quarter and plenty last. "No cell" means we have nothing to
 * print, and a surface that turned it into "does not sponsor" would be making
 * a claim about a person's prospects out of our own coverage gap.
 *
 * The shape is the layoff card reader's, deliberately: a LEFT JOIN off a
 * DISTINCT unnest, capped, ordered, with every predicate in SQL.
 *
 * WHY IT IS BEHAVIOURAL. The migrations are applied to a real Postgres
 * (pglite), the writer is called the way the operator calls it, and the reader
 * is asked real questions. A regex over the SQL would pass on a file whose
 * join was rewritten the day after it was written.
 *
 * TEETH. Three mutated copies of the reader are applied to their own database:
 * one whose employer join is inner, one whose nearest-cell join is inner, and
 * one whose token list is not de-duplicated. Each must break exactly the
 * property it removes -- a token that disappears, or a token answered twice --
 * and the sealed original must then answer correctly again.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
/** This lane's migrations, pinned by their stamps and applied in order: the table, the first
 *  writer, the first reader, the coverage columns, the staged swap that replaces the writer, and
 *  the reader that replaces the reader. The LIVE definitions are the last of each, and that is what
 *  the mutations below have to target -- a tooth biting a superseded function proves nothing. */
const WRITER = "20260925150412";
const READER = "20260925150733";
const LANE = ["20260923114532", "20260923114719", "20260923114903", "20260925150221", WRITER, READER];
const migFile = (prefix: string) => {
  const f = readdirSync(MIGRATIONS).find((x) => x.startsWith(prefix) && x.endsWith(".sql"));
  if (!f) throw new Error(`no migration starts with ${prefix}`);
  return resolve(MIGRATIONS, f);
};
const migSql = (prefix: string) => readFileSync(migFile(prefix), "utf8");

interface Period { quarter: string; file: string; published: string; from: string; to: string }

/** The period the payload carries: a label MEASURED from the decision dates the cells were folded
 *  from, not read off the file name. */
const CURRENT: Period = {
  quarter: "FY2026 Q3", file: "LCA_Disclosure_Data_FY2026_Q3.xlsx", published: "2026-08-25",
  from: "2026-04-01", to: "2026-06-30",
};

/** The previous period, for the two-periods case: an older file, an older publication date. */
const PREV: Period = {
  quarter: "FY2026 Q2", file: "LCA_Disclosure_Data_FY2026_Q2.xlsx", published: "2026-05-20",
  from: "2026-01-01", to: "2026-03-31",
};

const CELLS = [
  // An employer with two cells, both above the bar.
  cell("acmewidgets", "15-1252", "CA", "Software Developers", 120000, 145600, 124800, 12),
  cell("acmewidgets", "15-2051", "NY", "Data Scientists", 150000, 160000, 155000, 9),
  // An employer whose total clears the bar but whose every cell is under it.
  cell("thinco", "15-1252", "CA", "Software Developers", 90000, 99000, 95000, 2),
  cell("thinco", "15-1252", "TX", "Software Developers", 88000, 92000, 90000, 2),
  // An employer under the bar in total.
  cell("tinyco", "15-1252", "CA", "Software Developers", 70000, 75000, 72000, 1),
];

function cell(token: string, soc: string, state: string, title: string, low: number, high: number, med: number, n: number, q?: Period) {
  const p = q ?? CURRENT;
  return {
    company_token: token, soc_code: soc, worksite_state: state, soc_title: title,
    wage_low_annual: low, wage_high_annual: high, wage_median_annual: med, filings_n: n,
    source_file: p.file,
    source_url: `https://www.dol.gov/media/${p.file}`,
    fiscal_quarter: p.quarter, published_on: p.published,
    coverage_from: p.from, coverage_to: p.to,
  };
}

type Row = Record<string, unknown>;

/** A database with this lane applied, optionally with one migration's text substituted. */
async function boot(mutate?: { prefix: string; find: string; replace: string }): Promise<PGlite> {
  const db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  for (const p of LANE) {
    let sql = migSql(p);
    if (mutate && p === mutate.prefix) {
      expect(sql.includes(mutate.find), `${p} no longer contains ${JSON.stringify(mutate.find)} -- the mutation proves nothing`).toBe(true);
      sql = sql.split(mutate.find).join(mutate.replace);
    }
    await db.exec(sql);
  }
  await db.query("SELECT * FROM public.oflc_lca_wages_load($1::jsonb, now(), true)", [JSON.stringify(CELLS)]);
  return db;
}

async function ask(db: PGlite, tokens: string[], soc: string | null = null, state: string | null = null): Promise<Row[]> {
  const r = await db.query<Row>("SELECT * FROM public.get_employer_lca_wages($1::text[], $2, $3)", [tokens, soc, state]);
  return r.rows;
}

let db: PGlite;
beforeAll(async () => { db = await boot(); });
afterAll(async () => { await db?.close(); });

describe("the reader answers every token it is asked", () => {
  it("returns exactly one row per distinct token, including tokens it has nothing for", async () => {
    const asked = ["acmewidgets", "never-heard-of-it", "thinco", "tinyco"];
    const rows = await ask(db, asked, "15-1252", "CA");
    expect(rows.map((r) => r.ow_company_token)).toEqual([...asked].sort());
    expect(rows).toHaveLength(asked.length);
  });

  it("a token with nothing qualifying comes back as a row of nulls, never as an absence", async () => {
    const rows = await ask(db, ["never-heard-of-it", "tinyco"], "15-1252", "CA");
    for (const r of rows) {
      expect(r.ow_employer_filings_n).toBeNull();
      expect(r.ow_source_file).toBeNull();
      expect(r.ow_wage_low).toBeNull();
      expect(r.ow_match_basis).toBeNull();
      // ...and the token itself is still answered, so the client knows it asked.
      expect(typeof r.ow_company_token).toBe("string");
    }
  });

  it("a repeated token is answered once", async () => {
    const rows = await ask(db, ["acmewidgets", "acmewidgets", "acmewidgets", ""], "15-1252", "CA");
    expect(rows).toHaveLength(1);
    expect(rows[0].ow_company_token).toBe("acmewidgets");
  });

  it("an employer whose total clears the bar but whose every cell is under it gets the total and no range", async () => {
    const [row] = await ask(db, ["thinco"], "15-1252", "CA");
    expect(Number(row.ow_employer_filings_n)).toBe(4);
    expect(Number(row.ow_employer_cells_n)).toBe(2);
    expect(row.ow_wage_low).toBeNull();
    expect(row.ow_match_basis).toBeNull();
    expect(row.ow_source_file).toBe("LCA_Disclosure_Data_FY2026_Q3.xlsx");
    // pglite hands a date column back as a JS Date; PostgREST hands the client a
    // plain YYYY-MM-DD string, which is what the component's date-only check
    // reads. Compare in UTC so the assertion is about the stored day and not
    // about the machine running the test.
    expect(new Date(row.ow_published_on as string).toISOString().slice(0, 10)).toBe("2026-08-25");
  });

  it("asked with an occupation it answers only from that occupation or its major group", async () => {
    const [exact] = await ask(db, ["acmewidgets"], "15-1252", "CA");
    expect(exact.ow_match_basis).toBe("soc_and_state");
    expect(exact.ow_soc_code).toBe("15-1252");

    const [group] = await ask(db, ["acmewidgets"], "15-9999", null);
    expect(group.ow_match_basis).toBe("soc_group");

    // A different major group has no near cell: the employer totals still print,
    // the range does not, and no unrelated occupation is substituted for it.
    const [far] = await ask(db, ["acmewidgets"], "29-1141", "CA");
    expect(far.ow_match_basis).toBeNull();
    expect(far.ow_soc_code).toBeNull();
    expect(Number(far.ow_employer_filings_n)).toBe(21);
  });

  it("asked without an occupation it answers the largest cell and names it", async () => {
    const [byState] = await ask(db, ["acmewidgets"], null, "US-NY");
    expect(byState.ow_match_basis).toBe("state_top");
    expect(byState.ow_worksite_state).toBe("NY");
    expect(byState.ow_soc_title).toBe("Data Scientists");

    // With no occupation and no state, the largest cell wins -- twelve
    // applications in California, not the nine in New York.
    const [any] = await ask(db, ["acmewidgets"], null, null);
    expect(any.ow_match_basis).toBe("employer_top");
    expect(any.ow_soc_code).toBe("15-1252");
    expect(Number(any.ow_filings_n)).toBe(12);
  });

  it("teeth: an inner join on the employer totals loses the tokens it has nothing for", async () => {
    const bad = await boot({ prefix: READER, find: "LEFT JOIN emp e ON e.tok = t.tok", replace: "JOIN emp e ON e.tok = t.tok" });
    const rows = await ask(bad, ["acmewidgets", "never-heard-of-it", "tinyco"], "15-1252", "CA");
    expect(rows.map((r) => r.ow_company_token)).toEqual(["acmewidgets"]);
    await bad.close();
  }, 30_000);

  it("teeth: an inner join on the nearest cell loses the employer that has totals but no near cell", async () => {
    const bad = await boot({ prefix: READER, find: "LEFT JOIN near n ON n.tok = t.tok", replace: "JOIN near n ON n.tok = t.tok" });
    const rows = await ask(bad, ["acmewidgets", "thinco"], "15-1252", "CA");
    expect(rows.map((r) => r.ow_company_token)).toEqual(["acmewidgets"]);
    await bad.close();
  }, 30_000);

  it("teeth: an un-deduplicated token list answers one token more than once", async () => {
    const bad = await boot({ prefix: READER, find: "SELECT DISTINCT t.tok", replace: "SELECT t.tok" });
    const rows = await ask(bad, ["acmewidgets", "acmewidgets"], "15-1252", "CA");
    expect(rows).toHaveLength(2);
    await bad.close();
  }, 30_000);

  it("teeth: without the cell bar, a two-application cell prints a range", async () => {
    // THE MINIMUM, PROVED BY REMOVING IT. thinco's cells hold two applications
    // each: under the bar they print nothing, and the only thing standing
    // between a reader and a "range" drawn from two filings is this predicate.
    const bad = await boot({
      prefix: READER,
      find: "WHERE w.filings_n >= (SELECT kk.lca_min_filings FROM k kk)",
      replace: "WHERE w.filings_n >= 1",
    });
    const [row] = await ask(bad, ["thinco"], "15-1252", "CA");
    expect(row.ow_match_basis).toBe("soc_and_state");
    expect(Number(row.ow_wage_low)).toBe(90000);
    expect(Number(row.ow_filings_n)).toBe(2);
    await bad.close();
  }, 30_000);

  it("teeth: without the employer bar, a one-application employer prints totals", async () => {
    const bad = await boot({
      prefix: READER,
      find: "HAVING sum(w.filings_n) >= (SELECT kk.lca_min_filings FROM k kk)",
      replace: "HAVING sum(w.filings_n) >= 1",
    });
    const [row] = await ask(bad, ["tinyco"], "15-1252", "CA");
    expect(Number(row.ow_employer_filings_n)).toBe(1);
    await bad.close();
  }, 30_000);

  it("and the sealed reader answers correctly again", async () => {
    const rows = await ask(db, ["acmewidgets", "never-heard-of-it", "thinco"], "15-1252", "CA");
    expect(rows).toHaveLength(3);
  });
});

/**
 * TWO PERIODS RESIDENT IS ONE PERIOD ANSWERED -- THE READER'S OWN SCOPE.
 *
 * The writer can no longer produce this state: since 20260925150412 a load is
 * staged and swapped in one statement, and the pglite proof of that is
 * src/test/a-half-written-period-is-never-the-one-the-reader-serves.test.ts.
 * The reader's scoping is the SECOND line of defence and still worth holding,
 * because the defect it prevents is silent and goes out in nine languages at
 * once -- an employer total that adds two periods together under one period's
 * name. So the mixed state is built here the only way left: by writing the
 * second period's row into the table directly, around the writer.
 */
describe("two periods resident is one period answered", () => {
  /** A cell of an older period, inserted behind the writer's back. */
  async function insertDirectly(d: PGlite, c: ReturnType<typeof cell>) {
    await d.query(
      `INSERT INTO public.oflc_lca_wages (company_token, soc_code, worksite_state, soc_title,
         wage_low_annual, wage_high_annual, wage_median_annual, filings_n,
         source_file, source_url, fiscal_quarter, published_on, coverage_from, coverage_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date,$13::date,$14::date)`,
      [c.company_token, c.soc_code, c.worksite_state, c.soc_title, c.wage_low_annual, c.wage_high_annual,
       c.wage_median_annual, c.filings_n, c.source_file, c.source_url, c.fiscal_quarter, c.published_on,
       c.coverage_from, c.coverage_to],
    );
  }

  /** The newest period loaded whole, with a row of the previous one left beside it. */
  async function twoQuarters(): Promise<PGlite> {
    const d = new PGlite();
    await d.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    for (const p of LANE) await d.exec(migSql(p));
    await d.query("SELECT * FROM public.oflc_lca_wages_load($1::jsonb, now(), true)", [JSON.stringify([
      cell("mixco", "15-2051", "NY", "Data Scientists", 150000, 160000, 155000, 4),
    ])]);
    await insertDirectly(d, cell("mixco", "15-1252", "CA", "Software Developers", 100000, 110000, 105000, 10, PREV));
    return d;
  }

  it("the employer total counts one quarter, never two added together", async () => {
    const d = await twoQuarters();
    const [row] = await ask(d, ["mixco"], null, null);
    // Ten from the old quarter plus four from the new one is fourteen, under a
    // sentence naming one quarter. The answer is the four of the latest.
    expect(Number(row.ow_employer_filings_n)).toBe(4);
    expect(Number(row.ow_employer_cells_n)).toBe(1);
    expect(row.ow_fiscal_quarter).toBe("FY2026 Q3");
    await d.close();
  }, 30_000);

  it("the file and the date printed beside a figure are the file that figure came from", async () => {
    const d = await twoQuarters();
    const [row] = await ask(d, ["mixco"], null, null);
    // The returned cell is the Q3 one, so its own file and date travel with
    // it. An employer-level aggregate here printed the newest file's name over
    // an older quarter's cell.
    expect(row.ow_soc_code).toBe("15-2051");
    expect(row.ow_source_file).toBe("LCA_Disclosure_Data_FY2026_Q3.xlsx");
    expect(new Date(row.ow_published_on as string).toISOString().slice(0, 10)).toBe("2026-08-25");
    await d.close();
  }, 30_000);

  it("teeth: without the period scope the totals add two periods under one period's name", async () => {
    const d = new PGlite();
    await d.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    for (const p of LANE) {
      let sql = migSql(p);
      if (p === READER) {
        // The reader as it was written: the quarter taken as an aggregate over
        // all of an employer's rows, and the total summed across them.
        for (const [find, replace] of [
          ["           w.fiscal_quarter AS quarter,", "           (array_agg(w.fiscal_quarter ORDER BY w.published_on DESC, w.company_token))[1] AS quarter,"],
          ["      AND w.fiscal_quarter = (SELECT qq.fq FROM q qq)\n    GROUP BY w.company_token, w.fiscal_quarter", "    GROUP BY w.company_token"],
        ]) {
          expect(sql.includes(find), `the employer quarter scope moved -- the mutation proves nothing (${find.trim().slice(0, 40)})`).toBe(true);
          sql = sql.split(find).join(replace);
        }
      }
      await d.exec(sql);
    }
    await d.query("SELECT * FROM public.oflc_lca_wages_load($1::jsonb, now(), true)", [JSON.stringify([
      cell("mixco", "15-2051", "NY", "Data Scientists", 150000, 160000, 155000, 4),
    ])]);
    await insertDirectly(d, cell("mixco", "15-1252", "CA", "Software Developers", 100000, 110000, 105000, 10, PREV));
    const rows = await ask(d, ["mixco"], null, null);
    expect(Number(rows[0].ow_employer_filings_n), "the mutation did not apply -- RE-ANCHOR this tooth").toBe(14);
    await d.close();
  }, 30_000);
});

/**
 * THE PRUNE'S SAFETY IS THE ABSENCE OF A DEFAULT ON ITS STAMP.
 *
 * Every chunk of one run carries ONE stamp and only the last passes p_prune.
 * With a stamp defaulting to the clock, an operator posting chunks through
 * PostgREST and omitting it gets a FRESH stamp per call -- so the pruning
 * chunk deletes the run's own earlier chunks and leaves a quarter of thousands
 * of cells holding the last few hundred. Every employer figure read off it is
 * then silently wrong rather than absent, which is the worse of the two.
 */
describe("the run stamp is required, because the prune keys on it", () => {
  it("a stamp shared by every chunk keeps the whole run", async () => {
    const d = new PGlite();
    await d.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    for (const p of LANE) await d.exec(migSql(p));
    const { rows: [stamp] } = await d.query<{ now: string }>("SELECT now() AS now");
    for (const [i, tok] of ["a", "b", "c"].entries()) {
      await d.query("SELECT * FROM public.oflc_lca_wages_load($1::jsonb, $2::timestamptz, $3)", [
        JSON.stringify([cell(tok, "15-1252", "CA", "Software Developers", 100000, 110000, 105000, 5)]),
        stamp.now, i === 2,
      ]);
    }
    const { rows } = await d.query<{ company_token: string }>("SELECT company_token FROM public.oflc_lca_wages ORDER BY 1");
    expect(rows.map((r) => r.company_token)).toEqual(["a", "b", "c"]);
    await d.close();
  }, 30_000);

  it("the parameter has no default, so a call that omits it cannot run at all", async () => {
    const d = new PGlite();
    await d.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    for (const p of LANE) await d.exec(migSql(p));
    // Named arguments are how PostgREST calls it; omitting the stamp must fail
    // to resolve rather than silently take the clock.
    await expect(
      d.query("SELECT * FROM public.oflc_lca_wages_load(p_rows => $1::jsonb, p_prune => true)", [JSON.stringify([])]),
    ).rejects.toThrow();
    // ...and an explicit null is refused in the body, by name.
    await expect(
      d.query("SELECT * FROM public.oflc_lca_wages_load($1::jsonb, NULL, true)", [JSON.stringify([])]),
    ).rejects.toThrow(/run stamp/i);
    await d.close();
  }, 30_000);

  it("teeth: with the stamp defaulting to the clock, the last chunk deletes the first two", async () => {
    const d = new PGlite();
    await d.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
    for (const p of LANE) {
      let sql = migSql(p);
      if (p === WRITER) {
        const find = "  p_run_started_at timestamptz,";
        expect(sql.includes(find), "the stamp parameter moved -- the mutation proves nothing").toBe(true);
        sql = sql.split(find).join("  p_run_started_at timestamptz DEFAULT now(),");
      }
      await d.exec(sql);
    }
    for (const [i, tok] of ["a", "b", "c"].entries()) {
      await d.query("SELECT * FROM public.oflc_lca_wages_load(p_rows => $1::jsonb, p_prune => $2)", [
        JSON.stringify([cell(tok, "15-1252", "CA", "Software Developers", 100000, 110000, 105000, 5)]),
        i === 2,
      ]);
    }
    const { rows } = await d.query<{ company_token: string }>("SELECT company_token FROM public.oflc_lca_wages ORDER BY 1");
    const left = rows.map((r) => r.company_token);
    // HOW MANY of the run's own chunks the prune eats depends on the clock's
    // resolution -- chunks posted inside one tick share a stamp and survive --
    // so the assertion is the PROPERTY, not a count: the run's first chunk is
    // gone, and the table no longer holds the run that was just loaded. On a
    // real quarter that is thousands of cells replaced by hundreds, and every
    // employer figure read off it is wrong rather than absent.
    expect(left, "the mutation did not apply -- RE-ANCHOR this tooth").not.toContain("a");
    expect(left.length, "the mutation did not apply -- RE-ANCHOR this tooth").toBeLessThan(3);
    await d.close();
  }, 30_000);
});

describe("the definer functions are locked by name", () => {
  it("revokes from PUBLIC, anon and authenticated by name before it grants", () => {
    for (const [prefix, fn] of [[WRITER, "oflc_lca_wages_load"], [READER, "get_employer_lca_wages"]] as const) {
      const code = migSql(prefix).replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const role of ["PUBLIC", "anon", "authenticated"]) {
        expect(code, `${fn} must revoke from ${role} by name`).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM ${role}`));
      }
      expect(code).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`));
    }
  });

  it("the writer is reachable by the service role alone, and neither table by any client role", () => {
    const writer = migSql(WRITER).replace(/--[^\n]*/g, "");
    expect(writer).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.oflc_lca_wages_load\([^)]*\) TO [^;]*\b(anon|authenticated)\b/);
    // The staging table holds a whole period on its way in and is exactly as
    // sensitive as the live one.
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(writer, `the staging table must revoke from ${role} by name`)
        .toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.oflc_lca_wages_stage FROM ${role}`));
    }
    expect(writer).toMatch(/ALTER TABLE public\.oflc_lca_wages_stage ENABLE ROW LEVEL SECURITY/);
    const table = migSql("20260923114532").replace(/--[^\n]*/g, "");
    expect(table).toMatch(/ALTER TABLE public\.oflc_lca_wages ENABLE ROW LEVEL SECURITY/);
    expect(table).not.toMatch(/CREATE POLICY/);
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(table).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.oflc_lca_wages FROM ${role}`));
    }
  });
});
